"""Forecast service – loads trained models and predicts dock availability.

Two models:
  - FORECAST: temporal + weather + station (for Plan page, predicting hours ahead)
  - NOWCAST:  same + current empty_docks  (for Now page, predicting 15 min ahead)
"""

import logging
import math
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests


# ---------------------------------------------------------------------------
# HistoricalAverageModel -- must match the class in train_model.py so that
# pickled Baseline models can be deserialised.
# ---------------------------------------------------------------------------

TARGET = "target"


class HistoricalAverageModel:
    """Predicts empty_docks as the mean for each (station, hour, weekday)."""

    def __init__(self):
        self.lookup = {}
        self.global_mean = 0

    def fit(self, X, y, df=None):
        if df is None:
            raise ValueError("HistoricalAverageModel.fit() needs df= parameter")
        self.global_mean = y.mean()
        tmp = df.copy()
        tmp["_hour_int"] = tmp["hour"].round().astype(int) % 24
        grouped = tmp.groupby(["station_enc", "_hour_int", "weekday"])[TARGET].mean()
        self.lookup = grouped.to_dict()
        return self

    def predict(self, X):
        preds = []
        for _, row in X.iterrows():
            key = (row["station_enc"], round(row["hour"]) % 24, row["weekday"])
            preds.append(self.lookup.get(key, self.global_mean))
        return np.array(preds)

    @property
    def feature_importances_(self):
        return None


def _load_model(path):
    """Load a joblib model, handling __main__ pickle references."""
    import sys
    # Temporarily inject HistoricalAverageModel into __main__ so pickle can
    # find it (the training script ran as __main__).
    main_mod = sys.modules.get("__main__")
    had_attr = hasattr(main_mod, "HistoricalAverageModel")
    if not had_attr:
        setattr(main_mod, "HistoricalAverageModel", HistoricalAverageModel)
    try:
        return joblib.load(path)
    finally:
        if not had_attr and main_mod is not None:
            try:
                delattr(main_mod, "HistoricalAverageModel")
            except AttributeError:
                pass

TRAINING_DIR = Path(__file__).resolve().parent.parent / "training"
FORECAST_PATH = TRAINING_DIR / "model_forecast.pkl"
NOWCAST_PATH = TRAINING_DIR / "model_nowcast.pkl"
LEGACY_PATH = TRAINING_DIR / "model.pkl"

_forecast_service = None
_nowcast_service = None
log = logging.getLogger(__name__)


class ForecastService:
    """Wraps a trained model for dock predictions."""

    def __init__(self, model_path):
        if not model_path.exists():
            raise FileNotFoundError(f"Model not found: {model_path}")

        bundle = _load_model(model_path)
        self.model = bundle["model"]
        self.features = bundle["features"]
        self.label_encoder = bundle["label_encoder"]
        self.model_name = bundle.get("model_name", "unknown")
        self.model_type = bundle.get("model_type", "forecast")
        self.prediction_horizon_min = bundle.get("prediction_horizon_min", 60)
        self.metrics = bundle.get("metrics", [])
        self._known_stations = set(self.label_encoder.classes_)
        self._needs_lag = "empty_docks_lag1" in self.features

    def predict(self, station_id, total_docks, hour, weekday, weather,
                current_empty_docks=None):
        """Predict empty_docks for a single station.

        Args:
            station_id: e.g. "BikePoints_809"
            total_docks: station capacity
            hour: fractional hour (e.g. 8.25 = 08:15)
            weekday: 0=Mon .. 6=Sun
            weather: dict with temperature, humidity, precipitation, wind_speed
            current_empty_docks: current empty docks (required for nowcast model)

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

        if self._needs_lag:
            row["empty_docks_lag1"] = current_empty_docks if current_empty_docks is not None else 0

        X = pd.DataFrame([row])[self.features]
        pred = self.model.predict(X)[0]
        return float(np.clip(pred, 0, total_docks))

    def predict_all_stations(self, stations, weather, hour, weekday,
                             current_docks=None):
        """Predict for a list of stations.

        Args:
            stations: list of dicts with station_id, total_docks, station_name
            weather: dict with temperature, humidity, precipitation, wind_speed
            hour: fractional hour
            weekday: 0=Mon .. 6=Sun
            current_docks: dict mapping station_id -> current empty_docks
                           (only used by nowcast model)

        Returns:
            list of prediction dicts.
        """
        current_docks = current_docks or {}
        results = []
        for s in stations:
            sid = s["station_id"]
            pred = self.predict(
                sid, s["total_docks"], hour, weekday, weather,
                current_empty_docks=current_docks.get(sid),
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
                "station_id": sid,
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
            dict with "slots" and "stations".
        """
        horizon = self.prediction_horizon_min
        step = step_min / 60.0
        slots = []
        station_preds = {}

        for s in stations:
            if s["station_id"] in self._known_stations:
                station_preds[s["station_id"]] = {
                    "name": s["station_name"],
                    "total_docks": s["total_docks"],
                    "predictions": [],
                }

        t = start_hour
        while t <= end_hour + 0.001:
            input_hour = t - horizon / 60.0
            if input_hour < 0:
                input_hour += 24

            display_h = int(t) % 24
            display_m = int(round((t - int(t)) * 60))
            slots.append(f"{display_h:02d}:{display_m:02d}")

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
    """Fetch hourly weather forecast from Open-Meteo for a given date."""
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
    """Lazy singleton for the FORECAST model (Plan page)."""
    global _forecast_service
    if _forecast_service is None:
        try:
            if FORECAST_PATH.exists():
                _forecast_service = ForecastService(FORECAST_PATH)
            elif LEGACY_PATH.exists():
                _forecast_service = ForecastService(LEGACY_PATH)
        except FileNotFoundError:
            return None
    return _forecast_service


def get_nowcast_service():
    """Lazy singleton for the NOWCAST model (Now page)."""
    global _nowcast_service
    if _nowcast_service is None:
        try:
            if NOWCAST_PATH.exists():
                _nowcast_service = ForecastService(NOWCAST_PATH)
        except FileNotFoundError:
            return None
    return _nowcast_service
