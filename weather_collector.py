#!/usr/bin/env python3
"""
Smart-Commute Predictor – Weather Data Collector
Heroku Worker + Supabase PostgreSQL

Sammelt alle 15 Minuten Wetterdaten von OpenWeatherMap
für den Bereich Imperial College South Kensington.

Usage:
    python weather_collector.py              # Dauerbetrieb (alle 15 Min)
    python weather_collector.py --once       # Einmal sammeln
    python weather_collector.py --stats      # Statistiken anzeigen

Env vars (in .env oder Heroku Config Vars):
    DATABASE_URL=postgresql://user:pass@host:port/dbname
    OPENWEATHER_API_KEY=dein_api_key
"""

import requests
import psycopg
import time
import sys
import os
from datetime import datetime, timezone

# ============================================================
# KONFIGURATION
# ============================================================

IMPERIAL_LAT = 51.4988
IMPERIAL_LON = -0.1749
POLL_INTERVAL = 900  # 15 Minuten

OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"

# Environment Variables
DATABASE_URL = os.environ.get("DATABASE_URL", "")
OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY", "")

# ============================================================
# ZEITZONE
# ============================================================

def get_london_now():
    """Gibt die aktuelle London-Zeit zurück."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/London"))
    except ImportError:
        return datetime.now(timezone.utc)

# ============================================================
# DATENBANK (Supabase PostgreSQL)
# ============================================================

def get_db():
    """Erstellt eine neue DB-Verbindung."""
    if not DATABASE_URL:
        print("❌ DATABASE_URL nicht gesetzt!")
        sys.exit(1)

    from urllib.parse import urlparse
    parsed = urlparse(DATABASE_URL)

    conn = psycopg.connect(
        host=parsed.hostname,
        port=parsed.port,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
        sslmode="require",
        connect_timeout=10,
        autocommit=True,
    )
    return conn

def init_db():
    """Erstellt die weather_data Tabelle falls noch nicht vorhanden."""
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS weather_data (
            id              SERIAL PRIMARY KEY,
            timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            temperature     DOUBLE PRECISION,
            humidity        DOUBLE PRECISION,
            precipitation   DOUBLE PRECISION,
            wind_speed      DOUBLE PRECISION,
            weather_code    INTEGER,
            description     TEXT
        )
    """)

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_weather_timestamp
        ON weather_data(timestamp)
    """)

    cur.close()
    conn.close()
    print("[weather-init] ✅ Tabelle weather_data bereit")

# ============================================================
# DATENSAMMLUNG
# ============================================================

def collect_once():
    """Führt eine einzelne Wetter-Datensammlung durch."""
    if not OPENWEATHER_API_KEY:
        print("[weather] ❌ OPENWEATHER_API_KEY nicht gesetzt!")
        return "error"

    # Timestamp auf volle Minute runden, damit Bike- und Wetter-Daten
    # beim JOIN über timestamp matchen (gleiche Minutengranularität)
    now_utc = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    now_london = get_london_now()

    try:
        resp = requests.get(OPENWEATHER_URL, params={
            "lat": IMPERIAL_LAT,
            "lon": IMPERIAL_LON,
            "appid": OPENWEATHER_API_KEY,
            "units": "metric",
        }, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"[weather] ❌ API-Fehler: {e}")
        return "error"

    # Daten extrahieren
    main = data.get("main", {})
    wind = data.get("wind", {})
    rain = data.get("rain", {})
    weather = data.get("weather", [{}])[0]

    temperature = main.get("temp")
    humidity = main.get("humidity")
    precipitation = rain.get("1h", 0.0)  # mm in letzter Stunde
    wind_speed = wind.get("speed")
    weather_code = weather.get("id")
    description = weather.get("description", "")

    # In DB speichern
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO weather_data
            (timestamp, temperature, humidity, precipitation,
             wind_speed, weather_code, description)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (
        now_utc, temperature, humidity, precipitation,
        wind_speed, weather_code, description,
    ))

    cur.close()
    conn.close()

    print(f"[weather] ✅ {now_london.strftime('%H:%M:%S')} London – "
          f"{temperature}°C, {description}, Wind {wind_speed}m/s, "
          f"Regen {precipitation}mm/h")
    return "ok"

# ============================================================
# LAUFMODI
# ============================================================

def run_continuous():
    """Dauerläufer – für Heroku Worker oder lokal."""
    print("\n" + "=" * 60)
    print("🌤️  Smart-Commute Weather Collector")
    print(f"   Intervall:   {POLL_INTERVAL} Sekunden (15 Min)")
    print(f"   Standort:    Imperial College ({IMPERIAL_LAT}, {IMPERIAL_LON})")
    print(f"   Datenbank:   Supabase PostgreSQL")
    print("=" * 60 + "\n")

    while True:
        try:
            collect_once()
        except Exception as e:
            print(f"[weather-error] {e} – versuche in 15min erneut...")
        time.sleep(POLL_INTERVAL)

# ============================================================
# STATISTIKEN
# ============================================================

def show_stats():
    """Zeigt eine Übersicht der gesammelten Wetterdaten."""
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM weather_data")
    total = cur.fetchone()[0]

    if total == 0:
        print("\n📊 Noch keine Wetterdaten gesammelt.")
        cur.close()
        conn.close()
        return

    cur.execute("SELECT MIN(timestamp), MAX(timestamp) FROM weather_data")
    first, last = cur.fetchone()

    cur.execute("""
        SELECT ROUND(AVG(temperature)::numeric, 1),
               ROUND(AVG(humidity)::numeric, 1),
               ROUND(AVG(wind_speed)::numeric, 1),
               ROUND(AVG(precipitation)::numeric, 2)
        FROM weather_data
    """)
    avg_temp, avg_hum, avg_wind, avg_rain = cur.fetchone()

    days = (last - first).days + 1 if first and last else "?"

    print(f"\n🌤️  Wetter-Statistiken:")
    print(f"   Datenpunkte:    {total:,}")
    print(f"   Sammeldauer:    {days} Tag(e)")
    print(f"   Erster Eintrag: {first}")
    print(f"   Letzter Eintrag:{last}")
    print(f"\n   Durchschnitte:")
    print(f"   Temperatur:     {avg_temp}°C")
    print(f"   Luftfeuchtigkeit: {avg_hum}%")
    print(f"   Windgeschwindigkeit: {avg_wind} m/s")
    print(f"   Niederschlag:   {avg_rain} mm/h")

    # Letzte 5 Einträge
    print(f"\n   Letzte 5 Messungen:")
    print(f"   {'Zeit':<22} {'Temp':>6} {'Wetter':<20} {'Wind':>6} {'Regen':>7}")
    print("   " + "-" * 65)

    cur.execute("""
        SELECT timestamp, temperature, description, wind_speed, precipitation
        FROM weather_data
        ORDER BY timestamp DESC
        LIMIT 5
    """)
    for ts, temp, desc, wind, rain in cur.fetchall():
        ts_str = ts.strftime("%Y-%m-%d %H:%M")
        print(f"   {ts_str:<22} {temp:>5.1f}° {desc:<20} {wind:>5.1f}  {rain:>6.2f}")

    cur.close()
    conn.close()
    print()

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    print(f"[weather-main] Args: {sys.argv[1:]}")

    init_db()

    if "--stats" in sys.argv:
        show_stats()
    elif "--once" in sys.argv:
        collect_once()
    else:
        run_continuous()
