"""JSON API endpoints for the Door2Dock dashboard."""

from functools import wraps
from flask import Blueprint, jsonify, request
from webapp.db import query, query_one, ensure_walking_distances
from datetime import datetime, timezone

api = Blueprint("api", __name__, url_prefix="/api")


def db_error_handler(f):
    """Return a clean JSON error if the database is unreachable."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            return jsonify({"error": str(e)}), 503
    return wrapper


def _serialise(rows):
    """Convert datetime objects to ISO strings for JSON."""
    for row in rows:
        for key, val in row.items():
            if isinstance(val, datetime):
                row[key] = val.isoformat()
    return rows


# ------------------------------------------------------------------
# Live Status
# ------------------------------------------------------------------

@api.route("/live")
@db_error_handler
def live_status():
    """Current bike availability at all monitored stations."""
    ensure_walking_distances()
    rows = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.available_bikes,
            ba.standard_bikes, ba.ebikes, ba.empty_docks,
            ba.total_docks, ba.latitude, ba.longitude, ba.timestamp,
            ms.distance_m,
            COALESCE(ms.walking_distance_m, ms.distance_m * 1.3) AS walking_distance_m,
            COALESCE(ms.walking_duration_s, ms.distance_m * 1.3 / 1.2) AS walking_duration_s
        FROM bike_availability ba
        JOIN monitored_stations ms ON ba.station_id = ms.station_id
        ORDER BY ba.station_id, ba.timestamp DESC
    """)
    for row in rows:
        empty = row.get("empty_docks") or 0
        if empty >= 5:
            row["status"] = "green"
        elif empty >= 1:
            row["status"] = "yellow"
        else:
            row["status"] = "red"
    return jsonify(_serialise(rows))


@api.route("/weather-now")
@db_error_handler
def weather_now():
    """Most recent weather reading."""
    row = query_one("""
        SELECT timestamp, temperature, humidity, precipitation,
               wind_speed, weather_code, description
        FROM weather_data
        ORDER BY timestamp DESC
        LIMIT 1
    """)
    if row and isinstance(row.get("timestamp"), datetime):
        row["timestamp"] = row["timestamp"].isoformat()
    return jsonify(row or {})


# ------------------------------------------------------------------
# Stations
# ------------------------------------------------------------------

@api.route("/stations")
@db_error_handler
def stations():
    """List of all monitored stations."""
    ensure_walking_distances()
    rows = query("""
        SELECT station_id, station_name, latitude, longitude,
               ROUND(distance_m::numeric) AS distance_m,
               ROUND(COALESCE(walking_distance_m, distance_m * 1.3)::numeric) AS walking_distance_m,
               ROUND(COALESCE(walking_duration_s, distance_m * 1.3 / 1.2)::numeric) AS walking_duration_s
        FROM monitored_stations
        ORDER BY walking_distance_m
    """)
    return jsonify(rows)


# ------------------------------------------------------------------
# Time Series
# ------------------------------------------------------------------

@api.route("/timeseries/<station_id>")
@db_error_handler
def timeseries(station_id):
    """Bike availability over time for one station."""
    hours = request.args.get("hours", 24, type=int)
    hours = min(hours, 24 * 14)  # max 2 weeks

    rows = query("""
        SELECT timestamp, available_bikes, standard_bikes,
               ebikes, empty_docks
        FROM bike_availability
        WHERE station_id = %s
          AND timestamp > NOW() - make_interval(hours => %s)
        ORDER BY timestamp
    """, (station_id, hours))
    return jsonify(_serialise(rows))


# ------------------------------------------------------------------
# Heatmap: hour x weekday
# ------------------------------------------------------------------

@api.route("/heatmap")
@db_error_handler
def heatmap():
    """Average availability by hour (London time) and weekday."""
    station_id = request.args.get("station_id")

    if station_id:
        rows = query("""
            SELECT
                EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London')::int AS weekday,
                EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
                ROUND(AVG(available_bikes)::numeric, 1) AS avg_bikes,
                ROUND(AVG(empty_docks)::numeric, 1) AS avg_docks,
                COUNT(*) AS samples
            FROM bike_availability
            WHERE station_id = %s
            GROUP BY weekday, hour
            ORDER BY weekday, hour
        """, (station_id,))
    else:
        rows = query("""
            SELECT
                EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London')::int AS weekday,
                EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
                ROUND(AVG(available_bikes)::numeric, 1) AS avg_bikes,
                ROUND(AVG(empty_docks)::numeric, 1) AS avg_docks,
                COUNT(*) AS samples
            FROM bike_availability
            GROUP BY weekday, hour
            ORDER BY weekday, hour
        """)

    # Convert Decimal to float for JSON
    for row in rows:
        for key in ("avg_bikes", "avg_docks"):
            if row[key] is not None:
                row[key] = float(row[key])
    return jsonify(rows)


# ------------------------------------------------------------------
# Weather Correlation
# ------------------------------------------------------------------

@api.route("/weather-correlation")
@db_error_handler
def weather_correlation():
    """Bike availability + weather data points for scatter plots."""
    rows = query("""
        SELECT
            w.temperature, w.precipitation, w.wind_speed,
            w.humidity, w.description,
            ROUND(AVG(b.available_bikes)::numeric, 1) AS avg_bikes,
            ROUND(AVG(b.empty_docks)::numeric, 1) AS avg_docks
        FROM bike_availability b
        INNER JOIN weather_data w ON b.timestamp = w.timestamp
        GROUP BY w.timestamp, w.temperature, w.precipitation,
                 w.wind_speed, w.humidity, w.description
        ORDER BY w.temperature
    """)
    for row in rows:
        for key in ("avg_bikes", "avg_docks"):
            if row[key] is not None:
                row[key] = float(row[key])
    return jsonify(rows)


@api.route("/correlation-stats")
@db_error_handler
def correlation_stats():
    """Pearson correlation coefficients."""
    row = query_one("""
        SELECT
            CORR(w.temperature, sub.avg_bikes) AS temp_corr,
            CORR(w.precipitation, sub.avg_bikes) AS rain_corr,
            CORR(w.wind_speed, sub.avg_bikes) AS wind_corr,
            CORR(w.humidity, sub.avg_bikes) AS humidity_corr,
            COUNT(*) AS samples
        FROM weather_data w
        INNER JOIN (
            SELECT timestamp, AVG(available_bikes) AS avg_bikes
            FROM bike_availability
            GROUP BY timestamp
        ) sub ON w.timestamp = sub.timestamp
    """)
    if row:
        for key in ("temp_corr", "rain_corr", "wind_corr", "humidity_corr"):
            if row[key] is not None:
                row[key] = round(float(row[key]), 4)
    return jsonify(row or {})


# ------------------------------------------------------------------
# Overall Stats
# ------------------------------------------------------------------

@api.route("/stats")
@db_error_handler
def stats():
    """Overall collection statistics."""
    row = query_one("""
        SELECT
            (SELECT COUNT(*) FROM bike_availability) AS bike_rows,
            (SELECT COUNT(*) FROM weather_data) AS weather_rows,
            (SELECT COUNT(*) FROM monitored_stations) AS stations,
            (SELECT MIN(timestamp) FROM bike_availability) AS first_record,
            (SELECT MAX(timestamp) FROM bike_availability) AS last_record
    """)
    if row:
        for key in ("first_record", "last_record"):
            if isinstance(row.get(key), datetime):
                row[key] = row[key].isoformat()
        days = 0
        if row.get("first_record") and row.get("last_record"):
            first = datetime.fromisoformat(row["first_record"])
            last = datetime.fromisoformat(row["last_record"])
            days = (last - first).days + 1
        row["collection_days"] = days
    return jsonify(row or {})
