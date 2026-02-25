#!/usr/bin/env python3
"""
Smart-Commute Predictor – Bike Data Collector
Heroku Worker + Supabase PostgreSQL

Sammelt jede Minute die Verfügbarkeit der Santander Cycles Stationen
rund um Imperial College South Kensington.

Usage:
    python bike_collector.py              # Dauerbetrieb (jede Minute)
    python bike_collector.py --once       # Einmal sammeln
    python bike_collector.py --discover   # Stationen anzeigen
    python bike_collector.py --stats      # Statistiken anzeigen

Env vars (in .env oder Heroku Config Vars):
    DATABASE_URL=postgresql://user:pass@host:port/dbname
"""

import requests
import psycopg
import time
import sys
import os
import math
from datetime import datetime, timezone

# ============================================================
# KONFIGURATION
# ============================================================

IMPERIAL_LAT = 51.4988
IMPERIAL_LON = -0.1749
SEARCH_RADIUS_M = 800
POLL_INTERVAL = 60  # 1 Minute

TFL_BIKEPOINT_URL = "https://api.tfl.gov.uk/BikePoint"

# Supabase/PostgreSQL Connection String aus Environment Variable
DATABASE_URL = os.environ.get("DATABASE_URL", "")

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
        print("   Setze die Supabase Connection URL als Environment Variable.")
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
    """Erstellt die Tabellen falls noch nicht vorhanden."""
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bike_availability (
            id              SERIAL PRIMARY KEY,
            timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            station_id      TEXT NOT NULL,
            station_name    TEXT,
            available_bikes INTEGER,
            standard_bikes  INTEGER,
            ebikes          INTEGER,
            empty_docks     INTEGER,
            total_docks     INTEGER,
            latitude        DOUBLE PRECISION,
            longitude       DOUBLE PRECISION
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS monitored_stations (
            station_id      TEXT PRIMARY KEY,
            station_name    TEXT,
            latitude        DOUBLE PRECISION,
            longitude       DOUBLE PRECISION,
            distance_m      DOUBLE PRECISION
        )
    """)

    # Indices für schnelle Abfragen
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_bike_timestamp 
        ON bike_availability(timestamp)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_bike_station 
        ON bike_availability(station_id)
    """)

    cur.close()
    conn.close()
    print("[init] ✅ Datenbank-Tabellen bereit")

# ============================================================
# HILFSFUNKTIONEN
# ============================================================

def haversine(lat1, lon1, lat2, lon2):
    """Berechnet Distanz zwischen zwei Koordinaten in Metern."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def parse_properties(additional_properties):
    """Extrahiert relevante Felder aus additionalProperties."""
    props = {}
    for p in additional_properties:
        key = p.get("key", "")
        val = p.get("value", "")
        if key in ("NbBikes", "NbEBikes", "NbEmptyDocks", "NbDocks",
                    "NbStandardBikes", "Installed", "Locked"):
            props[key] = val
    return props

def fetch_all_stations():
    """Holt alle BikePoints von der TfL API (1 Request)."""
    resp = requests.get(TFL_BIKEPOINT_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()

# ============================================================
# STATION DISCOVERY
# ============================================================

def discover_stations():
    """Findet alle Stationen im Umkreis von Imperial College."""
    print(f"\n🔍 Suche Stationen im Umkreis von {SEARCH_RADIUS_M}m...")

    try:
        all_stations = fetch_all_stations()
    except requests.RequestException as e:
        print(f"❌ API-Fehler: {e}")
        return []

    nearby = []
    for station in all_stations:
        lat = station.get("lat", 0)
        lon = station.get("lon", 0)
        dist = haversine(IMPERIAL_LAT, IMPERIAL_LON, lat, lon)

        if dist <= SEARCH_RADIUS_M:
            props = parse_properties(
                station.get("additionalProperties", []))
            nearby.append({
                "station_id": station["id"],
                "station_name": station["commonName"],
                "latitude": lat,
                "longitude": lon,
                "distance_m": round(dist),
                "total_docks": props.get("NbDocks", "?"),
                "available_bikes": props.get("NbBikes", "?"),
                "ebikes": props.get("NbEBikes", "?"),
            })

    nearby.sort(key=lambda x: x["distance_m"])

    # In DB speichern
    conn = get_db()
    cur = conn.cursor()
    for s in nearby:
        cur.execute("""
            INSERT INTO monitored_stations 
                (station_id, station_name, latitude, longitude, distance_m)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (station_id) DO UPDATE SET
                station_name = EXCLUDED.station_name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                distance_m = EXCLUDED.distance_m
        """, (s["station_id"], s["station_name"], s["latitude"],
              s["longitude"], s["distance_m"]))
    cur.close()
    conn.close()

    print(f"\n📍 {len(nearby)} Stationen gefunden:\n")
    for i, s in enumerate(nearby, 1):
        print(f"  {i}. {s['station_name']} ({s['distance_m']}m) "
              f"– {s['total_docks']} docks, "
              f"{s['available_bikes']} bikes, "
              f"{s['ebikes']} e-bikes")
    print()
    return nearby

# ============================================================
# DATENSAMMLUNG
# ============================================================

def get_monitored_station_ids():
    """Lädt die Station-IDs aus der DB."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT station_id FROM monitored_stations")
    ids = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return ids

def collect_once():
    """Führt eine einzelne Datensammlung durch."""
    station_ids = get_monitored_station_ids()

    if not station_ids:
        print("[collect] Keine Stationen – starte Discovery...")
        discover_stations()
        station_ids = get_monitored_station_ids()
        if not station_ids:
            print("[collect] ❌ Konnte keine Stationen finden!")
            return "error"

    now_utc = datetime.now(timezone.utc)
    now_london = get_london_now()
    collected = 0

    try:
        all_stations = fetch_all_stations()
    except requests.RequestException as e:
        print(f"[collect] ❌ API-Fehler: {e}")
        return "error"

    station_map = {s["id"]: s for s in all_stations}

    conn = get_db()
    cur = conn.cursor()

    for sid in station_ids:
        station = station_map.get(sid)
        if not station:
            continue

        props = parse_properties(
            station.get("additionalProperties", []))

        if (props.get("Installed") == "false"
                or props.get("Locked") == "true"):
            continue

        cur.execute("""
            INSERT INTO bike_availability 
                (timestamp, station_id, station_name, available_bikes,
                 standard_bikes, ebikes, empty_docks, total_docks, 
                 latitude, longitude)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            now_utc,
            station["id"],
            station["commonName"],
            int(props.get("NbBikes", 0)),
            int(props.get("NbStandardBikes", 0)),
            int(props.get("NbEBikes", 0)),
            int(props.get("NbEmptyDocks", 0)),
            int(props.get("NbDocks", 0)),
            station["lat"],
            station["lon"],
        ))
        collected += 1

    cur.close()
    conn.close()

    print(f"[collect] ✅ {now_london.strftime('%H:%M:%S')} London – "
          f"{collected} Stationen gespeichert")
    return "ok"

# ============================================================
# LAUFMODI
# ============================================================

def run_continuous():
    """Dauerläufer – für Heroku Worker oder lokal."""
    print("\n" + "=" * 60)
    print("🚲 Smart-Commute Bike Collector")
    print(f"   Intervall:   {POLL_INTERVAL} Sekunden")
    print(f"   Modus:       Dauerbetrieb")
    print(f"   Datenbank:   Supabase PostgreSQL")
    print("=" * 60 + "\n")

    # Sicherstellen dass Stationen vorhanden sind
    if not get_monitored_station_ids():
        discover_stations()

    while True:
        try:
            collect_once()
        except Exception as e:
            print(f"[error] {e} – versuche in 60s erneut...")
        time.sleep(POLL_INTERVAL)

# ============================================================
# STATISTIKEN
# ============================================================

def show_stats():
    """Zeigt eine Übersicht der gesammelten Daten."""
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM bike_availability")
    total = cur.fetchone()[0]

    if total == 0:
        print("\n📊 Noch keine Daten gesammelt.")
        cur.close()
        conn.close()
        return

    cur.execute("SELECT COUNT(DISTINCT station_id) FROM bike_availability")
    stations = cur.fetchone()[0]

    cur.execute("SELECT MIN(timestamp), MAX(timestamp) FROM bike_availability")
    first, last = cur.fetchone()

    days = (last - first).days + 1 if first and last else "?"

    print(f"\n📊 Daten-Statistiken:")
    print(f"   Datenpunkte:    {total:,}")
    print(f"   Stationen:      {stations}")
    print(f"   Sammeldauer:    {days} Tag(e)")
    print(f"   Erster Eintrag: {first}")
    print(f"   Letzter Eintrag:{last}")

    print(f"\n   {'Station':<42} {'Einträge':>8}  "
          f"{'Ø Bikes':>7}  {'Ø E-Bikes':>9}")
    print("   " + "-" * 72)

    cur.execute("""
        SELECT station_name, COUNT(*), 
               ROUND(AVG(available_bikes)::numeric, 1),
               ROUND(AVG(ebikes)::numeric, 1)
        FROM bike_availability
        GROUP BY station_id, station_name 
        ORDER BY station_name
    """)
    for name, count, avg_bikes, avg_ebikes in cur.fetchall():
        print(f"   {name:<42} {count:>8}  "
              f"{avg_bikes:>7}  {avg_ebikes:>9}")

    cur.close()
    conn.close()
    print()

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    print(f"[main] Args: {sys.argv[1:]}")

    init_db()

    if "--discover" in sys.argv:
        discover_stations()
    elif "--stats" in sys.argv:
        show_stats()
    elif "--once" in sys.argv:
        collect_once()
    else:
        run_continuous()
