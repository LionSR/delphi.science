"""The schemas of site/openapi.json (written from site/lib/openapi.ts by `npm run openapi`), checked from Python:
store.py checks every Entry it writes, and index.py build every Record it serves, so the harvester and the site
agree on both. Standard library only; it covers the keywords the document uses. Objects are checked closed: a
field the schema does not list is a problem, so nothing is stored or served that the document leaves out.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

SPEC = json.loads((Path(__file__).resolve().parent / "site" / "openapi.json").read_text())
TYPES: dict[str, type | tuple[type, ...]] = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float),
                                            "boolean": bool, "null": type(None)}


def _date(s: str) -> bool:
    try:
        return len(s) == 10 and bool(dt.date.fromisoformat(s))
    except ValueError:
        return False


def problems(value: Any, schema: dict[str, Any], at: str) -> list[str]:
    """Where value does not fit schema, each as "<path>: <what is wrong>"; empty when it fits."""
    if "$ref" in schema:
        schema = SPEC["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
    types = schema.get("type", [])
    types = [types] if isinstance(types, str) else types
    if types and not any(isinstance(value, TYPES[t]) and not (t in ("integer", "number") and isinstance(value, bool)) for t in types):
        return [f"{at}: {value!r} is not {' or '.join(types)}"]
    if "enum" in schema and value not in schema["enum"]:
        return [f"{at}: {value!r} is not one of {schema['enum']}"]
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            return [f"{at}: is empty" if schema["minLength"] == 1 else f"{at}: shorter than {schema['minLength']} characters"]
        if schema.get("format") == "date" and not _date(value):
            return [f"{at}: {value!r} is not a date (YYYY-MM-DD)"]
    out = []
    if isinstance(value, dict) and "properties" in schema:
        props = schema["properties"]
        out += [f"{at}.{k}: not in the schema" for k in value if k not in props]
        out += [f"{at}.{k}: required" for k in schema.get("required", []) if k not in value]
        out += [p for k, v in value.items() if k in props for p in problems(v, props[k], f"{at}.{k}")]
    if isinstance(value, list) and "items" in schema:
        out += [p for v in value for p in problems(v, schema["items"], f"{at}[]")]
    return out


def check(value: Any, name: str, at: str) -> None:
    """Raises ValueError, naming every problem, when value does not fit the document's schema `name`."""
    if found := problems(value, {"$ref": f"#/components/schemas/{name}"}, at):
        raise ValueError(f"{at} does not fit the {name} schema (site/lib/openapi.ts):\n  " + "\n  ".join(found[:20]))
