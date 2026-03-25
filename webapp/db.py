"""Shared database helper for the Flask webapp."""

import os
import requests
import psycopg
from urllib.parse import urlparse

DATABASE_URL = os.environ.get("DATABASE_URL", "")

IMPERIAL_LAT = 51.498099
IMPERIAL_LON = -0.174956
OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/foot"


def get_db():
    """Creates a new database connection to Supabase PostgreSQL."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not set")

    parsed = urlparse(DATABASE_URL)
    return psycopg.connect(
        host=parsed.hostname,
        port=parsed.port,
        user=parsed.username,
        password=parsed.password,
        dbname=parsed.path.lstrip("/"),
        sslmode="require",
        connect_timeout=10,
        autocommit=True,
        prepare_threshold=None,
    )


def query(sql, params=None):
    """Execute a read query and return list of dicts."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(sql, params or ())
    columns = [desc[0] for desc in cur.description]
    rows = []
    for row in cur.fetchall():
        d = {}
        for col, val in zip(columns, row):
            d[col] = val
        rows.append(d)
    cur.close()
    conn.close()
    return rows


def execute(sql, params=None):
    """Execute a write query (INSERT/UPDATE/DELETE). Returns row count."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(sql, params or ())
    rowcount = cur.rowcount
    cur.close()
    conn.close()
    return rowcount


def query_one(sql, params=None):
    """Execute a read query and return a single dict or None."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute(sql, params or ())
    row = cur.fetchone()
    if row is None:
        cur.close()
        conn.close()
        return None
    columns = [desc[0] for desc in cur.description]
    d = {}
    for col, val in zip(columns, row):
        d[col] = val
    cur.close()
    conn.close()
    return d


# ------------------------------------------------------------------
# Walking distance via OSRM
# ------------------------------------------------------------------

def ensure_walking_distances():
    """Compute walking distances from Imperial College to all stations via OSRM.

    Adds `walking_distance_m` and `walking_duration_s` columns if missing,
    then fills NULLs using the OSRM Table API (free, no key needed).
    Falls back to straight-line distance on error.
    """
    conn = get_db()
    cur = conn.cursor()

    # Add columns if they don't exist
    cur.execute("""
        ALTER TABLE monitored_stations
        ADD COLUMN IF NOT EXISTS walking_distance_m DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS walking_duration_s DOUBLE PRECISION
    """)

    # Check if any stations are missing walking data
    cur.execute("""
        SELECT station_id, latitude, longitude
        FROM monitored_stations
        WHERE walking_distance_m IS NULL
        ORDER BY distance_m
    """)
    missing = cur.fetchall()

    if not missing:
        cur.close()
        conn.close()
        return  # All computed already

    # Build OSRM Table API request
    # Format: lon,lat;lon,lat;... (Imperial first, then all stations)
    coords = [f"{IMPERIAL_LON},{IMPERIAL_LAT}"]
    for _, lat, lon in missing:
        coords.append(f"{lon},{lat}")

    coord_str = ";".join(coords)
    url = f"{OSRM_TABLE_URL}/{coord_str}?sources=0&annotations=distance,duration"

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != "Ok":
            raise ValueError(f"OSRM error: {data.get('code')}")

        distances = data["distances"][0]   # from Imperial to all
        durations = data["durations"][0]

        for i, (station_id, _, _) in enumerate(missing):
            walk_dist = distances[i + 1]   # +1 because index 0 is Imperial itself
            walk_dur = durations[i + 1]
            cur.execute("""
                UPDATE monitored_stations
                SET walking_distance_m = %s, walking_duration_s = %s
                WHERE station_id = %s
            """, (round(walk_dist), round(walk_dur), station_id))

        print(f"[walking] Updated {len(missing)} stations with OSRM walking distances")

    except Exception as e:
        print(f"[walking] OSRM failed ({e}), falling back to straight-line distance")
        for station_id, _, _ in missing:
            cur.execute("""
                UPDATE monitored_stations
                SET walking_distance_m = distance_m * 1.3,
                    walking_duration_s = distance_m * 1.3 / 1.2
                WHERE station_id = %s
            """, (station_id,))

    cur.close()
    conn.close()
