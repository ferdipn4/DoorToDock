"""JSON API endpoints for the Door2Dock dashboard."""

import logging
import math
from functools import wraps

log = logging.getLogger(__name__)
from flask import Blueprint, jsonify, request
from webapp.db import query, query_one, ensure_walking_distances, execute
from webapp.forecast import get_forecast_service, get_nowcast_service, fetch_weather_forecast
from webapp.telegram import is_configured as tg_configured, send_dock_alert, send_message
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
    """List of all monitored stations with live availability."""
    ensure_walking_distances()
    rows = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.latitude, ba.longitude,
            ba.available_bikes, ba.standard_bikes, ba.ebikes,
            ba.empty_docks, ba.total_docks, ba.timestamp,
            ROUND(ms.distance_m::numeric) AS distance_m,
            ROUND(COALESCE(ms.walking_distance_m, ms.distance_m * 1.3)::numeric) AS walking_distance_m,
            ROUND(COALESCE(ms.walking_duration_s, ms.distance_m * 1.3 / 1.2)::numeric) AS walking_duration_s
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
        if isinstance(row.get("timestamp"), datetime):
            row["timestamp"] = row["timestamp"].isoformat()
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
            CORR(w.temperature, sub.avg_docks) AS temp_corr,
            CORR(w.precipitation, sub.avg_docks) AS rain_corr,
            CORR(w.wind_speed, sub.avg_docks) AS wind_corr,
            CORR(w.humidity, sub.avg_docks) AS humidity_corr,
            COUNT(*) AS samples
        FROM weather_data w
        INNER JOIN (
            SELECT timestamp, AVG(empty_docks) AS avg_docks
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
    """Predicted dock availability using the nowcast model (with live data).

    Falls back to forecast model if nowcast is unavailable.
    """
    # Prefer nowcast (uses current empty_docks), fall back to forecast
    svc = get_nowcast_service() or get_forecast_service()
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

    # Station list with total_docks + current empty_docks (for nowcast)
    stations = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.total_docks, ba.empty_docks
        FROM bike_availability ba
        JOIN monitored_stations ms ON ba.station_id = ms.station_id
        ORDER BY ba.station_id, ba.timestamp DESC
    """)

    # Build current docks map for nowcast model
    current_docks = {s["station_id"]: s["empty_docks"] for s in stations}

    predictions = svc.predict_all_stations(
        stations, weather, hour, weekday, current_docks=current_docks,
    )
    return jsonify({
        "available": True,
        "model_name": svc.model_name,
        "model_type": svc.model_type,
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
    mode = request.args.get("mode", "morning")  # "morning" or "evening"
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

    # Compute recommendation
    recommendation = _compute_recommendation(fav_scan, mode)

    return jsonify({
        "available": True,
        "date": target_date,
        "mode": mode,
        "prediction_horizon_min": svc.prediction_horizon_min,
        "weather_forecast": {str(h): w for h, w in weather_by_hour.items()
                             if int(start) <= h <= int(end) + 1},
        "favorites": fav_scan,
        "alternatives": alt_scan,
        "recommendation": recommendation,
    })


def _compute_recommendation(scan, mode="morning"):
    """Find the last safe arrival/departure time.

    Morning mode: looks for >= 5 predicted free docks (can you park?).
    Evening mode: looks for >= 5 predicted available bikes (can you ride home?).
    Since the model predicts empty_docks, evening availability is estimated as
    total_docks - predicted_empty_docks.
    """
    slots = scan["slots"]
    stations = scan["stations"]
    if not slots or not stations:
        return None

    last_safe_idx = None
    last_safe_station = None

    for i, slot in enumerate(slots):
        for sid, sdata in stations.items():
            preds = sdata["predictions"]
            if i >= len(preds) or preds[i] is None:
                continue

            if mode == "evening":
                # Bikes available ≈ total_docks - empty_docks
                total = sdata.get("total_docks", 20)
                available = total - preds[i]
                safe = available >= 5
            else:
                safe = preds[i] >= 5

            if safe:
                last_safe_idx = i
                last_safe_station = (sid, sdata["name"])
                break

    action = "Arrive by" if mode == "morning" else "Leave by"
    resource = "docks" if mode == "morning" else "bikes"

    if last_safe_idx is not None:
        time_str = slots[last_safe_idx]
        station_id, station_name = last_safe_station
        short_name = station_name.split(",")[0]
        return {
            "arrive_by": time_str,
            "reason": f"{action} {time_str} for {resource} at {short_name}.",
            "station_id": station_id,
            "urgency": "green" if last_safe_idx > len(slots) * 0.6 else "yellow",
        }

    return {
        "arrive_by": slots[0],
        "reason": f"All stations predicted full – {action.lower()} as early as possible.",
        "station_id": None,
        "urgency": "red",
    }


# ------------------------------------------------------------------
# Model Info
# ------------------------------------------------------------------

@api.route("/model-info")
def model_info():
    """Return model metadata and metrics for both forecast and nowcast."""
    fc = get_forecast_service()
    nc = get_nowcast_service()

    def _model_dict(svc):
        if svc is None:
            return None
        # Find this model's metrics in the saved list
        best_metrics = {}
        for m in svc.metrics:
            name = m.get("model", "")
            if svc.model_name in name:
                best_metrics = m
                break
        return {
            "name": svc.model_name,
            "type": svc.model_type,
            "horizon_min": svc.prediction_horizon_min,
            "features": svc.features,
            "mae": round(best_metrics.get("MAE", 0), 2),
            "rmse": round(best_metrics.get("RMSE", 0), 2),
            "r2": round(best_metrics.get("R2", 0), 4),
        }

    return jsonify({
        "available": fc is not None or nc is not None,
        "forecast": _model_dict(fc),
        "nowcast": _model_dict(nc),
    })


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


# ------------------------------------------------------------------
# Prediction Now (for Go tab – Now mode)
# ------------------------------------------------------------------

def _build_prediction_now():
    """Build the prediction-now data dict (shared by endpoint and Telegram)."""
    london = ZoneInfo("Europe/London")
    now_london = datetime.now(london)

    ensure_walking_distances()
    live = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.available_bikes,
            ba.standard_bikes, ba.ebikes, ba.empty_docks,
            ba.total_docks, ba.latitude, ba.longitude, ba.timestamp,
            ROUND(COALESCE(ms.walking_distance_m, ms.distance_m * 1.3)::numeric) AS walking_distance_m,
            ROUND(COALESCE(ms.walking_duration_s, ms.distance_m * 1.3 / 1.2)::numeric) AS walking_duration_s
        FROM bike_availability ba
        JOIN monitored_stations ms ON ba.station_id = ms.station_id
        ORDER BY ba.station_id, ba.timestamp DESC
    """)

    weather_row = query_one("""
        SELECT temperature, humidity, precipitation, wind_speed, description
        FROM weather_data ORDER BY timestamp DESC LIMIT 1
    """)
    weather = weather_row or {}

    temp = weather.get("temperature", 10)
    precip = weather.get("precipitation", 0)
    if precip and precip > 0.5:
        effect = "lower dock demand than usual"
    elif temp and temp > 20:
        effect = "higher dock demand – warm weather"
    else:
        effect = "typical dock demand"

    svc = get_nowcast_service() or get_forecast_service()
    pred_map = {}
    if svc:
        horizon = svc.prediction_horizon_min
        target_hour = (now_london.hour + now_london.minute / 60 + horizon / 60) % 24
        current_docks = {s["station_id"]: s["empty_docks"] for s in live}
        predictions = svc.predict_all_stations(
            [{"station_id": s["station_id"], "station_name": s["station_name"],
              "total_docks": s["total_docks"]} for s in live],
            weather, target_hour, now_london.weekday(),
            current_docks=current_docks,
        )
        for p in predictions:
            pred_map[p["station_id"]] = p["predicted_empty_docks"]

    station_list = []
    for i, s in enumerate(sorted(live, key=lambda x: x.get("walking_duration_s") or 9999)):
        sid = s["station_id"]
        predicted = pred_map.get(sid)
        walk_min = round((s.get("walking_duration_s") or 0) / 60)

        if predicted is not None:
            if predicted >= 5:
                status = "good"
            elif predicted >= 1:
                status = "low" if predicted < 3 else "moderate"
            else:
                status = "likely_full"
        else:
            empty = s.get("empty_docks") or 0
            predicted = float(empty)
            status = "good" if empty >= 5 else ("low" if empty >= 1 else "likely_full")

        station_list.append({
            "station_id": sid,
            "station_name": s["station_name"],
            "predicted_empty_docks": round(predicted, 1) if predicted is not None else 0,
            "confidence": 0.85,
            "walk_to_destination_min": walk_min,
            "preference_rank": i + 1,
            "is_recommended": False,
            "status": status,
        })

    recommended = None
    for st in station_list:
        if st["predicted_empty_docks"] >= 5:
            st["is_recommended"] = True
            recommended = {
                "station_id": st["station_id"],
                "station_name": st["station_name"],
                "predicted_empty_docks": st["predicted_empty_docks"],
                "confidence": st["confidence"],
                "walk_to_destination_min": st["walk_to_destination_min"],
                "total_trip_min": st["walk_to_destination_min"] + 15,
            }
            break

    if recommended is None and station_list:
        best = max(station_list, key=lambda x: x["predicted_empty_docks"])
        best["is_recommended"] = True
        recommended = {
            "station_id": best["station_id"],
            "station_name": best["station_name"],
            "predicted_empty_docks": best["predicted_empty_docks"],
            "confidence": best["confidence"],
            "walk_to_destination_min": best["walk_to_destination_min"],
            "total_trip_min": best["walk_to_destination_min"] + 15,
        }

    return {
        "timestamp": now_london.isoformat(),
        "mode": "arrive",
        "weather": {
            "temperature": weather.get("temperature", 0),
            "description": weather.get("description", "unknown"),
            "effect": effect,
        },
        "recommended": recommended,
        "stations": station_list,
    }


@api.route("/prediction/now")
@db_error_handler
def prediction_now():
    """Real-time prediction: recommended station + all station predictions."""
    return jsonify(_build_prediction_now())


# ------------------------------------------------------------------
# Prediction Plan (for Go tab – Plan mode)
# ------------------------------------------------------------------

@api.route("/prediction/plan", methods=["GET", "POST"])
@db_error_handler
def prediction_plan():
    """Plan trip: when to leave to find docks at arrival."""
    london = ZoneInfo("Europe/London")
    now_london = datetime.now(london)

    if request.is_json:
        data = request.get_json(silent=True) or {}
    else:
        data = {}

    arrive_by = data.get("arrive_by") or request.args.get("arrive_by")
    cycling_min = int(data.get("cycling_min", 15))

    # Default arrive_by: 30 min from now
    if arrive_by:
        try:
            arrive_dt = datetime.fromisoformat(arrive_by)
        except ValueError:
            arrive_dt = now_london + timedelta(minutes=30)
    else:
        arrive_dt = now_london + timedelta(minutes=30)

    target_hour = arrive_dt.hour + arrive_dt.minute / 60
    weekday = arrive_dt.weekday()

    # Get weather forecast
    target_date = arrive_dt.strftime("%Y-%m-%d")
    weather_by_hour = fetch_weather_forecast(target_date)
    weather_at_target = {}
    if weather_by_hour:
        nearest_h = min(weather_by_hour.keys(), key=lambda h: abs(h - target_hour))
        weather_at_target = weather_by_hour[nearest_h]
    else:
        row = query_one("""
            SELECT temperature, humidity, precipitation, wind_speed
            FROM weather_data ORDER BY timestamp DESC LIMIT 1
        """)
        weather_at_target = row or {}

    # Get stations with walking info
    ensure_walking_distances()
    all_stations = query("""
        SELECT DISTINCT ON (ba.station_id)
            ba.station_id, ba.station_name, ba.total_docks, ba.empty_docks,
            ROUND(COALESCE(ms.walking_distance_m, ms.distance_m * 1.3)::numeric) AS walking_distance_m,
            ROUND(COALESCE(ms.walking_duration_s, ms.distance_m * 1.3 / 1.2)::numeric) AS walking_duration_s
        FROM bike_availability ba
        JOIN monitored_stations ms ON ba.station_id = ms.station_id
        ORDER BY ba.station_id, ba.timestamp DESC
    """)

    # Run forecast model at target time
    svc = get_forecast_service() or get_nowcast_service()
    pred_map = {}
    if svc:
        predictions = svc.predict_all_stations(
            [{"station_id": s["station_id"], "station_name": s["station_name"],
              "total_docks": s["total_docks"]} for s in all_stations],
            weather_at_target, target_hour, weekday,
        )
        for p in predictions:
            pred_map[p["station_id"]] = p["predicted_empty_docks"]

    # Find best station (>= 5 docks, closest walk)
    candidates = []
    for s in sorted(all_stations, key=lambda x: x.get("walking_duration_s") or 9999):
        sid = s["station_id"]
        predicted = pred_map.get(sid, 0)
        walk_min = round((s.get("walking_duration_s") or 0) / 60)
        candidates.append({
            "station_id": sid,
            "station_name": s["station_name"],
            "predicted_empty_docks": round(predicted, 1),
            "walk_to_destination_min": walk_min,
            "confidence": 0.85,
        })

    recommended = None
    for c in candidates:
        if c["predicted_empty_docks"] >= 5:
            recommended = c
            break
    if recommended is None and candidates:
        recommended = max(candidates, key=lambda x: x["predicted_empty_docks"])

    # Compute leave_by time
    walk_min = recommended["walk_to_destination_min"] if recommended else 5
    dock_min = 4
    buffer_min = 3
    total_min = cycling_min + dock_min + walk_min + buffer_min
    leave_dt = arrive_dt - timedelta(minutes=total_min)

    # Build alternatives list
    alternatives = []
    for c in candidates[:5]:
        reason = "recommended" if recommended and c["station_id"] == recommended["station_id"] else (
            "predicted full" if c["predicted_empty_docks"] < 1 else
            "fewer than 5 docks" if c["predicted_empty_docks"] < 5 else
            "further walk"
        )
        alternatives.append({
            "station_name": c["station_name"],
            "predicted": c["predicted_empty_docks"],
            "confidence": c["confidence"],
            "reason": reason,
        })

    # Build why_not_closer explanation
    closer_full = [c for c in candidates[:3] if c["predicted_empty_docks"] < 5 and (
        recommended is None or c["station_id"] != recommended["station_id"])]
    why_parts = []
    for c in closer_full:
        short = c["station_name"].split(",")[0]
        if c["predicted_empty_docks"] < 1:
            why_parts.append(f"{short} predicted full")
        else:
            why_parts.append(f"{short} has only {c['predicted_empty_docks']:.0f} predicted dock(s)")
    if recommended:
        short_rec = recommended["station_name"].split(",")[0]
        why_parts.append(f"{short_rec} is the first station with 5+ predicted docks")
    why_not = ". ".join(why_parts) + "." if why_parts else ""

    return jsonify({
        "leave_by": leave_dt.isoformat(),
        "recommended_station": recommended,
        "breakdown": {
            "cycle_min": cycling_min,
            "dock_min": dock_min,
            "walk_min": walk_min,
            "buffer_min": buffer_min,
            "arrival_time": arrive_dt.isoformat(),
        },
        "alternatives_at_target_time": alternatives,
        "why_not_closer": why_not,
        "weather_forecast": {
            "temperature": weather_at_target.get("temperature", 0),
            "description": weather_at_target.get("description", "overcast"),
            "precipitation_mm": weather_at_target.get("precipitation", 0),
            "wind_speed": weather_at_target.get("wind_speed", 0),
        },
    })


# ------------------------------------------------------------------
# Insights: Chapter 1 - The Problem (morning docks + evening bikes)
# ------------------------------------------------------------------

PREFERRED_STATIONS = [
    'BikePoints_432', 'BikePoints_482', 'BikePoints_878',
    'BikePoints_356', 'BikePoints_428',
]

@api.route("/insights/ch1")
@db_error_handler
def insights_ch1():
    """Morning dock + evening bike profiles for 5 preferred stations."""
    station_ids = PREFERRED_STATIONS
    placeholders = ','.join(['%s'] * len(station_ids))

    # Morning empty docks (6am-2pm, weekdays, by station and hour)
    morning_rows = query(f"""
        SELECT station_name, station_id,
               EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
               ROUND(AVG(empty_docks)::numeric, 1) AS avg_empty_docks
        FROM bike_availability
        WHERE station_id IN ({placeholders})
          AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 6 AND 13
        GROUP BY station_name, station_id, hour
        ORDER BY station_id, hour
    """, station_ids)

    # Evening available bikes (2pm-9pm, weekdays, by station and hour)
    evening_rows = query(f"""
        SELECT station_name, station_id,
               EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
               ROUND(AVG(available_bikes)::numeric, 1) AS avg_bikes
        FROM bike_availability
        WHERE station_id IN ({placeholders})
          AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 14 AND 21
        GROUP BY station_name, station_id, hour
        ORDER BY station_id, hour
    """, station_ids)

    # Stat: earliest time any preferred station hits 0 empty docks (weekday avg)
    first_zero_row = query_one(f"""
        SELECT station_name,
               TO_CHAR(
                 MIN(timestamp AT TIME ZONE 'Europe/London')::time,
                 'HH24:MI'
               ) AS first_zero_time,
               COUNT(DISTINCT (timestamp AT TIME ZONE 'Europe/London')::date) AS days_hit_zero,
               (SELECT COUNT(DISTINCT (timestamp AT TIME ZONE 'Europe/London')::date)
                FROM bike_availability
                WHERE station_id IN ({placeholders})
                  AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
               ) AS total_weekdays
        FROM (
            SELECT station_name, timestamp,
                   ROW_NUMBER() OVER (
                       PARTITION BY station_id, (timestamp AT TIME ZONE 'Europe/London')::date
                       ORDER BY timestamp
                   ) AS rn
            FROM bike_availability
            WHERE station_id IN ({placeholders})
              AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
              AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 6 AND 14
              AND empty_docks = 0
        ) sub
        WHERE rn = 1
        GROUP BY station_name
        ORDER BY first_zero_time ASC
        LIMIT 1
    """, station_ids + station_ids)

    # Stat: avg empty docks across all 5 preferred at 9:30 (use hour=9)
    avg_930_row = query_one(f"""
        SELECT ROUND(AVG(empty_docks)::numeric, 1) AS avg_docks
        FROM bike_availability
        WHERE station_id IN ({placeholders})
          AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') = 9
          AND EXTRACT(MINUTE FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 25 AND 35
    """, station_ids)

    # Stat: avg available bikes across all 5 preferred at 6pm
    avg_6pm_row = query_one(f"""
        SELECT ROUND(AVG(available_bikes)::numeric, 1) AS avg_bikes
        FROM bike_availability
        WHERE station_id IN ({placeholders})
          AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') = 18
    """, station_ids)

    # Station count
    station_count = query_one("SELECT COUNT(*) AS cnt FROM monitored_stations")

    return jsonify({
        "morning": [dict(r) for r in morning_rows],
        "evening": [dict(r) for r in evening_rows],
        "stats": {
            "first_zero": first_zero_row if first_zero_row else None,
            "avg_docks_930": float(avg_930_row["avg_docks"]) if avg_930_row and avg_930_row.get("avg_docks") else None,
            "avg_bikes_6pm": float(avg_6pm_row["avg_bikes"]) if avg_6pm_row and avg_6pm_row.get("avg_bikes") else None,
            "station_count": station_count["cnt"] if station_count else 21,
        },
    })


# ------------------------------------------------------------------
# Insights: Chapter 3 - Data Sources
# ------------------------------------------------------------------

@api.route("/insights/ch3")
@db_error_handler
def insights_ch3():
    """Data source counts + sensor validation data."""
    row = query_one("""
        SELECT
            (SELECT COUNT(*) FROM bike_availability) AS bike_rows,
            (SELECT COUNT(*) FROM weather_data) AS weather_rows,
            (SELECT MIN(timestamp) FROM bike_availability) AS first_record,
            (SELECT MAX(timestamp) FROM bike_availability) AS last_record
    """)
    row = row or {}

    # Temperature sensor count + date range (column is created_at, not timestamp)
    temp_row = query_one("""
        SELECT COUNT(*) AS cnt,
               MIN(created_at) AS first_ts,
               MAX(created_at) AS last_ts
        FROM temperature_readings
    """) if _table_exists("temperature_readings") else None

    # Sensor validation: hourly averages from both sources for overlap period
    sensor_vs_api = []
    sensor_corr = None
    if _table_exists("temperature_readings"):
        sensor_vs_api = query("""
            SELECT
                DATE_TRUNC('hour', t.created_at) AS ts,
                ROUND(AVG(t.temperature_c)::numeric, 1) AS sensor_temp,
                ROUND(AVG(w.temperature)::numeric, 1) AS api_temp
            FROM temperature_readings t
            JOIN weather_data w ON DATE_TRUNC('hour', t.created_at) = DATE_TRUNC('hour', w.timestamp)
            GROUP BY DATE_TRUNC('hour', t.created_at)
            ORDER BY ts
        """)
        corr_row = query_one("""
            SELECT CORR(t.temperature_c, w.temperature) AS r
            FROM temperature_readings t
            JOIN weather_data w ON DATE_TRUNC('minute', t.created_at) = DATE_TRUNC('minute', w.timestamp)
        """)
        if corr_row and corr_row.get("r") is not None:
            sensor_corr = round(float(corr_row["r"]), 3)

    return jsonify({
        "bike_rows": row.get("bike_rows", 0),
        "weather_rows": row.get("weather_rows", 0),
        "temp_rows": temp_row["cnt"] if temp_row else 0,
        "temp_first": temp_row["first_ts"].isoformat() if temp_row and temp_row.get("first_ts") and isinstance(temp_row["first_ts"], datetime) else None,
        "temp_last": temp_row["last_ts"].isoformat() if temp_row and temp_row.get("last_ts") and isinstance(temp_row["last_ts"], datetime) else None,
        "first_record": row["first_record"].isoformat() if isinstance(row.get("first_record"), datetime) else None,
        "last_record": row["last_record"].isoformat() if isinstance(row.get("last_record"), datetime) else None,
        "sensor_vs_api": _serialise(sensor_vs_api),
        "sensor_corr": sensor_corr,
    })


# ------------------------------------------------------------------
# Insights: Chapter 4 - What Affects Dock Availability
# ------------------------------------------------------------------

@api.route("/insights/ch4")
@db_error_handler
def insights_ch4():
    """Heatmap, rain effect, station comparison at 9:30, fill timeline."""
    station_ids = PREFERRED_STATIONS
    placeholders = ','.join(['%s'] * len(station_ids))

    # Heatmap: hour x weekday for preferred stations
    heatmap_rows = query(f"""
        SELECT
            EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London')::int AS weekday,
            EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
            ROUND(AVG(empty_docks)::numeric, 1) AS avg_empty_docks
        FROM bike_availability
        WHERE station_id IN ({placeholders})
        GROUP BY weekday, hour
        ORDER BY weekday, hour
    """, station_ids)

    # Rain effect: dry vs rainy, 6am-2pm, weekdays, preferred stations
    dry_rows = query(f"""
        SELECT
            EXTRACT(HOUR FROM b.timestamp AT TIME ZONE 'Europe/London')::int AS hour,
            ROUND(AVG(b.empty_docks)::numeric, 1) AS avg_empty_docks
        FROM bike_availability b
        JOIN weather_data w ON DATE_TRUNC('minute', b.timestamp) = DATE_TRUNC('minute', w.timestamp)
        WHERE b.station_id IN ({placeholders})
          AND EXTRACT(DOW FROM b.timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM b.timestamp AT TIME ZONE 'Europe/London') BETWEEN 6 AND 13
          AND w.precipitation = 0
        GROUP BY hour ORDER BY hour
    """, station_ids)

    rainy_rows = query(f"""
        SELECT
            EXTRACT(HOUR FROM b.timestamp AT TIME ZONE 'Europe/London')::int AS hour,
            ROUND(AVG(b.empty_docks)::numeric, 1) AS avg_empty_docks
        FROM bike_availability b
        JOIN weather_data w ON DATE_TRUNC('minute', b.timestamp) = DATE_TRUNC('minute', w.timestamp)
        WHERE b.station_id IN ({placeholders})
          AND EXTRACT(DOW FROM b.timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM b.timestamp AT TIME ZONE 'Europe/London') BETWEEN 6 AND 13
          AND w.precipitation > 0
        GROUP BY hour ORDER BY hour
    """, station_ids)

    # Count dry vs rainy days
    rain_day_counts = query_one(f"""
        SELECT
            COUNT(DISTINCT CASE WHEN max_precip = 0 THEN day END) AS dry_days,
            COUNT(DISTINCT CASE WHEN max_precip > 0 THEN day END) AS rainy_days,
            COUNT(DISTINCT CASE WHEN max_precip > 0.5 THEN day END) AS heavy_rain_days
        FROM (
            SELECT
                (b.timestamp AT TIME ZONE 'Europe/London')::date AS day,
                MAX(w.precipitation) AS max_precip
            FROM bike_availability b
            JOIN weather_data w ON DATE_TRUNC('minute', b.timestamp) = DATE_TRUNC('minute', w.timestamp)
            WHERE b.station_id IN ({placeholders})
              AND EXTRACT(DOW FROM b.timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
            GROUP BY day
        ) sub
    """, station_ids)

    # Station comparison at 9:30 (all 21 stations)
    station_930 = query("""
        SELECT station_name, station_id,
               ROUND(AVG(empty_docks)::numeric, 1) AS avg_empty_docks
        FROM bike_availability
        WHERE EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') = 9
          AND EXTRACT(MINUTE FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 25 AND 35
        GROUP BY station_name, station_id
        ORDER BY avg_empty_docks DESC
    """)

    # Station fill timeline: hours when empty_docks < 3 for preferred + Imperial
    fill_station_ids = station_ids + ['BikePoints_392']
    fill_placeholders = ','.join(['%s'] * len(fill_station_ids))
    fill_timeline = query(f"""
        SELECT station_name, station_id,
               EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London')::int AS hour,
               ROUND(AVG(empty_docks)::numeric, 1) AS avg_empty_docks
        FROM bike_availability
        WHERE station_id IN ({fill_placeholders})
          AND EXTRACT(DOW FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 1 AND 5
          AND EXTRACT(HOUR FROM timestamp AT TIME ZONE 'Europe/London') BETWEEN 6 AND 16
        GROUP BY station_name, station_id, hour
        ORDER BY station_id, hour
    """, fill_station_ids)

    return jsonify({
        "heatmap": [{"weekday": r["weekday"], "hour": r["hour"],
                     "avg_empty_docks": float(r["avg_empty_docks"])} for r in heatmap_rows],
        "rain_dry": [dict(r) for r in dry_rows],
        "rain_wet": [dict(r) for r in rainy_rows],
        "rain_day_counts": dict(rain_day_counts) if rain_day_counts else {"dry_days": 0, "rainy_days": 0, "heavy_rain_days": 0},
        "station_930": [dict(r) for r in station_930],
        "fill_timeline": [dict(r) for r in fill_timeline],
    })


# ------------------------------------------------------------------
# Insights: Chapter 5 - The Prediction Models
# ------------------------------------------------------------------

@api.route("/insights/ch5")
@db_error_handler
def insights_ch5():
    """Model info + feature importance from real model."""
    fc = get_forecast_service()
    nc = get_nowcast_service()

    def _model_dict(svc):
        if svc is None:
            return None
        best_metrics = {}
        for m in svc.metrics:
            if svc.model_name in m.get("model", ""):
                best_metrics = m
                break
        return {
            "name": svc.model_name,
            "type": svc.model_type,
            "horizon_min": svc.prediction_horizon_min,
            "mae": round(best_metrics.get("MAE", 0), 2),
            "rmse": round(best_metrics.get("RMSE", 0), 2),
            "r2": round(best_metrics.get("R2", 0), 4),
            "features": svc.features,
        }

    # Feature importance from Nowcast (Random Forest)
    feature_importance = []
    if nc and hasattr(nc.model, "feature_importances_") and nc.model.feature_importances_ is not None:
        importances = nc.model.feature_importances_
        for feat, imp in sorted(zip(nc.features, importances), key=lambda x: -x[1]):
            feature_importance.append({"feature": feat, "importance": round(float(imp), 4)})

    return jsonify({
        "nowcast": _model_dict(nc),
        "forecast": _model_dict(fc),
        "feature_importance": feature_importance,
    })


# ------------------------------------------------------------------
# Weather: Current
# ------------------------------------------------------------------

@api.route("/weather/current")
@db_error_handler
def weather_current():
    """Most recent weather reading (matches frontend shape)."""
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
# Weather: Forecast
# ------------------------------------------------------------------

@api.route("/weather/forecast")
@db_error_handler
def weather_forecast_endpoint():
    """Hourly weather forecast from Open-Meteo."""
    london = ZoneInfo("Europe/London")
    target_date = request.args.get("date", datetime.now(london).strftime("%Y-%m-%d"))

    weather_by_hour = fetch_weather_forecast(target_date)

    hourly = []
    for h in range(24):
        w = weather_by_hour.get(h, {})
        precip = w.get("precipitation", 0) or 0
        hourly.append({
            "hour": h,
            "temperature": w.get("temperature", 0),
            "precipitation": precip,
            "wind_speed": w.get("wind_speed", 0),
            "description": "light rain" if precip > 0.2 else "overcast",
        })

    return jsonify({
        "date": target_date,
        "hourly": hourly,
    })


# ------------------------------------------------------------------
# Settings
# ------------------------------------------------------------------

@api.route("/settings", methods=["GET", "PUT"])
@db_error_handler
def settings_endpoint():
    """Return or update user settings (defaults + localStorage on frontend)."""
    if request.method == "PUT":
        # Settings are stored client-side in localStorage; just echo back
        data = request.get_json(silent=True) or {}
        return jsonify(data)

    # GET: return defaults
    station_rows = query("""
        SELECT station_id FROM monitored_stations ORDER BY distance_m
    """)
    station_ids = [r["station_id"] for r in station_rows]

    # Real Telegram status
    tg_connected = tg_configured()
    tg_last = None
    if tg_connected:
        tg_row = query_one("""
            SELECT timestamp FROM telegram_log
            ORDER BY timestamp DESC LIMIT 1
        """) if _table_exists("telegram_log") else None
        if tg_row and isinstance(tg_row.get("timestamp"), datetime):
            tg_last = tg_row["timestamp"].isoformat()

    # Real sensor status
    sensor_status = "offline"
    sensor_last = None
    sensor_count = 0
    if _table_exists("sensor_events"):
        sensor_row = query_one("""
            SELECT timestamp, event_type FROM sensor_events
            ORDER BY timestamp DESC LIMIT 1
        """)
        if sensor_row:
            sensor_status = "online"
            if isinstance(sensor_row.get("timestamp"), datetime):
                sensor_last = sensor_row["timestamp"].isoformat()
                # Check if last event was within 24h
                age = datetime.now(timezone.utc) - sensor_row["timestamp"]
                if age > timedelta(hours=24):
                    sensor_status = "offline"

        count_row = query_one("""
            SELECT COUNT(*) AS cnt FROM sensor_events
            WHERE timestamp > NOW() - INTERVAL '1 day'
        """)
        sensor_count = count_row["cnt"] if count_row else 0

    return jsonify({
        "station_order": station_ids,
        "commute": {
            "cycling_speed_min": 15,
            "destination": "Imperial College London",
            "destination_coords": {"lat": 51.4988, "lng": -0.1749},
        },
        "mode_auto_switch": True,
        "mode_switch_time": "12:00",
        "telegram": {
            "connected": tg_connected,
            "bot_name": "DockSenseBot",
            "last_message": tg_last,
        },
        "motion_sensor": {
            "status": sensor_status,
            "last_event": sensor_last,
            "events_today": sensor_count,
        },
        "appearance": "system",
    })


def _table_exists(table_name):
    """Check if a table exists in the database."""
    try:
        row = query_one("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = %s
            ) AS exists
        """, (table_name,))
        return row and row.get("exists", False)
    except Exception:
        return False


# ------------------------------------------------------------------
# Sensor Events (PIR motion trigger)
# ------------------------------------------------------------------

@api.route("/sensor-event", methods=["POST"])
@db_error_handler
def sensor_event():
    """Receive a sensor event (departure detected by PIR).

    Called by ESP32 or webhook when motion is detected.
    Stores event, runs prediction, sends Telegram notification.
    """
    data = request.get_json(silent=True) or {}
    event_type = data.get("event_type", "departure")
    confidence = data.get("confidence", 1.0)

    # Ensure sensor_events table exists
    _ensure_sensor_events_table()

    # Store the event
    execute("""
        INSERT INTO sensor_events (timestamp, event_type, confidence)
        VALUES (NOW(), %s, %s)
    """, (event_type, confidence))

    # Only send Telegram for departure events
    if event_type != "departure" or not tg_configured():
        return jsonify({"stored": True, "notified": False})

    # Get current prediction and send Telegram
    try:
        pred_data = _build_prediction_now()
    except Exception:
        pred_data = None

    notified = False
    if pred_data:
        notified = send_dock_alert(pred_data)
        if notified:
            _log_telegram_message("departure_alert")

    return jsonify({"stored": True, "notified": notified})


@api.route("/telegram/test", methods=["POST"])
@db_error_handler
def telegram_test():
    """Send a test notification with current prediction data."""
    if not tg_configured():
        return jsonify({"sent": False, "reason": "Telegram not configured"}), 400

    # Get current prediction and send via Telegram
    try:
        pred_data = _build_prediction_now()
    except Exception as e:
        return jsonify({"sent": False, "reason": f"prediction failed: {e}"}), 500

    if pred_data:
        sent = send_dock_alert(pred_data)
        if sent:
            _log_telegram_message("test")
        return jsonify({"sent": sent})

    return jsonify({"sent": False, "reason": "no prediction data"})


def _ensure_sensor_events_table():
    """Create the sensor_events table if it doesn't exist."""
    try:
        execute("""
            CREATE TABLE IF NOT EXISTS sensor_events (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                event_type TEXT NOT NULL DEFAULT 'departure',
                confidence FLOAT DEFAULT 1.0
            )
        """)
    except Exception as e:
        log.warning("Failed to ensure sensor_events table: %s", e)


def _log_telegram_message(msg_type="alert"):
    """Log a sent Telegram message for settings display."""
    try:
        execute("""
            CREATE TABLE IF NOT EXISTS telegram_log (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                message_type TEXT NOT NULL
            )
        """)
        execute("""
            INSERT INTO telegram_log (timestamp, message_type)
            VALUES (NOW(), %s)
        """, (msg_type,))
    except Exception as e:
        log.warning("Failed to log telegram message: %s", e)
