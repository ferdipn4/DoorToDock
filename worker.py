#!/usr/bin/env python3
"""
Smart-Commute Predictor – Combined Worker
Läuft auf Heroku als einzelner Worker Dyno und steuert beide Collector.

- bike_collector:    jede Minute
- weather_collector: jede Minute
"""

import time

import bike_collector
import weather_collector

POLL_INTERVAL = 60  # 1 Minute

def main():
    print("\n" + "=" * 60)
    print("🚲🌤️  Smart-Commute Combined Worker")
    print(f"   Bikes:    alle {POLL_INTERVAL}s")
    print(f"   Wetter:   alle {POLL_INTERVAL}s")
    print(f"   Datenbank: Supabase PostgreSQL")
    print("=" * 60 + "\n")

    # Tabellen erstellen
    bike_collector.init_db()
    weather_collector.init_db()

    # Stationen entdecken falls nötig
    if not bike_collector.get_monitored_station_ids():
        bike_collector.discover_stations()

    while True:
        try:
            bike_collector.collect_once()
        except Exception as e:
            print(f"[bike-error] {e}")

        try:
            weather_collector.collect_once()
        except Exception as e:
            print(f"[weather-error] {e}")

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
