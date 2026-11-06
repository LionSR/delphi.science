"""Finds new items that may respond to indexed records: posts on the research blogs in blogs.json, arXiv papers that
cite a record and name it in their abstract, MathOverflow, CSTheory and Physics Stack Exchange posts, Bluesky posts
that link a record already being discussed, and arXiv preprints that mention the AI labs.

An item names its records when it links them (any URL or arXiv id that an adapter in sources.py recognizes) or cites
them. Other items count when they mention an AI lab, and are matched against the titles of the AI-made records, ranked
by IDF-weighted title overlap. Writes a Markdown report with the `python3 index.py discuss` command that attaches each
match after review. Nothing is attached.

  python3 candidates.py [--days 7] [--until 2026-10-25] [--out reports/responses/2026-10-25.md]

Citations of physics papers come from INSPIRE, and of the others from Semantic Scholar, whose keyless rate limit is
shared by everyone: set S2_API_KEY to use a key.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import functools
import time
import html
import json
import math
import os
import re
import shlex
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Iterator

import index as I
import sources as S

# Names that mark an abstract or a question as being about AI-made work.
TERMS = ["OpenAI", "openai/math", "Astra", "Anthropic", "Claude", "Hexagon", "Palomar", "AlphaProof", "AlphaEvolve", "DeepMind", "Gemini"]
MENTIONS = re.compile("|".join(map(re.escape, TERMS)), re.I)
# Records matched only by link or citation, not by title: arXiv has tens of thousands, and a web record can be any page.
SKIP_SOURCES = {"arxiv", "web"}
MIN_CONFIDENCE = 0.45
STOP = set("a an and are as at be by for from in into is it of on or our the this to via we with without new "
           "proof proofs paper note result results theorem conjecture problem problems open some two one".split())
BLOGS: list[dict[str, Any]] = json.loads(Path(__file__).with_name("blogs.json").read_text())["blogs"]
SE_SITES = ("mathoverflow.net", "cstheory.stackexchange.com", "physics.stackexchange.com")
S2_BATCH = ("https://api.semanticscholar.org/graph/v1/paper/batch"
            "?fields=title,abstract,authors,publicationDate,externalIds,references.externalIds,references.authors")
S2_IDS = 100  # papers per batch request, to keep replies with their references small
INSPIRE = "https://inspirehep.net/api/literature"
INSPIRE_FIELDS = "arxiv_eprints,titles,authors.full_name,abstracts.value,preprint_date,references.reference.arxiv_eprint,references.reference.authors.full_name"
INSPIRE_DOMAINS = ("hep-", "gr-qc", "nucl-", "quant-ph", "math-ph")  # arXiv categories INSPIRE lists
INSPIRE_IDS = 50
BSKY = "https://api.bsky.app/xrpc"
BOT = re.compile(r"bot\b|arxiv", re.I)  # accounts that post every new paper


def words(text: str | None) -> list[str]:
    """Distinctive words, roughly singularized: Sidorenko's and counterexamples match Sidorenko and counterexample."""
    found = re.findall(r"[a-z][a-z0-9-]+", S.clean(text).lower().replace("’s", "").replace("'s", ""))
    return [w[:-1] if w.endswith("s") and not w.endswith("ss") else w for w in found if w not in STOP and len(w) > 2]


def live(where: str, params: list[Any]) -> list[dict[str, Any]]:
    """The entries matching a condition that are not gone."""
    return [e for _, e in I.load(f"({where}) AND NOT coalesce((entry->>'gone')::boolean, false)", params)]


def ident(url: str) -> str:
    """An identity for a link: its record id, or for a plain web page its URL without fragment or query."""
    try:
        src, key = S.detect(url)
    except ValueError:
        src, key = S.BY_NAME["web"], ""
    return f"{src.name}/{key}" if src.name != "web" else url.split("#")[0].split("?")[0].rstrip("/")


def attached(entries: Iterable[dict[str, Any]]) -> set[tuple[str, str]]:
    """(record id, link identity) for every link already attached, so an item is reported once for each record."""
    return {(I.rid(e), ident(d["url"])) for e in entries for d in e.get("discussion") or []}


LINK = re.compile(r"""href=["']([^"']+)|\barXiv:\s?(\d{4}\.\d{4,5})""", re.I)


def named(text: str | None) -> list[str]:
    """The ids of the records a text links: every link or arXiv id that an adapter other than Web recognizes."""
    ids = []
    for m in LINK.finditer(text or ""):
        try:
            src, key = S.detect(html.unescape(m[1] or m[2]).strip())
        except ValueError:
            continue
        if src.name != "web":
            ids.append(f"{src.name}/{key}")
    return list(dict.fromkeys(ids))


class Matcher:
    """Scores an item's text against each record's title: the IDF-weighted share of the title's words
    that the item uses, raised a little when the item names the record's source."""

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


# ---- Finders: each returns the items dated in the window, as {url, title, authors, date, text, where}, with the
# records the item links or cites (records), how it names them (how: links or cites), and the --author to attach it with.


def in_window(day: str, start: dt.date, end: dt.date) -> bool:
    return start.isoformat() <= day[:10] <= end.isoformat()


def arxiv_candidates(start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    window = f"submittedDate:[{start:%Y%m%d}0000 TO {end:%Y%m%d}2359]"
    terms = " OR ".join(f'abs:"{t}"' for t in TERMS)
    query = f"({terms}) AND {window}"
    return [{"url": e["url"], "title": e["title"], "authors": e.get("authors", []), "date": e.get("published", ""),
             "text": e.get("summary", ""), "where": "arXiv", "records": named(e.get("summary"))} for e in S.ArXiv().harvest(query, 500)]


def surname(name: str | None) -> str:
    """Craig from "Nathaniel Craig" or "Craig, N." (INSPIRE)."""
    name = (name or "").strip()
    return name.split(",")[0].strip() if "," in name else (name.split() or [""])[-1]


def citing(papers: Iterable[dict[str, Any] | None]) -> list[dict[str, Any]]:
    """The papers (in Semantic Scholar's shape) whose abstract names a paper they cite, by its arXiv id or an author's
    surname ("a variant of the algorithm described by Craig"). A cited paper that shares a surname with the citing
    paper's authors is their own earlier work, so it does not count."""
    out = []
    for p in filter(None, papers):
        abstract, own = p.get("abstract") or "", {surname(a.get("name")) for a in p.get("authors") or []}
        ids = []
        for r in p.get("references") or []:
            arxiv = (r.get("externalIds") or {}).get("ArXiv")
            names = {surname(a.get("name")) for a in r.get("authors") or []} - {""}
            if arxiv and not names & own and (arxiv in abstract or any(re.search(rf"\b{re.escape(n)}\b", abstract) for n in names)):
                ids.append(f"arxiv/{arxiv}")
        if ids and (key := (p.get("externalIds") or {}).get("ArXiv")):
            out.append({"url": f"https://arxiv.org/abs/{key}", "title": p.get("title") or "", "authors": [a.get("name") for a in p.get("authors") or []],
                        "date": p.get("publicationDate") or "", "text": S.trim(abstract), "where": "arXiv", "records": ids, "how": "cites"})
    return out


@functools.cache
def new_papers(start: dt.date, end: dt.date) -> tuple[dict[str, Any], ...]:
    """Indexed arXiv papers published in the window."""
    return tuple(live("source = 'arxiv' AND entry->>'published' BETWEEN %s AND %s", [start.isoformat(), end.isoformat()]))


def physics(e: dict[str, Any]) -> bool:
    return (e.get("domain") or "").startswith(INSPIRE_DOMAINS)


def inspire_paper(m: dict[str, Any]) -> dict[str, Any]:
    """An INSPIRE record in Semantic Scholar's shape."""
    names = lambda authors: [{"name": a.get("full_name")} for a in authors or []]  # noqa: E731
    return {"externalIds": {"ArXiv": m["arxiv_eprints"][0]["value"]}, "title": m["titles"][0]["title"], "authors": names(m.get("authors")),
            "abstract": (m.get("abstracts") or [{}])[0].get("value", ""), "publicationDate": m.get("preprint_date", ""),
            "references": [{"externalIds": {"ArXiv": r["reference"].get("arxiv_eprint")}, "authors": names(r["reference"].get("authors"))}
                           for r in m.get("references") or []]}


def inspire_candidates(start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """New physics papers that cite a record and name it in their abstract, with references from INSPIRE."""
    keys = [e["key"] for e in new_papers(start, end) if physics(e)]
    out = []
    for i in range(0, len(keys), INSPIRE_IDS):
        q = urllib.parse.urlencode({"q": " or ".join(f"arxiv:{k}" for k in keys[i:i + INSPIRE_IDS]), "size": INSPIRE_IDS, "fields": INSPIRE_FIELDS})
        hits = S.get_json(f"{INSPIRE}?{q}", cache=False)["hits"]["hits"]
        out += citing(inspire_paper(h["metadata"]) for h in hits if h["metadata"].get("arxiv_eprints"))
    return out


def semantic_scholar_candidates(start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """New papers outside physics that cite a record and name it in their abstract, with references from Semantic Scholar."""
    keys = [e["key"] for e in new_papers(start, end) if not physics(e)]
    api_key = os.environ.get("S2_API_KEY", "").strip()
    out = []
    for i in range(0, len(keys), S2_IDS):
        body = json.dumps({"ids": [f"ARXIV:{k}" for k in keys[i:i + S2_IDS]]}).encode()
        try:
            out += citing(json.loads(S.get(S2_BATCH, data=body, cache=False, headers={"x-api-key": api_key} if api_key else None)))
        except S.SourceError as err:
            raise S.SourceError(f"{err}{'' if api_key else '; set S2_API_KEY'}") from None
    return out


def stackexchange_candidates(host: str, start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """Questions and answers posted in the window that link a record or mention the AI labs. One listing per kind,
    filtered here, uses less of the keyless API quota than a search per term."""
    window = {"fromdate": int(dt.datetime.combine(start, dt.time()).timestamp()), "todate": int(dt.datetime.combine(end, dt.time.max).timestamp())}
    out = []
    for kind in ("questions", "answers"):
        for page in range(1, 11):
            q = urllib.parse.urlencode({"site": S.STACKEXCHANGE[host], **window, "pagesize": 100, "page": page, "filter": "withbody"})
            data = S.get_json(f"https://api.stackexchange.com/2.3/{kind}?{q}", cache=False)
            time.sleep(data.get("backoff", 0))  # the API refuses the next request until then
            for item in data.get("items", []):
                ids = named(item.get("body"))
                if ids or MENTIONS.search(f"{item.get('title', '')} {item.get('body', '')}"):
                    link = S.stackexchange_item(item)
                    url = item["link"] if kind == "questions" else f"https://{host}/a/{item['answer_id']}"  # an answer link credits its author
                    out.append({"url": url, "title": link["title"] or f"An answer on {host}", "authors": [link["author"]], "date": link["date"],
                                "text": link["text"], "where": host, "records": ids})
            if not data.get("has_more"):
                break
    return out


FEED = {"a": "http://www.w3.org/2005/Atom", "dc": "http://purl.org/dc/elements/1.1/", "content": "http://purl.org/rss/1.0/modules/content/"}


def rss_date(text: str) -> str:
    try:
        return email.utils.parsedate_to_datetime(text).date().isoformat()
    except (TypeError, ValueError):
        return S.iso_date(text)


def posts(feed: bytes) -> Iterator[dict[str, str]]:
    """Each post in an RSS or Atom feed: its link, title, author as the feed names it, date, and body (HTML)."""
    root = ET.fromstring(feed)

    def t(el: ET.Element, *paths: str) -> str:
        return next((x for p in paths if (x := (el.findtext(p, "", FEED) or "").strip())), "")

    for it in root.iter("item"):
        yield {"link": t(it, "link"), "title": t(it, "title"), "author": t(it, "dc:creator"), "date": rss_date(t(it, "pubDate")),
               "body": t(it, "content:encoded", "description")}
    owner = t(root, "a:author/a:name")
    for it in root.iter(f"{{{FEED['a']}}}entry"):
        link = next((x.get("href", "") for x in it.findall("a:link", FEED) if x.get("rel", "alternate") == "alternate"), "")
        yield {"link": link, "title": t(it, "a:title"), "author": t(it, "a:author/a:name") or owner,
               "date": S.iso_date(t(it, "a:published", "a:updated")), "body": t(it, "a:content", "a:summary")}


def blog_candidates(blog: dict[str, Any], start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """The blog's posts dated in the window, credited to the full name blogs.json gives for the feed's author."""
    out = []
    for p in posts(S.get(blog["feed"], cache=False)):
        if in_window(p["date"], start, end):
            author = blog["authors"].get(p["author"], "")
            out.append({"url": p["link"], "title": S.clean(p["title"]), "authors": [author or p["author"]], "date": p["date"],
                        "text": S.trim(p["body"]), "where": blog["name"], "records": named(p["body"]), "author": author})
    return out


def bluesky_candidates(start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    """Posts in the window that link a record that already has responses, found by the record's URL. Accounts that
    post every new paper are left out; each author's profile text is shown so a person can tell who they are."""
    found: dict[str, tuple[dict[str, Any], list[str]]] = {}
    for e in live(I.DISCUSSED, []):
        q = urllib.parse.urlencode({"q": "*", "url": e["url"], "sort": "latest", "limit": 100})
        for p in S.get_json(f"{BSKY}/app.bsky.feed.searchPosts?{q}", cache=False).get("posts", []):
            a = p.get("author") or {}
            if in_window(p["record"].get("createdAt", ""), start, end) and not BOT.search(f"{a.get('handle', '')} {a.get('displayName', '')}"):
                found.setdefault(p["uri"], (p, []))[1].append(I.rid(e))
    dids = sorted({p["author"]["did"] for p, _ in found.values()})
    bios = {}
    for i in range(0, len(dids), 25):
        q = urllib.parse.urlencode([("actors", d) for d in dids[i:i + 25]])
        bios |= {x["did"]: x.get("description") or "" for x in S.get_json(f"{BSKY}/app.bsky.actor.getProfiles?{q}", cache=False).get("profiles", [])}
    out = []
    for p, ids in found.values():
        a = p["author"]
        name = f"{a.get('displayName') or a['handle']} (@{a['handle']}; {S.trim(bios.get(a['did']), 120) or 'no profile text'})"
        out.append({"url": f"https://bsky.app/profile/{a['handle']}/post/{p['uri'].rsplit('/', 1)[-1]}", "title": "", "authors": [name],
                    "date": p["record"]["createdAt"][:10], "text": S.trim(p["record"].get("text")), "where": "Bluesky", "records": ids})
    return out


FINDERS = (("arXiv", arxiv_candidates), ("INSPIRE citations", inspire_candidates), ("Semantic Scholar citations", semantic_scholar_candidates),
           *((host, functools.partial(stackexchange_candidates, host)) for host in SE_SITES),
           *((b["name"], functools.partial(blog_candidates, b)) for b in BLOGS), ("Bluesky", bluesky_candidates))


def report(candidates: list[dict[str, Any]], matcher: Matcher, linked: dict[str, dict[str, Any]], known: set[tuple[str, str]],
           start: dt.date, end: dt.date, errors: list[str]) -> str:
    """The items that match a record not already linked to them. `linked` holds the records the items name. An item
    that names none is matched by title, and only when it mentions an AI lab."""
    lines = [f"# Candidate responses, {start} to {end}", "",
             "Found by `candidates.py`; nothing is attached. Read each one, and if it responds to the record, run the command "
             "under it (only voices with a public scholarly record, as the README says).", ""]
    lines += [f"> Not searched: {e}" for e in errors] + ([""] if errors else [])

    def matches(c: dict[str, Any]) -> list[tuple[float, str, dict[str, Any]]]:
        exact = [(1.0, c.get("how", "links"), linked[r]) for r in c.get("records", []) if r in linked and r != ident(c["url"])]
        text = f"{c['title']} {c['text']}"
        found = exact or ([(s, f"{s:.0%}", e) for s, e in matcher.match(text)] if MENTIONS.search(text) else [])
        return [m for m in found if (I.rid(m[2]), ident(c["url"])) not in known]

    matched = [(c, m) for c in candidates if (m := matches(c))]
    if not matched:
        return "\n".join(lines + [f"No candidates ({len(candidates)} new items read, none matched a record).", ""])
    lines.append(f"{len(matched)} of {len(candidates)} new items match a record.")
    for c, m in sorted(matched, key=lambda cm: -cm[1][0][0]):
        who = ", ".join(c["authors"][:4]) + (" et al." if len(c["authors"]) > 4 else "")
        lines += ["", f"## [{c['title'] or S.trim(c['text'], 80)}]({c['url']})", f"{c['where']}, {c['date']}, {who}", ""]
        author = f" --author {shlex.quote(c['author'])}" if c.get("author") else ""
        for _, how, e in m:
            lines.append(f"- {how} `{I.rid(e)}`: {e.get('title')}")
            lines.append(f"  `python3 index.py discuss {I.rid(e)} {shlex.quote(c['url'])}{author}`")
    return "\n".join(lines) + "\n"


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--until", type=dt.date.fromisoformat, default=dt.date.today())
    ap.add_argument("--out", type=Path, help="write the report here (default: print it)")
    a = ap.parse_args(list(argv) if argv is not None else None)
    start, end = a.until - dt.timedelta(days=a.days - 1), a.until
    entries = live("source <> ALL(%s)", [sorted(SKIP_SOURCES)])
    candidates, errors = [], []
    for name, find in FINDERS:
        try:
            candidates += find(start, end)
        except (S.NotFound, S.SourceError, ET.ParseError) as err:
            errors.append(f"{name} ({err})")
    ids = sorted({r for c in candidates for r in c.get("records", [])})
    linked = {I.rid(e): e for e in live("id = ANY(%s)", [ids])} if ids else {}
    text = report(candidates, Matcher(entries), linked, attached([*entries, *linked.values()]), start, end, errors)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text)
        print(a.out)
    else:
        sys.stdout.write(text)
    return 1 if len(errors) == len(FINDERS) else 0


if __name__ == "__main__":
    sys.exit(main())
