"""Shared database helper for the Flask webapp."""

import os
import psycopg
from urllib.parse import urlparse

DATABASE_URL = os.environ.get("DATABASE_URL", "")


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
