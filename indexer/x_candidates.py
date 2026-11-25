"""Finds recent X posts that may respond to indexed AI-generated records, through the X API's recent search.

Needs an X API bearer token in X_BEARER_TOKEN (recent search covers the last 7 days). Prints a Markdown
report: each post with its author's name, handle and bio, the record it is about, and the
`python3 indexer/index.py discuss` command to attach it after review. Nothing is attached, and nothing is
written to disk: a post's text is not kept anywhere, as the README promises for X.

  python3 indexer/x_candidates.py [--days 4] [--max-results 25]

A post is about a record when it links the record (its GitHub folder, page or mirror) or matches one of
the QUERIES below. Each run reads at most len(QUERIES) * --max-results posts from the API's monthly quota.
Posts already attached are left out when SUPABASE_DB_URL is set.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable

import sources as S

SEARCH = "https://api.x.com/2/tweets/search/recent"
NOT_RETWEETS = " -is:retweet"
# (query, records it is about); with an empty list, each post's links identify the record.
QUERIES: list[tuple[str, list[str]]] = [
    ('url:"github.com/openai/math" OR url:"mathcommunity.github.io/oai-math-revised"', []),
    ('url:"github.com/anthropics" OR url:"anthropic.com/research" OR url:"hexagonmath.org"', []),
    ('"Exponential Time Hypothesis" OR "ETH is false" OR "refutation of ETH"',
     ["openai-math/The-Exponential-Time-Hypothesis-is-False", "lean/anthropics__formal-math__eth"]),
    ('("local smoothing" OR "Kakeya conjecture") (OpenAI OR proof)', ["openai-math/Local-smoothing-for-the-Euclidean-wave-equation"]),
    ('"quasi-Riemann" OR "quasi Riemann hypothesis"', ["openai-math/The-Quasi-Riemann-Hypothesis"]),
    ('"Siegel zero" OR "Siegel zeros" OR "Siegel zeroes" OR "Landau-Siegel"', ["openai-math/Uniform-exclusion-of-Landau-Siegel-zeros"]),
    ('"Unique Games" (OpenAI OR proof OR proved OR theorem)', ["openai-math/The-Unique-Games-Theorem"]),
    ('"matrix multiplication" ("2.25" OR "9/4")', ["openai-math/Matrix-Multiplication-Nine-Fourths"]),
    ('"integer multiplication" "n log n"', ["openai-math/Integer-multiplication-below-n-log-n"]),
    ('"Fermat\'s Last Theorem" (Lean OR Claude OR formalized OR formalised)',
     ["anthropic-science/formalizing-fermats-last-theorem", "lean/anthropics__fermats-last-theorem"]),
    ('(3SUM OR APSP) (Claude OR Anthropic OR subquadratic OR subcubic)', ["lean/anthropics__formal-math__3sum-apsp"]),
    ('("zeta zeros" OR "critical line") (Claude OR Anthropic)', ["anthropic-science/riemann-zeta", "lean/anthropics__formal-math__zeta23"]),
    ('("nine loops" OR "nine-loop" OR "9-loop") (amplitude OR Claude)', ["anthropic-science/yes-claude-can-do-nine-loops"]),
    ('"Navier-Stokes" (OpenAI OR blowup OR "blow-up")', ["web/openai-navier-stokes"]),
    ('"Haldane gap" (OpenAI OR proof)', ["openai-math/The-periodic-spin-one-Haldane-gap"]),
]
# Words in a bio that suggest a researcher; the reviewer still decides, as the README asks.
RESEARCHER = re.compile(r"\b(prof(essor)?\.?|mathematician|physicist|computer scientist|theorist|ph\.?d|postdoc|lecturer|faculty|"
                        r"researcher|research scientist|universit(y|é|ät|at)|institut[e]?|college|\.edu)\b", re.I)
SKIP_HANDLES = {"grok"}  # bots that answer every thread
LAB_SOURCES = ("openai-math", "anthropic-science", "cogentic", "hexagon", "palomar", "web", "lean")


def norm(url: str) -> str:
    """host/path, lower-case, without www., a trailing slash, or GitHub's tree|blob/<branch>."""
    p = urllib.parse.urlsplit(url.strip())
    path = re.sub(r"^/([^/]+/[^/]+)/(?:tree|blob)/[^/]+", r"/\1", p.path) if p.hostname == "github.com" else p.path
    path = re.sub(r"(?<=\d)v\d+$", "", path.rstrip("/"))  # any version of a preprint: hexagonmath.org/abs/2610.00577v2
    return f"{(p.hostname or '').removeprefix('www.')}{path}".lower()


class Records:
    """The records a post's link can point at: by the OpenAI Math preprint folder, or by the record's URL as a prefix."""

    FOLDER = re.compile(r"github\.com/openai/math/(?:tree|blob)/[^/]+/preprints/([^/?#]+)|oai-math-revised/papers/([^/?#]+)", re.I)

    def __init__(self, entries: Iterable[dict[str, Any]]):
        self.by_id: dict[str, dict[str, Any]] = {}
        self.by_folder: dict[str, str] = {}
        self.prefixes: list[tuple[str, str]] = []
        for e in entries:
            rid = f"{e['source']}/{e['key']}"
            self.by_id[rid] = e
            if e["source"] == "openai-math":
                self.by_folder[e["url"].rstrip("/").rsplit("/", 1)[-1].lower()] = rid
            elif "/" in norm(e.get("url") or ""):  # a bare domain would match every link to that site
                self.prefixes.append((norm(e["url"]), rid))
        self.prefixes.sort(key=lambda p: -len(p[0]))  # the longest, most specific prefix first

    def linked(self, url: str) -> str | None:
        if m := self.FOLDER.search(url):
            return self.by_folder.get((m[1] or m[2]).lower())
        u = norm(url)
        return next((rid for p, rid in self.prefixes if u == p or u.startswith(p + "/")), None)


def search(query: str, start: dt.datetime, max_results: int, token: str) -> dict[str, Any]:
    params = {"query": query + NOT_RETWEETS, "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "max_results": max(10, min(100, max_results)),
              "tweet.fields": "created_at,author_id,entities,referenced_tweets", "expansions": "author_id",
              "user.fields": "name,username,description,verified,public_metrics"}
    req = urllib.request.Request(f"{SEARCH}?{urllib.parse.urlencode(params)}",
                                 headers={"Authorization": f"Bearer {token}", "User-Agent": S.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise S.SourceError(f"X API HTTP {e.code} for {query[:40]!r}") from None
    except urllib.error.URLError as e:
        raise S.SourceError(f"cannot reach the X API: {e.reason}") from None


def posts(reply: dict[str, Any], about: list[str], records: Records) -> list[dict[str, Any]]:
    """The reply's posts, each with its author and the records it is about (named by the query or linked)."""
    users = {u["id"]: u for u in (reply.get("includes") or {}).get("users", [])}
    out = []
    for t in reply.get("data") or []:
        if any(r.get("type") == "retweeted" for r in t.get("referenced_tweets") or []):
            continue
        u = users.get(t.get("author_id"), {})
        links = [x.get("unwound_url") or x.get("expanded_url") or "" for x in (t.get("entities") or {}).get("urls", [])]
        ids = list(dict.fromkeys([*about, *filter(None, map(records.linked, links))]))
        ids = [i for i in ids if i in records.by_id]
        if not ids or u.get("username", "").lower() in SKIP_HANDLES:
            continue
        out.append({"id": t["id"], "url": f"https://x.com/{u.get('username', 'i/web')}/status/{t['id']}", "text": t.get("text", ""),
                    "date": (t.get("created_at") or "")[:10], "name": u.get("name", ""), "handle": u.get("username", ""),
                    "bio": u.get("description", ""), "followers": (u.get("public_metrics") or {}).get("followers_count", 0),
                    "researcher": bool(RESEARCHER.search(u.get("description", ""))), "records": ids})
    return out


def attached_ids(entries: Iterable[dict[str, Any]]) -> set[str]:
    """Status ids of X posts already attached to any record."""
    return {m[1] for e in entries for d in e.get("discussion") or [] if (m := re.search(r"/status/(\d+)", d.get("url", "")))}


def report(found: list[dict[str, Any]], records: Records, start: dt.date, end: dt.date, errors: list[str], checked: bool) -> str:
    lines = [f"# X posts, {start} to {end}", "",
             "Found by `x_candidates.py`; nothing is attached. Keep only identifiable researchers, labs and journals "
             "(no anonymous accounts, aggregators or reposts), and only posts about that record's result.", ""]
    lines += [f"> Not searched: {e}" for e in errors] + ([] if checked else ["> Not checked against attached links (no SUPABASE_DB_URL)."])
    if not found:
        return "\n".join(lines + ["", "No new posts.", ""])
    lines.append(f"{len(found)} posts.")
    for p in sorted(found, key=lambda p: (not p["researcher"], -p["followers"])):
        mark = "bio suggests a researcher" if p["researcher"] else "bio does not say"
        lines += ["", f"## {p['name']} (@{p['handle']}), {p['date']}: {mark}, {p['followers']} followers",
                  f"> {S.trim(p['bio'], 200)}", "", S.trim(p["text"], 300), ""]
        for rid in p["records"]:
            lines.append(f"- `{rid}`: {records.by_id[rid].get('title', '')[:90]}")
            lines.append(f"  `python3 indexer/index.py discuss {rid} {p['url']}`")
    return "\n".join(lines) + "\n"


def lab_entries() -> list[dict[str, Any]]:
    import index as I  # needs the database only here
    return [e for _, e in I.load("source = ANY(%s)", [list(LAB_SOURCES)])]


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=4, help="how far back to search (at most 7)")
    ap.add_argument("--max-results", type=int, default=25, help="posts per query, 10 to 100")
    a = ap.parse_args(list(argv) if argv is not None else None)
    token = os.environ.get("X_BEARER_TOKEN", "").strip()
    if not token:
        print("set X_BEARER_TOKEN to an X API bearer token (recent search)", file=sys.stderr)
        return 2
    try:
        entries = lab_entries()
    except Exception as err:  # no database here: search anyway, against nothing attached
        print(f"records not loaded ({type(err).__name__}); linked posts cannot be matched", file=sys.stderr)
        entries = []
    records = Records(entries)
    known = attached_ids(entries)
    end = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    start = end - dt.timedelta(days=min(a.days, 7)) + dt.timedelta(minutes=1)
    found: dict[str, dict[str, Any]] = {}
    errors = []
    for query, about in QUERIES:
        try:
            for p in posts(search(query, start, a.max_results, token), about, records):
                if p["id"] in known:
                    continue
                seen = found.setdefault(p["id"], p)  # a post found by two queries: one entry, both records
                seen["records"] = list(dict.fromkeys(seen["records"] + p["records"]))
        except S.SourceError as err:
            errors.append(str(err))
    sys.stdout.write(report(list(found.values()), records, start.date(), end.date(), errors, checked=bool(entries)))
    return 1 if len(errors) == len(QUERIES) else 0


if __name__ == "__main__":
    sys.exit(main())
