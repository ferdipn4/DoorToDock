"""
Door2Dock -- Export & Merge Dataset for Model Training

Joins three tables:
  - bike_availability  (target: empty_docks per station per minute)
  - sensor_data        (sensor temperature, timestamps offset by up to 50s)
  - weather_data       (humidity, precipitation, wind_speed from API)

Join strategy: round all timestamps to the nearest minute, then merge.
The sensor temperature is used as the "temperature" feature (not the API one).

Usage:
    export DATABASE_URL="postgresql://..."
    python export_data.py
    python export_data.py --output data/merged.csv
"""

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd


def get_connection():
    """Create a psycopg connection from DATABASE_URL."""
    import psycopg

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    parsed = urlparse(url)
    return psycopg.connect(
        host=parsed.hostname,
        port=parsed.port,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
        sslmode="require",
        connect_timeout=15,
        autocommit=True,
        prepare_threshold=None,
    )


def fetch_table(conn, query, name):
    """Fetch a SQL query into a DataFrame."""
    cur = conn.cursor()
    cur.execute(query)
    columns = [desc[0] for desc in cur.description]
    rows = cur.fetchall()
    cur.close()
    df = pd.DataFrame(rows, columns=columns)
    print(f"  {name}: {len(df):,} rows")
    return df


def main():
    parser = argparse.ArgumentParser(description="Export merged dataset")
    parser.add_argument("--output", default="data/merged.csv", help="Output CSV path")
    args = parser.parse_args()

    print("=" * 60)
    print("Door2Dock -- Data Export")
    print("=" * 60)

    conn = get_connection()

    # ---- Fetch raw data ----
    print("\nFetching data from Supabase...")

    bike = fetch_table(conn, """
        SELECT timestamp, station_id, station_name,
               available_bikes, standard_bikes, ebikes,
               empty_docks, total_docks
        FROM bike_availability
        ORDER BY timestamp
    """, "bike_availability")

    sensor = fetch_table(conn, """
        SELECT created_at AS timestamp, temperature_c
        FROM temperature_readings
        ORDER BY created_at
    """, "temperature_readings")

    weather = fetch_table(conn, """
        SELECT timestamp, humidity, precipitation, wind_speed
        FROM weather_data
        ORDER BY timestamp
    """, "weather_data")

    # ---- Round timestamps to nearest minute for joining ----
    print("\nRounding timestamps to nearest minute...")

    bike["timestamp"] = pd.to_datetime(bike["timestamp"], utc=True)
    sensor["timestamp"] = pd.to_datetime(sensor["timestamp"], utc=True)
    weather["timestamp"] = pd.to_datetime(weather["timestamp"], utc=True)

    bike["ts_minute"] = bike["timestamp"].dt.round("min")
    sensor["ts_minute"] = sensor["timestamp"].dt.round("min")
    weather["ts_minute"] = weather["timestamp"].dt.round("min")

    # ---- Deduplicate sensor & weather per minute (take mean if multiple) ----
    sensor_agg = sensor.groupby("ts_minute").agg(
        temperature=("temperature_c", "mean"),
    ).reset_index()
    sensor_agg["temperature"] = sensor_agg["temperature"].round(2)

    weather_agg = weather.groupby("ts_minute").agg(
        humidity=("humidity", "mean"),
        precipitation=("precipitation", "mean"),
        wind_speed=("wind_speed", "mean"),
    ).reset_index()

    # ---- Also fetch API temperature for fallback ----
    weather_temp = fetch_table(conn, """
        SELECT timestamp, temperature AS api_temperature
        FROM weather_data
        ORDER BY timestamp
    """, "weather_data (temperature)")

    weather_temp["timestamp"] = pd.to_datetime(weather_temp["timestamp"], utc=True)
    weather_temp["ts_minute"] = weather_temp["timestamp"].dt.round("min")
    weather_temp_agg = weather_temp.groupby("ts_minute").agg(
        api_temperature=("api_temperature", "mean"),
    ).reset_index()
    weather_temp_agg["api_temperature"] = weather_temp_agg["api_temperature"].round(2)

    conn.close()

    # ---- Merge ----
    print("\nMerging datasets...")

    # Bike + weather (inner: we need humidity, precip, wind for all rows)
    merged = bike.merge(weather_agg, on="ts_minute", how="inner")
    print(f"  After bike + weather join: {len(merged):,} rows")

    # + API temperature
    merged = merged.merge(weather_temp_agg, on="ts_minute", how="left")
    print(f"  After + API temperature join: {len(merged):,} rows")

    # + sensor temperature (LEFT join: only available for ~16 days)
    merged = merged.merge(sensor_agg, on="ts_minute", how="left")
    print(f"  After + sensor join: {len(merged):,} rows")
    sensor_coverage = merged["temperature"].notna().sum()
    print(f"  Sensor coverage: {sensor_coverage:,} / {len(merged):,} rows ({100*sensor_coverage/len(merged):.1f}%)")

    # Use sensor temperature where available, fall back to API temperature
    merged["temperature"] = merged["temperature"].fillna(merged["api_temperature"])
    merged = merged.drop(columns=["api_temperature"])

    # ---- Clean up ----
    merged = merged.drop(columns=["ts_minute"])
    merged = merged.sort_values(["station_id", "timestamp"]).reset_index(drop=True)

    # Drop any rows with nulls in key columns
    key_cols = ["empty_docks", "total_docks", "temperature",
                "humidity", "precipitation", "wind_speed"]
    before = len(merged)
    merged = merged.dropna(subset=key_cols)
    dropped = before - len(merged)
    if dropped > 0:
        print(f"  Dropped {dropped:,} rows with NaN values")

    # ---- Summary ----
    print(f"\nFinal dataset: {len(merged):,} rows")
    print(f"  Stations: {merged['station_id'].nunique()}")
    print(f"  Time span: {merged['timestamp'].min()} -- {merged['timestamp'].max()}")
    print(f"  Temperature range: {merged['temperature'].min():.1f} -- {merged['temperature'].max():.1f} °C")

    # ---- Save ----
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(out_path, index=False)
    print(f"\nSaved to {out_path}")
    print(f"  Columns: {list(merged.columns)}")


if __name__ == "__main__":
    main()
