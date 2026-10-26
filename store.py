"""The entries, one per record, in Postgres (open_index.entries): what index.py harvests, labels, refreshes and
annotates, and builds. The database is SUPABASE_DB_URL, or DATABASE_URL (site/.env.local has both); the tests and
CI serve one from PGlite instead (site/scripts/db.ts).

Every save carries the version its entry was read at, so two runs that change one entry (the daily pull and a
person's discuss) cannot overwrite each other: the later save is refused with Conflict, to run again on the new
version. Each version an update replaces is kept in open_index.entry_history. Every entry written is checked
against the Entry schema of the API's document (schema.py), as the site checks the ones it writes.
"""

from __future__ import annotations

import os
from typing import Any, Iterable, NamedTuple

import psycopg
from psycopg.types.json import Jsonb

import schema


class Ref(NamedTuple):
    """Where an entry is stored: its id (<source>/<key>) and the version it was read at; None if not stored yet."""

    id: str
    version: int | None = None


class Conflict(Exception):
    """The entry changed, or was added, after it was read."""


URL: str | None = None  # set by use(); else read from the environment on the first query
_conn: psycopg.Connection | None = None


def use(url: str) -> None:
    """Point the store at this database (tests, and building from a local copy)."""
    global URL, _conn
    if _conn:
        _conn.close()
    URL, _conn = url, None


def conn() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed:
        url = URL or os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
        if not url:
            raise SystemExit("set SUPABASE_DB_URL to the database that holds the entries (site/.env.local has it: "
                             "set -a; . site/.env.local; set +a)")
        # Supabase's pooler runs in transaction mode, which cannot keep prepared statements between queries.
        _conn = psycopg.connect(url, autocommit=True, prepare_threshold=None)
    return _conn


ID_ORDER = 'id COLLATE "C"'


def load(where: str = "true", params: Iterable[Any] = (), limit: int | None = None, order: str = ID_ORDER) -> list[tuple[Ref, dict[str, Any]]]:
    """The entries that match a condition on `entry` (jsonb) or `source`, in id order (or `order`); the first `limit`
    of them. The order is by bytes, as Python sorts, not by the database's locale, so a build comes out the same anywhere."""
    rows = conn().execute(f"SELECT id, version, entry FROM open_index.entries WHERE {where} ORDER BY {order} LIMIT %s",
                          [*params, limit])
    return [(Ref(i, v), e) for i, v, e in rows]


def get(record: str) -> tuple[Ref, dict[str, Any]] | None:
    row = conn().execute("SELECT id, version, entry FROM open_index.entries WHERE id = %s", [record]).fetchone()
    return (Ref(row[0], row[1]), row[2]) if row else None


def ids() -> set[str]:
    return {i for (i,) in conn().execute("SELECT id FROM open_index.entries")}


def secret(name: str) -> str | None:
    """A secret in Supabase Vault (the DeepSeek key), or None; a copy without Vault (PGlite) has none."""
    try:
        row = conn().execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = %s", [name]).fetchone()
    except (psycopg.errors.UndefinedTable, psycopg.errors.InvalidSchemaName):
        return None
    return row[0] if row else None


def checked(record: str, entry: dict[str, Any]) -> Jsonb:
    """The entry, ready to store, once it fits the Entry schema and its id: ValueError otherwise."""
    schema.check(entry, "Entry", record)
    if record != f"{entry['source']}/{entry['key']}":
        raise ValueError(f"{record} is stored as {entry['source']}/{entry['key']}: an entry's id is <source>/<key>")
    return Jsonb(entry)


def save(ref: Ref, entry: dict[str, Any]) -> Ref:
    """Stores an entry: a new one (ref.version None), or a new version of the one read at ref.version."""
    data = checked(ref.id, entry)
    if ref.version is None:
        row = conn().execute("INSERT INTO open_index.entries (id, entry) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING RETURNING version",
                             [ref.id, data]).fetchone()
    else:
        row = conn().execute("UPDATE open_index.entries SET entry = %s, version = version + 1, updated_at = now() "
                             "WHERE id = %s AND version = %s RETURNING version", [data, ref.id, ref.version]).fetchone()
    if not row:
        raise Conflict(f"{ref.id} was {'added' if ref.version is None else 'changed'} by another run after this one read it; run this again")
    return Ref(ref.id, row[0])


def add_all(entries: list[tuple[str, dict[str, Any]]]) -> int:
    """Stores new entries in one round trip, leaving any id already stored as it is. Returns how many were new."""
    if not entries:
        return 0
    data = [checked(i, e) for i, e in entries]
    with conn().cursor() as cur:
        cur.execute("INSERT INTO open_index.entries (id, entry) SELECT * FROM unnest(%s::text[], %s::jsonb[]) ON CONFLICT (id) DO NOTHING",
                    [[i for i, _ in entries], data])
        return cur.rowcount


def added_today(login: str, day: str) -> int:
    """How many entries a person added on a day (YYYY-MM-DD), on the site or with index.py add."""
    return conn().execute("SELECT count(*) FROM open_index.entries WHERE entry->>'added_by' = %s AND entry->>'added' = %s",
                          [login, day]).fetchone()[0]
