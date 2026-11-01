"""Finds recent arXiv preprints and MathOverflow questions that may respond to indexed AI-generated records.

Writes a Markdown report of matches, ranked by IDF-weighted title overlap, each with the
`python3 index.py discuss` command to attach it after review.

  python3 candidates.py [--days 7] [--until 2026-10-25] [--out reports/responses/2026-10-25.md]
"""

from __future__ import annotations

import argparse
import datetime as dt
import math
import re
import sys
import urllib.parse
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import index as I
import sources as S

# Names that mark an abstract or a question as being about AI-made work.
TERMS = ["OpenAI", "openai/math", "Astra", "Anthropic", "Claude", "Hexagon", "Palomar", "AlphaProof", "AlphaEvolve", "DeepMind", "Gemini"]
MENTIONS = re.compile("|".join(map(re.escape, TERMS)), re.I)
# Sources whose records are not matched against: responses are about AI-made records.
SKIP_SOURCES = {"arxiv", "web"}
MIN_CONFIDENCE = 0.45
STOP = set("a an and are as at be by for from in into is it of on or our the this to via we with without new "
           "proof proofs paper note result results theorem conjecture problem problems open some two one".split())


def words(text: str | None) -> list[str]:
    """Distinctive words, crudely singular: Sidorenko's and counterexamples match Sidorenko and counterexample."""
    found = re.findall(r"[a-z][a-z0-9-]+", S.clean(text).lower().replace("’s", "").replace("'s", ""))
    return [w[:-1] if w.endswith("s") and not w.endswith("ss") else w for w in found if w not in STOP and len(w) > 2]


def records() -> list[dict[str, Any]]:
    """Every entry outside SKIP_SOURCES that is not gone."""
    return [e for _, e in I.load("source <> ALL(%s) AND NOT coalesce((entry->>'gone')::boolean, false)", [sorted(SKIP_SOURCES)])]


def ident(url: str) -> str:
    """An identity for a link: its record id, or for a plain web page its URL without fragment or query."""
    try:
        src, key = S.detect(url)
    except ValueError:
        src, key = S.BY_NAME["web"], ""
    return f"{src.name}/{key}" if src.name != "web" else url.split("#")[0].split("?")[0].rstrip("/")


def seen(entries: Iterable[dict[str, Any]]) -> set[str]:
    """The identities of every discussion link already attached, so a candidate is reported once."""
    return {ident(d["url"]) for e in entries for d in e.get("discussion", [])}


class Matcher:
    """Scores a candidate's text against each record's title: the IDF-weighted share of the title's words
    that the candidate uses, raised a little when the candidate names the record's source."""

    LAB = {"openai-math": ("openai",), "anthropic-science": ("anthropic", "claude"), "hexagon": ("hexagon",),
           "palomar": ("palomar",), "lean": ("lean",)}
    TOP = 3

    def __init__(self, entries: list[dict[str, Any]]):
        titled = [(e, set(words(f"{e.get('title')} {e.get('family_title', '')}"))) for e in entries]
        titled = [(e, t) for e, t in titled if len(t) >= 2]  # a one-word title matches anything
        df = Counter(w for _, t in titled for w in t)
        self.idf = {w: math.log((1 + len(titled)) / (1 + n)) + 1 for w, n in df.items()}
        self.records = [(e, t, sum(self.idf[w] for w in t)) for e, t in titled]

    def match(self, text: str) -> list[tuple[float, dict[str, Any]]]:
        have = set(words(text))
        low = text.lower()
        named = {src for src, labs in self.LAB.items() if any(lab in low for lab in labs)}
        scored: dict[str, tuple[float, dict[str, Any]]] = {}
        for e, title, total in self.records:
            score = sum(self.idf[w] for w in title & have) / total
            if e["source"] in named:
                score = min(1.0, score * 1.15)
            # One line per family: versions of one OpenAI manuscript share a family.
            group = f"{e['source']}:{e.get('family') or e['key']}"
            if score >= MIN_CONFIDENCE and score > scored.get(group, (0.0, {}))[0]:
                scored[group] = (score, e)
        return sorted(scored.values(), key=lambda s: -s[0])[: self.TOP]


def arxiv_candidates(start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    window = f"submittedDate:[{start:%Y%m%d}0000 TO {end:%Y%m%d}2359]"
    terms = " OR ".join(f'abs:"{t}"' for t in TERMS)
    query = f"({terms}) AND {window}"
    return [{"url": e["url"], "title": e["title"], "authors": e.get("authors", []), "date": e.get("published", ""),
             "text": e.get("summary", ""), "where": "arXiv"} for e in S.ArXiv().harvest(query, 500)]


def mathoverflow_candidates(start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """The window's questions, filtered here: a listing uses less of the keyless API quota than a search per term."""
    out = []
    for page in range(1, 6):
        q = urllib.parse.urlencode({"site": S.STACKEXCHANGE["mathoverflow.net"], "fromdate": int(dt.datetime.combine(start, dt.time()).timestamp()),
                                    "todate": int(dt.datetime.combine(end, dt.time.max).timestamp()), "pagesize": 100, "page": page, "filter": "withbody"})
        data = S.get_json(f"https://api.stackexchange.com/2.3/questions?{q}", cache=False)
        for item in data.get("items", []):
            if MENTIONS.search(f"{item.get('title')} {item.get('body')}"):
                link = S.stackexchange_item(item)
                out.append({"url": item["link"], "title": link["title"], "authors": [link["author"]], "date": link["date"],
                            "text": link["text"], "where": "MathOverflow"})
        if not data.get("has_more"):
            break
    return out


def report(candidates: list[dict[str, Any]], matcher: Matcher, start: dt.date, end: dt.date, errors: list[str]) -> str:
    lines = [f"# Candidate responses, {start} to {end}", "",
             "Found by `candidates.py`; nothing is attached. Read each one, and if it responds to the record, run the command "
             "under it (only voices with a public scholarly record, as the README says).", ""]
    lines += [f"> Not searched: {e}" for e in errors] + ([""] if errors else [])
    matched = [(c, matcher.match(f"{c['title']} {c['text']}")) for c in candidates]
    matched = [(c, m) for c, m in matched if m]
    if not matched:
        return "\n".join(lines + [f"No candidates this week ({len(candidates)} new items read, none matched a record).", ""])
    lines.append(f"{len(matched)} of {len(candidates)} new items match a record.")
    for c, m in sorted(matched, key=lambda cm: -cm[1][0][0]):
        who = ", ".join(c["authors"][:4]) + (" et al." if len(c["authors"]) > 4 else "")
        lines += ["", f"## [{c['title']}]({c['url']})", f"{c['where']}, {c['date']}, {who}", ""]
        for score, e in m:
            lines.append(f"- {score:.0%} `{I.rid(e)}`: {e.get('title')}")
            lines.append(f"  `python3 index.py discuss {I.rid(e)} {c['url']}`")
    return "\n".join(lines) + "\n"


FINDERS = (("arXiv", arxiv_candidates), ("MathOverflow", mathoverflow_candidates))


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--until", type=dt.date.fromisoformat, default=dt.date.today())
    ap.add_argument("--out", type=Path, help="write the report here (default: print it)")
    a = ap.parse_args(list(argv) if argv is not None else None)
    start, end = a.until - dt.timedelta(days=a.days - 1), a.until
    entries = records()
    known = seen(entries)
    candidates, errors = [], []
    for name, find in FINDERS:
        try:
            candidates += [c for c in find(start, end) if ident(c["url"]) not in known]
        except (S.NotFound, S.SourceError) as err:
            errors.append(f"{name} ({err})")
    text = report(candidates, Matcher(entries), start, end, errors)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text)
        print(a.out)
    else:
        sys.stdout.write(text)
    return 1 if len(errors) == len(FINDERS) else 0


if __name__ == "__main__":
    sys.exit(main())
