#!/usr/bin/env python3
"""
Smart-Commute Predictor – Combined Worker
Läuft auf Heroku als einzelner Worker Dyno und steuert beide Collector.

- bike_collector:    jede Minute
- weather_collector: alle 15 Minuten
"""

import time
import sys
from datetime import datetime, timezone

import bike_collector
import weather_collector

def main():
    print("\n" + "=" * 60)
    print("🚲🌤️  Smart-Commute Combined Worker")
    print(f"   Bikes:    alle {bike_collector.POLL_INTERVAL}s")
    print(f"   Wetter:   alle {weather_collector.POLL_INTERVAL}s (15 Min)")
    print(f"   Datenbank: Supabase PostgreSQL")
    print("=" * 60 + "\n")

    # Tabellen erstellen
    bike_collector.init_db()
    weather_collector.init_db()

    # Stationen entdecken falls nötig
    if not bike_collector.get_monitored_station_ids():
        bike_collector.discover_stations()

    tick = 0
    weather_interval = weather_collector.POLL_INTERVAL // bike_collector.POLL_INTERVAL  # 15

    while True:
        # Bikes: jede Minute
        try:
            bike_collector.collect_once()
        except Exception as e:
            print(f"[bike-error] {e}")

        # Wetter: alle 15 Minuten (tick 0, 15, 30, ...)
        if tick % weather_interval == 0:
            try:
                weather_collector.collect_once()
            except Exception as e:
                print(f"[weather-error] {e}")

        tick += 1
        time.sleep(bike_collector.POLL_INTERVAL)

if __name__ == "__main__":
    main()
