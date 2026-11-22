#!/usr/bin/env python3
"""Writes fixtures/entries.jsonl, the sample of entries CI builds from (site/scripts/db.ts --entries).

It covers every source, every discussed record and the records its links point to, each optional field,
and the records search.test.ts looks for. Rerun it when the entries change shape:

    set -a; . site/.env.local; set +a; python3 fixtures/make.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "indexer"))
import sources as S  # noqa: E402
import store  # noqa: E402

PER_SOURCE = 40  # the first, by id, of each source
PER_FIELD = 20  # entries that carry each of these fields
FIELDS = ("review", "withdrawn", "formalizes", "ai_models", "authorship")
# What search.test.ts searches for: titles with "lattice", Claude as an author, "zero-free" in an abstract.
NAMED = ("entry->>'title' ILIKE '%%lattice%%'", "entry->>'authors' ILIKE '%%claude%%'", "entry->>'summary' ILIKE '%%zero-free%%'")


def sample() -> list[dict]:
    keep: dict[str, dict] = {}
    for (source,) in store.conn().execute("SELECT DISTINCT source FROM open_index.entries"):
        keep.update((r.id, e) for r, e in store.load("source = %s", [source], PER_SOURCE))
    for field in FIELDS:
        keep.update((r.id, e) for r, e in store.load("entry ? %s", [field], PER_FIELD))
    for where in NAMED:
        keep.update((r.id, e) for r, e in store.load(where, limit=6))
    discussed = store.load("jsonb_typeof(entry->'discussion') = 'array' OR entry ? 'reception'")
    keep.update((r.id, e) for r, e in discussed)
    for _, e in discussed:  # a response that is itself a record, so the build crosslinks them
        for d in e.get("discussion") or []:
            try:
                src, key = S.detect(d["url"])
            except ValueError:
                continue
            if found := store.get(f"{src.name}/{key}"):
                keep[found[0].id] = found[1]
    return [keep[i] for i in sorted(keep)]


if __name__ == "__main__":
    entries = sample()
    (HERE / "entries.jsonl").write_text("".join(json.dumps(e, ensure_ascii=False, sort_keys=True) + "\n" for e in entries))
    print(f"fixtures/entries.jsonl: {len(entries)} entries, " + ", ".join(f"{k} {v}" for k, v in Counter(e["source"] for e in entries).most_common()))
