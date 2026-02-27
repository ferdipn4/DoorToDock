"""JSON API endpoints for the Door2Dock dashboard."""

from functools import wraps
from flask import Blueprint, jsonify, request
from webapp.db import query, query_one, ensure_walking_distances
from webapp.forecast import get_forecast_service, fetch_weather_forecast
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

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
    """Average dock availability by half-hour (London time) and weekday."""
    station_ids = request.args.get("station_ids", "")
    id_list = [s.strip() for s in station_ids.split(",") if s.strip()]

    if id_list:
        placeholders = ",".join(["%s"] * len(id_list))
        rows = query(f"""
            SELECT
                EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London')::int AS weekday,
                EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
                CASE WHEN EXTRACT(MINUTE FROM timestamp AT TIME ZONE 'Europe/London') < 30
                     THEN 0 ELSE 30 END AS minute,
                ROUND(AVG(empty_docks)::numeric, 1) AS avg_docks,
                COUNT(*) AS samples
            FROM bike_availability
            WHERE station_id IN ({placeholders})
            GROUP BY weekday, hour, minute
            ORDER BY weekday, hour, minute
        """, tuple(id_list))
    else:
        rows = query("""
            SELECT
                EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London')::int AS weekday,
                EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
                CASE WHEN EXTRACT(MINUTE FROM timestamp AT TIME ZONE 'Europe/London') < 30
                     THEN 0 ELSE 30 END AS minute,
                ROUND(AVG(empty_docks)::numeric, 1) AS avg_docks,
                COUNT(*) AS samples
            FROM bike_availability
            GROUP BY weekday, hour, minute
            ORDER BY weekday, hour, minute
        """)

    for row in rows:
        if row["avg_docks"] is not None:
            row["avg_docks"] = float(row["avg_docks"])
        row["minute"] = int(row["minute"])
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
# Dock Forecast
# ------------------------------------------------------------------

@api.route("/forecast")
@db_error_handler
def forecast():
    """Predicted dock availability using the trained model."""
    svc = get_forecast_service()
    if svc is None:
        return jsonify({"available": False, "reason": "no model loaded"})

    # Default: current fractional hour + horizon in London time
    london = ZoneInfo("Europe/London")
    now_london = datetime.now(london)
    horizon = svc.prediction_horizon_min
    default_hour = (now_london.hour + now_london.minute / 60 + horizon / 60) % 24
    hour = request.args.get("hour", default_hour, type=float)
    weekday = request.args.get("weekday", now_london.weekday(), type=int)

    # Latest weather from DB
    weather_row = query_one("""
        SELECT temperature, humidity, precipitation, wind_speed
        FROM weather_data
        ORDER BY timestamp DESC
        LIMIT 1
    """)
    weather = weather_row or {}

    # Station list with total_docks
    stations = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.total_docks
        FROM bike_availability ba
        JOIN monitored_stations ms ON ba.station_id = ms.station_id
        ORDER BY ba.station_id, ba.timestamp DESC
    """)

    predictions = svc.predict_all_stations(stations, weather, hour, weekday)
    return jsonify({
        "available": True,
        "model_name": svc.model_name,
        "prediction_horizon_min": horizon,
        "hour": round(hour, 2),
        "weekday": weekday,
        "predictions": predictions,
    })


# ------------------------------------------------------------------
# Commute Planner Scan
# ------------------------------------------------------------------

@api.route("/commute-scan")
@db_error_handler
def commute_scan():
    """Scan a morning time window and predict dock availability."""
    svc = get_forecast_service()
    if svc is None:
        return jsonify({"available": False, "reason": "no model loaded"})

    london = ZoneInfo("Europe/London")
    tomorrow = (datetime.now(london) + timedelta(days=1)).strftime("%Y-%m-%d")

    target_date = request.args.get("date", tomorrow)
    start = request.args.get("start", 8.0, type=float)
    end = request.args.get("end", 10.0, type=float)
    fav_ids = request.args.get("stations", "")
    fav_set = set(fav_ids.split(",")) if fav_ids else set()

    # Determine weekday for target date
    try:
        dt = datetime.strptime(target_date, "%Y-%m-%d")
        weekday = dt.weekday()
    except ValueError:
        weekday = datetime.now(london).weekday()

    # Fetch weather forecast from Open-Meteo
    weather_by_hour = fetch_weather_forecast(target_date)
    if not weather_by_hour:
        # Fallback: latest observation from DB
        weather_row = query_one("""
            SELECT temperature, humidity, precipitation, wind_speed
            FROM weather_data ORDER BY timestamp DESC LIMIT 1
        """)
        if weather_row:
            for h in range(24):
                weather_by_hour[h] = weather_row

    # Station list with total_docks
    all_stations = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.total_docks
        FROM bike_availability ba
        JOIN monitored_stations ms ON ba.station_id = ms.station_id
        ORDER BY ba.station_id, ba.timestamp DESC
    """)

    if fav_set:
        favorites = [s for s in all_stations if s["station_id"] in fav_set]
        alternatives = [s for s in all_stations if s["station_id"] not in fav_set]
    else:
        favorites = all_stations
        alternatives = []

    fav_scan = svc.scan_time_range(favorites, weather_by_hour, weekday, start, end)
    alt_scan = svc.scan_time_range(alternatives, weather_by_hour, weekday, start, end) if alternatives else {"slots": fav_scan["slots"], "stations": {}}

    # Compute recommendation: last slot where at least one favorite has >= 5 docks
    recommendation = _compute_recommendation(fav_scan)

    return jsonify({
        "available": True,
        "date": target_date,
        "prediction_horizon_min": svc.prediction_horizon_min,
        "weather_forecast": {str(h): w for h, w in weather_by_hour.items()
                             if int(start) <= h <= int(end) + 1},
        "favorites": fav_scan,
        "alternatives": alt_scan,
        "recommendation": recommendation,
    })


def _compute_recommendation(scan):
    """Find the last safe arrival time (>= 5 docks at any favorite station)."""
    slots = scan["slots"]
    stations = scan["stations"]
    if not slots or not stations:
        return None

    last_safe_idx = None
    last_safe_station = None

    for i, slot in enumerate(slots):
        for sid, sdata in stations.items():
            preds = sdata["predictions"]
            if i < len(preds) and preds[i] is not None and preds[i] >= 5:
                last_safe_idx = i
                last_safe_station = (sid, sdata["name"])
                break  # at least one station is safe at this time

    if last_safe_idx is not None:
        arrive_by = slots[last_safe_idx]
        station_id, station_name = last_safe_station
        short_name = station_name.split(",")[0]
        return {
            "arrive_by": arrive_by,
            "reason": f"Arrive by {arrive_by} for docks at {short_name}.",
            "station_id": station_id,
            "urgency": "green" if last_safe_idx > len(slots) * 0.6 else "yellow",
        }

    # No safe slot found
    return {
        "arrive_by": slots[0],
        "reason": "All stations predicted full – arrive as early as possible.",
        "station_id": None,
        "urgency": "red",
    }


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
