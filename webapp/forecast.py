"""Forecast service – loads the trained model and predicts dock availability."""

import logging
import math
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests

MODEL_PATH = Path(__file__).resolve().parent.parent / "training" / "model.pkl"

_service = None
log = logging.getLogger(__name__)


class ForecastService:
    """Wraps the trained model for dock predictions."""

    def __init__(self):
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

        bundle = joblib.load(MODEL_PATH)
        self.model = bundle["model"]
        self.features = bundle["features"]
        self.label_encoder = bundle["label_encoder"]
        self.model_name = bundle.get("model_name", "unknown")
        self.prediction_horizon_min = bundle.get("prediction_horizon_min", 60)
        # Set of station_ids the encoder was trained on
        self._known_stations = set(self.label_encoder.classes_)

    def predict(self, station_id, total_docks, hour, weekday, weather):
        """Predict empty_docks for a single station.

        Args:
            station_id: e.g. "BikePoints_809"
            total_docks: station capacity
            hour: fractional hour (e.g. 8.25 = 08:15)
            weekday: 0=Mon .. 6=Sun
            weather: dict with temperature, humidity, precipitation, wind_speed

        Returns:
            Predicted empty_docks (float), or None if station is unknown.
        """
        if station_id not in self._known_stations:
            return None

        station_enc = self.label_encoder.transform([station_id])[0]

        row = {
            "hour": hour,
            "hour_sin": math.sin(2 * math.pi * hour / 24),
            "hour_cos": math.cos(2 * math.pi * hour / 24),
            "weekday": weekday,
            "is_weekend": 1 if weekday >= 5 else 0,
            "temperature": weather.get("temperature", 10),
            "humidity": weather.get("humidity", 70),
            "precipitation": weather.get("precipitation", 0),
            "wind_speed": weather.get("wind_speed", 3),
            "station_enc": station_enc,
            "total_docks": total_docks,
        }

        X = pd.DataFrame([row])[self.features]
        pred = self.model.predict(X)[0]
        # Clamp to [0, total_docks]
        return float(np.clip(pred, 0, total_docks))

    def predict_all_stations(self, stations, weather, hour, weekday):
        """Predict for a list of stations.

        Args:
            stations: list of dicts with station_id, total_docks, station_name
            weather: dict with temperature, humidity, precipitation, wind_speed
            hour: fractional hour (e.g. 8.25)
            weekday: 0=Mon .. 6=Sun

        Returns:
            list of dicts with station_id, station_name, predicted_empty_docks,
            predicted_status.
        """
        results = []
        for s in stations:
            pred = self.predict(
                s["station_id"], s["total_docks"], hour, weekday, weather,
            )
            if pred is None:
                continue

            predicted = round(pred, 1)
            if predicted >= 5:
                status = "green"
            elif predicted >= 1:
                status = "yellow"
            else:
                status = "red"

            results.append({
                "station_id": s["station_id"],
                "station_name": s["station_name"],
                "predicted_empty_docks": predicted,
                "predicted_status": status,
            })

        return results

    def scan_time_range(self, stations, weather_by_hour, weekday,
                        start_hour, end_hour, step_min=5):
        """Scan a time range in steps and predict for each station.

        Args:
            stations: list of dicts with station_id, total_docks, station_name
            weather_by_hour: dict mapping int hour -> weather dict
            weekday: 0=Mon .. 6=Sun
            start_hour: float (e.g. 8.0)
            end_hour: float (e.g. 10.0)
            step_min: step size in minutes (default 5)

        Returns:
            dict with "slots" (list of "HH:MM" strings) and
            "stations" (dict station_id -> {name, predictions: [floats]})
        """
        horizon = self.prediction_horizon_min
        step = step_min / 60.0
        slots = []
        station_preds = {}

        # Initialise per-station result structure
        for s in stations:
            if s["station_id"] in self._known_stations:
                station_preds[s["station_id"]] = {
                    "name": s["station_name"],
                    "total_docks": s["total_docks"],
                    "predictions": [],
                }

        t = start_hour
        while t <= end_hour + 0.001:
            # The model predicts for T+horizon, so input time = display_time - horizon
            input_hour = t - horizon / 60.0
            if input_hour < 0:
                input_hour += 24

            # Display time label
            display_h = int(t) % 24
            display_m = int(round((t - int(t)) * 60))
            slots.append(f"{display_h:02d}:{display_m:02d}")

            # Pick weather for the nearest whole hour
            weather_hour = round(t) % 24
            weather = weather_by_hour.get(weather_hour,
                                          weather_by_hour.get(
                                              min(weather_by_hour.keys(),
                                                  key=lambda h: abs(h - weather_hour)),
                                              {})) if weather_by_hour else {}

            for s in stations:
                sid = s["station_id"]
                if sid not in station_preds:
                    continue
                pred = self.predict(sid, s["total_docks"], input_hour, weekday, weather)
                station_preds[sid]["predictions"].append(
                    round(pred, 1) if pred is not None else None
                )

            t += step

        return {"slots": slots, "stations": station_preds}


def fetch_weather_forecast(date_str):
    """Fetch hourly weather forecast from Open-Meteo for a given date.

    Args:
        date_str: ISO date string, e.g. "2026-02-27"

    Returns:
        dict mapping int hour (0-23) to weather dict, or {} on error.
    """
    try:
        resp = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 51.4988,
                "longitude": -0.1749,
                "hourly": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
                "start_date": date_str,
                "end_date": date_str,
                "timezone": "Europe/London",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("hourly", {})
        times = data.get("time", [])
        result = {}
        for i, t in enumerate(times):
            hour = int(t.split("T")[1].split(":")[0])
            result[hour] = {
                "temperature": data.get("temperature_2m", [None])[i],
                "humidity": data.get("relative_humidity_2m", [None])[i],
                "precipitation": data.get("precipitation", [None])[i],
                "wind_speed": data.get("wind_speed_10m", [None])[i],
            }
        return result
    except Exception as e:
        log.warning("Failed to fetch weather forecast: %s", e)
        return {}


def get_forecast_service():
    """Lazy singleton – loads model on first call."""
    global _service
    if _service is None:
        try:
            _service = ForecastService()
        except FileNotFoundError:
            return None
    return _service
