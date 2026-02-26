"""Forecast service – loads the trained model and predicts dock availability."""

import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

MODEL_PATH = Path(__file__).resolve().parent.parent / "training" / "model.pkl"

_service = None


class ForecastService:
    """Wraps the trained Gradient Boosting model for dock predictions."""

    def __init__(self):
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

        bundle = joblib.load(MODEL_PATH)
        self.model = bundle["model"]
        self.features = bundle["features"]
        self.label_encoder = bundle["label_encoder"]
        self.model_name = bundle.get("model_name", "unknown")
        # Set of station_ids the encoder was trained on
        self._known_stations = set(self.label_encoder.classes_)

    def predict(self, station_id, total_docks, hour, weekday, weather):
        """Predict empty_docks for a single station.

        Args:
            station_id: e.g. "BikePoints_809"
            total_docks: station capacity
            hour: 0-23
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
            hour: 0-23
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


def get_forecast_service():
    """Lazy singleton – loads model on first call."""
    global _service
    if _service is None:
        try:
            _service = ForecastService()
        except FileNotFoundError:
            return None
    return _service
