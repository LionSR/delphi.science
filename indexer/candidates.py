"""Finds new items that may respond to indexed records: posts on the research blogs in indexer/blogs.json, arXiv papers that
name an AI lab or cite a record and name it in their abstract, MathOverflow, CSTheory and Physics Stack Exchange
posts, and Bluesky posts that link the labs' records.

An item names its records when it links them (any URL or arXiv id that an adapter in sources.py recognizes) or cites
them; for an arXiv paper that names a lab, that includes the AI-made records its bibliography links. An item that
names no record but names a lab is matched against the titles of that lab's records, ranked by IDF-weighted title
overlap. Writes a Markdown report with the `python3 indexer/index.py discuss` command that attaches each match after review,
leaving out what the earlier reports in the same folder already listed. Nothing is attached.

  python3 indexer/candidates.py [--days 7] [--until 2026-10-25] [--out reports/responses/2026-10-25.md]

Citations of physics papers come from INSPIRE, and of the others from Semantic Scholar, whose keyless rate limit is
shared by everyone: set S2_API_KEY to use a key.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import functools
import html
import json
import math
import os
import re
import shlex
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Iterator, Literal, TypedDict

import index as I
import sources as S

# The AI labs, by the names that mark a text as being about their work, with the sources that hold their records. Names
# match whole and with their case, so "hexagonal" and "the hexagon of exponents" are not mentions.
LABS: dict[str, tuple[str, ...]] = {"OpenAI": ("openai-math",), "GPT": ("openai-math",),
                                    "Anthropic": ("anthropic-science", "lean"), "Claude": ("anthropic-science", "lean"),
                                    "Cogentic": ("cogentic",)}
MENTIONS = re.compile(rf"\b(?:{'|'.join(LABS)})\b")
# arXiv categories whose papers name the labs as vendors of the models they study, not as authors of a result.
VENDOR_CATEGORIES = ("cs.AI", "cs.CL", "cs.LG", "cs.SE", "cs.CR", "cs.HC", "cs.CY", "cs.MA", "cs.IR", "cs.RO", "cs.CV")
# Sources of papers. A bibliography cites them as ordinary references; the citation finders take the ones an abstract names.
PAPERS = ("arxiv/", "doi/")
# Records matched only by link or citation, not by title: arXiv has tens of thousands, and a web record can be any page.
SKIP_SOURCES = {"arxiv", "web"}
MIN_CONFIDENCE = 0.45
STOP = set("a an and are as at be by for from in into is it of on or our the this to via we with without new "
           "proof proofs paper note result results theorem conjecture problem problems open some two one".split())
SE_SITES = ("mathoverflow.net", "cstheory.stackexchange.com", "physics.stackexchange.com")
S2_BATCH = ("https://api.semanticscholar.org/graph/v1/paper/batch"
            "?fields=title,abstract,authors,publicationDate,externalIds,references.externalIds,references.authors")
S2_IDS = 100  # papers per batch request, to keep replies with their references small
INSPIRE = "https://inspirehep.net/api/literature"
INSPIRE_FIELDS = "arxiv_eprints,titles,authors.full_name,abstracts.value,preprint_date,references.reference.arxiv_eprint,references.reference.authors.full_name"
INSPIRE_DOMAINS = ("hep-", "gr-qc", "nucl-", "quant-ph", "math-ph")  # arXiv categories INSPIRE lists
INSPIRE_IDS = 50
BSKY = "https://api.bsky.app/xrpc"
# Searches for posts linking the labs' pages; posts about other records are found by the record's URL.
BSKY_SEARCHES = ({"url": "https://github.com/openai/math"}, {"domain": "mathcommunity.github.io"},
                 {"url": "https://www.anthropic.com/research"}, {"domain": "hexagonmath.org"})
BOT = re.compile(r"bot\b|arxiv", re.I)  # accounts that post every new paper


class Blog(TypedDict, total=False):
    name: str
    feed: str
    authors: dict[str, str]  # the feed's author names, by the full names to credit
    author: str  # the full name for posts whose feed entry names no author


def load_blogs(path: Path) -> list[Blog]:
    blogs = json.loads(path.read_text())["blogs"]
    for b in blogs:
        if not (set(b) <= set(Blog.__annotations__) and isinstance(b.get("name"), str) and isinstance(b.get("feed"), str)
                and isinstance(b.get("authors", {}), dict) and isinstance(b.get("author", ""), str)):
            raise ValueError(f"{path.name}: not a blog entry: {b!r}")
    return blogs


BLOGS = load_blogs(Path(__file__).with_name("blogs.json"))


class Candidate(TypedDict):
    """An item that may respond to records."""
    url: str
    title: str
    authors: list[str]
    date: str
    text: str  # an excerpt
    where: str  # arXiv, the blog's name, or the site
    records: list[str]  # the records it names
    how: Literal["links", "cites"]  # how it names them
    labs: list[str]  # the sources of the labs its full text names, whose titles it is matched against if it names no record
    author: str  # the full name to attach it with (--author), or ""


def candidate(url: str, title: str, authors: Iterable[str], date: str, text: str, where: str, *, records: Iterable[str] = (),
              how: Literal["links", "cites"] = "links", full: str = "", author: str = "") -> Candidate:
    """An item; `full` is its whole text, read for lab names."""
    labs = sorted({src for name in MENTIONS.findall(full) for src in LABS[name]})
    return Candidate(url=url, title=title, authors=list(authors), date=date, text=text, where=where, records=list(records),
                     how=how, labs=labs, author=author)


def words(text: str | None) -> list[str]:
    """Distinctive words, roughly singularized: Sidorenko's and counterexamples match Sidorenko and counterexample."""
    found = re.findall(r"[a-z][a-z0-9-]+", S.clean(text).lower().replace("’s", "").replace("'s", ""))
    return [w[:-1] if w.endswith("s") and not w.endswith("ss") else w for w in found if w not in STOP and len(w) > 2]


def live(where: str, params: list[Any]) -> list[dict[str, Any]]:
    """The entries matching a condition that are not gone."""
    return [e for _, e in I.load(f"({where}) AND NOT coalesce((entry->>'gone')::boolean, false) AND entry->>'merged_into' IS NULL", params)]


def attached(entries: Iterable[dict[str, Any]]) -> set[tuple[str, str]]:
    """(record id, link identity) for every link already attached, so an item is reported once for each record."""
    return {(I.rid(e), S.identity(d["url"])) for e in entries for d in e.get("discussion") or []}


COMMAND = re.compile(r"`python3 (?:indexer/)?index\.py discuss (.+?)`")


def reported(folder: Path, start: dt.date, end: dt.date) -> set[tuple[str, str]]:
    """(record id, link identity) for each command in the earlier reports in the folder that overlap the window (named
    by date, from start until before end), so a daily run lists only what they did not."""
    out = set()
    for p in folder.glob("*.md"):
        if start.isoformat() <= p.stem < end.isoformat():
            for m in COMMAND.finditer(p.read_text()):
                rid, url = shlex.split(m[1])[:2]
                out.add((rid, S.identity(url)))
    return out


LINK = re.compile(r"""href=["']([^"']+)|\barXiv:\s?(\d{4}\.\d{4,5})""", re.I)


def linked_ids(urls: Iterable[str]) -> list[str]:
    """The ids of the records the URLs or arXiv ids point at (or canonical URL for plain web pages so custom and legacy web keys resolve by URL)."""
    ids = []
    for url in urls:
        clean = urllib.parse.urldefrag(url.strip())[0]  # a section link names its paper
        try:
            src, key = S.detect(clean)
        except ValueError:
            continue
        ids.append(S.identity(clean) if src.name == "web" else f"{src.name}/{key}")
    return list(dict.fromkeys(ids))


def named(text: str | None) -> list[str]:
    """The ids of the records an HTML text links or names by arXiv id."""
    return linked_ids(html.unescape(m[1] or m[2]) for m in LINK.finditer(text or ""))


class Matcher:
    """Scores an item's text against the titles of the records of the labs it names: the IDF-weighted share of a title's
    words that the item uses, counted when it uses at least three of them (all of a shorter title)."""

    TOP = 3
    SHARED = 3

    def __init__(self, entries: list[dict[str, Any]]):
        titled = [(e, set(words(f"{e.get('title')} {e.get('family_title', '')}"))) for e in entries]
        titled = [(e, t) for e, t in titled if len(t) >= 2]  # a one-word title matches anything
        df = Counter(w for _, t in titled for w in t)
        self.idf = {w: math.log((1 + len(titled)) / (1 + n)) + 1 for w, n in df.items()}
        self.records = [(e, t, sum(self.idf[w] for w in t)) for e, t in titled]

    def match(self, text: str, sources: Iterable[str]) -> list[tuple[float, dict[str, Any]]]:
        have, sources = set(words(text)), set(sources)
        scored: dict[str, tuple[float, dict[str, Any]]] = {}
        for e, title, total in self.records:
            shared = title & have
            if e["source"] not in sources or len(shared) < min(self.SHARED, len(title)):
                continue
            score = sum(self.idf[w] for w in shared) / total
            # One line per family: versions of one OpenAI manuscript share a family.
            group = f"{e['source']}:{e.get('family') or e['key']}"
            if score >= MIN_CONFIDENCE and score > scored.get(group, (0.0, {}))[0]:
                scored[group] = (score, e)
        return sorted(scored.values(), key=lambda s: -s[0])[: self.TOP]


# ---- Finders: each returns the candidates dated in the window ----


def in_window(day: str, start: dt.date, end: dt.date) -> bool:
    return start.isoformat() <= day[:10] <= end.isoformat()


def bibliography(key: str) -> list[str]:
    """The AI-made records a paper's bibliography links, read from its arXiv HTML; none when arXiv has no HTML for it."""
    try:
        page = S.get_text(f"https://arxiv.org/html/{key}")
    except (S.NotFound, S.SourceError):
        return []
    return [r for r in named(page) if not r.startswith(PAPERS)]


def arxiv_candidates(start: dt.date, end: dt.date) -> list[Candidate]:
    window = f"submittedDate:[{start:%Y%m%d}0000 TO {end:%Y%m%d}2359]"
    vendors = " OR ".join(f"cat:{c}" for c in VENDOR_CATEGORIES)
    query = f"({' OR '.join(f'abs:{name}' for name in LABS)}) AND {window} ANDNOT ({vendors})"
    return [candidate(e["url"], e["title"], e.get("authors", []), e.get("published", ""), e.get("summary", ""), "arXiv",
                      records=[*named(e.get("summary")), *bibliography(e["key"])], how="cites", full=f"{e['title']} {e.get('summary', '')}")
            for e in S.ArXiv().harvest(query, 500) if MENTIONS.search(f"{e['title']} {e.get('summary', '')}")]


def surname(name: str | None) -> str:
    """Craig from "Nathaniel Craig" or "Craig, N." (INSPIRE)."""
    name = (name or "").strip()
    return name.split(",")[0].strip() if "," in name else (name.split() or [""])[-1]


def citing(papers: Iterable[dict[str, Any] | None]) -> list[Candidate]:
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
            out.append(candidate(f"https://arxiv.org/abs/{key}", p.get("title") or "", [a.get("name") or "" for a in p.get("authors") or []],
                                 p.get("publicationDate") or "", S.trim(abstract), "arXiv", records=ids, how="cites"))
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


def inspire_candidates(start: dt.date, end: dt.date) -> list[Candidate]:
    """New physics papers that cite a record and name it in their abstract, with references from INSPIRE."""
    keys = [e["key"] for e in new_papers(start, end) if physics(e)]
    out = []
    for i in range(0, len(keys), INSPIRE_IDS):
        q = urllib.parse.urlencode({"q": " or ".join(f"arxiv:{k}" for k in keys[i:i + INSPIRE_IDS]), "size": INSPIRE_IDS, "fields": INSPIRE_FIELDS})
        hits = S.get_json(f"{INSPIRE}?{q}", cache=False)["hits"]["hits"]
        out += citing(inspire_paper(h["metadata"]) for h in hits if h["metadata"].get("arxiv_eprints"))
    return out


def semantic_scholar_candidates(start: dt.date, end: dt.date) -> list[Candidate]:
    """New papers outside physics that cite a record and name it in their abstract, with references from Semantic Scholar."""
    keys = [e["key"] for e in new_papers(start, end) if not physics(e)]
    api_key = os.environ.get("S2_API_KEY", "").strip()
    out = []
    for i in range(0, len(keys), S2_IDS):
        body = json.dumps({"ids": [f"ARXIV:{k}" for k in keys[i:i + S2_IDS]]}).encode()
        try:
            out += citing(S.get_json(S2_BATCH, data=body, cache=False, headers={"x-api-key": api_key} if api_key else None))
        except S.SourceError as err:
            raise S.SourceError(f"{err}{'' if api_key else '; set S2_API_KEY'}") from None
    return out


def stackexchange_candidates(host: str, start: dt.date, end: dt.date) -> list[Candidate]:
    """Questions and answers posted in the window that link a record or name an AI lab. One listing per kind,
    filtered here, uses less of the keyless API quota than a search per term."""
    window = {"fromdate": int(dt.datetime.combine(start, dt.time()).timestamp()), "todate": int(dt.datetime.combine(end, dt.time.max).timestamp())}
    out = []
    for kind in ("questions", "answers"):
        for page in range(1, 11):
            q = urllib.parse.urlencode({"site": S.STACKEXCHANGE[host], **window, "pagesize": 100, "page": page, "filter": "withbody"})
            data = S.get_json(f"https://api.stackexchange.com/2.3/{kind}?{q}", cache=False)
            time.sleep(data.get("backoff", 0))  # the API refuses the next request until then
            for item in data.get("items", []):
                full = f"{item.get('title', '')} {item.get('body', '')}"
                if (ids := named(item.get("body"))) or MENTIONS.search(full):
                    link = S.stackexchange_item(item)
                    url = item["link"] if kind == "questions" else f"https://{host}/a/{item['answer_id']}"  # an answer link credits its author
                    out.append(candidate(url, link["title"] or f"An answer on {host}", [link["author"]], link["date"], link["text"], host,
                                         records=ids, full=full))
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

    def body(el: ET.Element, *paths: str) -> str:
        """Escaped HTML, or Atom's inline XHTML serialized with its links."""
        for found in (el.find(p, FEED) for p in paths):
            if found is not None and (x := ((found.text or "") + "".join(ET.tostring(c, encoding="unicode") for c in found)).strip()):
                return x
        return ""

    for it in root.iter("item"):
        yield {"link": t(it, "link"), "title": t(it, "title"), "author": t(it, "dc:creator"), "date": rss_date(t(it, "pubDate")),
               "body": body(it, "content:encoded", "description")}
    owner = t(root, "a:author/a:name")
    for it in root.iter(f"{{{FEED['a']}}}entry"):
        link = next((x.get("href", "") for x in it.findall("a:link", FEED) if x.get("rel", "alternate") == "alternate"), "")
        yield {"link": link, "title": t(it, "a:title"), "author": t(it, "a:author/a:name") or owner,
               "date": S.iso_date(t(it, "a:published", "a:updated")), "body": body(it, "a:content", "a:summary")}


def blog_candidates(blog: Blog, start: dt.date, end: dt.date) -> list[Candidate]:
    """The blog's posts dated in the window, credited to the full name blogs.json gives for the feed's author."""
    out = []
    for p in posts(S.get(blog["feed"], cache=False)):
        if in_window(p["date"], start, end):
            author = blog.get("authors", {}).get(p["author"], "") if p["author"] else blog.get("author", "")
            out.append(candidate(p["link"], S.clean(p["title"]), [author or p["author"]], p["date"], S.trim(p["body"]), blog["name"],
                                 records=named(p["body"]), full=f"{p['title']} {p['body']}", author=author))
    return out


def post_links(p: dict[str, Any]) -> list[str]:
    """The URLs a Bluesky post links: in its text and its link card."""
    record = p.get("record") or {}
    facets = [f.get("uri", "") for facet in record.get("facets") or [] for f in facet.get("features") or []]
    return [u for u in [*facets, ((record.get("embed") or {}).get("external") or {}).get("uri", "")] if u]


def bluesky_candidates(start: dt.date, end: dt.date) -> list[Candidate]:
    """Posts in the window that link the labs' records, or a record that already has responses (found by its URL).
    Accounts that post every new paper are left out; each author's profile text is shown so a person can tell who they are."""
    searches = [(q, None) for q in BSKY_SEARCHES] + [({"url": e["url"]}, I.rid(e)) for e in live(I.DISCUSSED, [])]
    found: dict[str, tuple[dict[str, Any], list[str]]] = {}
    for search, rid in searches:
        q = urllib.parse.urlencode({"q": "*", **search, "sort": "latest", "limit": 100})
        for p in S.get_json(f"{BSKY}/app.bsky.feed.searchPosts?{q}", cache=False).get("posts", []):
            a = p.get("author") or {}
            ids = [rid] if rid else linked_ids(post_links(p))
            if ids and in_window(p["record"].get("createdAt", ""), start, end) and not BOT.search(f"{a.get('handle', '')} {a.get('displayName', '')}"):
                found.setdefault(p["uri"], (p, []))[1].extend(ids)
    dids = sorted({p["author"]["did"] for p, _ in found.values()})
    bios = {}
    for i in range(0, len(dids), 25):
        q = urllib.parse.urlencode([("actors", d) for d in dids[i:i + 25]])
        bios |= {x["did"]: x.get("description") or "" for x in S.get_json(f"{BSKY}/app.bsky.actor.getProfiles?{q}", cache=False).get("profiles", [])}
    out = []
    for p, ids in found.values():
        a = p["author"]
        name = f"{a.get('displayName') or a['handle']} (@{a['handle']}; {S.trim(bios.get(a['did']), 120) or 'no profile text'})"
        out.append(candidate(f"https://bsky.app/profile/{a['handle']}/post/{p['uri'].rsplit('/', 1)[-1]}", "", [name], p["record"]["createdAt"][:10],
                             S.trim(p["record"].get("text")), "Bluesky", records=dict.fromkeys(ids)))
    return out


FINDERS = (("arXiv", arxiv_candidates), ("INSPIRE citations", inspire_candidates), ("Semantic Scholar citations", semantic_scholar_candidates),
           *((host, functools.partial(stackexchange_candidates, host)) for host in SE_SITES),
           *((b["name"], functools.partial(blog_candidates, b)) for b in BLOGS), ("Bluesky", bluesky_candidates))


def report(candidates: list[Candidate], matcher: Matcher, linked: dict[str, dict[str, Any]], known: set[tuple[str, str]],
           start: dt.date, end: dt.date, errors: list[str]) -> str:
    """The items that match a record not already linked to them or listed for it. `linked` holds the records the items
    name. An item that names none, and is not linked or listed already, is matched by title if it names an AI lab."""
    lines = [f"# Candidate responses, {start} to {end}", "",
             "Found by `candidates.py`; nothing is attached. Read each one, and if it responds to the record, run the command "
             "under it (only voices with a public scholarly record, as the README says).", ""]
    lines += [f"> Not searched: {e}" for e in errors] + ([""] if errors else [])
    seen = {u for _, u in known}

    def matches(c: Candidate) -> list[tuple[float, str, dict[str, Any]]]:
        url = S.identity(c["url"])
        found = [(1.0, c["how"], linked[r]) for r in c["records"] if r in linked and r != url]
        if not found and url not in seen:
            found = [(s, f"title {s:.0%}", e) for s, e in matcher.match(f"{c['title']} {c['text']}", c["labs"])]
        return [m for m in found if (I.rid(m[2]), url) not in known]

    matched = sorted(((c, m) for c in candidates if (m := matches(c))), key=lambda cm: (cm[1][0][1].startswith("title"), -cm[1][0][0]))
    if not matched:
        return "\n".join(lines + [f"No candidates ({len(candidates)} new items read, none matched a record).", ""])
    lines.append(f"{len(matched)} of {len(candidates)} new items match a record.")
    by_title = False
    for c, m in matched:
        if not by_title and (by_title := m[0][1].startswith("title")):
            lines += ["", "---", "", "The items below name no record. They name an AI lab and share words with these records' titles, so "
                      "check that they are about the record."]
        who = ", ".join(c["authors"][:4]) + (" et al." if len(c["authors"]) > 4 else "")
        lines += ["", f"## [{c['title'] or S.trim(c['text'], 80)}]({c['url']})", f"{c['where']}, {c['date']}, {who}", ""]
        author = f" --author {shlex.quote(c['author'])}" if c["author"] else ""
        for _, how, e in m:
            lines.append(f"- {how} `{I.rid(e)}`: {e.get('title')}")
            lines.append(f"  `python3 indexer/index.py discuss {I.rid(e)} {shlex.quote(c['url'])}{author}`")
    return "\n".join(lines) + "\n"


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--until", type=dt.date.fromisoformat, default=dt.date.today())
    ap.add_argument("--out", type=Path, help="write the report here (default: print it)")
    a = ap.parse_args(list(argv) if argv is not None else None)
    start, end = a.until - dt.timedelta(days=a.days - 1), a.until
    entries = live("source <> ALL(%s)", [sorted(SKIP_SOURCES)])
    candidates: list[Candidate] = []
    errors = []
    for name, find in FINDERS:
        try:
            candidates += find(start, end)
        except Exception as err:  # a source that is down or changed its replies costs its own items, not the report
            errors.append(f"{name} ({type(err).__name__}: {err})")
    ids = sorted({r for c in candidates for r in c["records"] if not r.startswith("https://")})
    linked = {I.rid(e): e for e in live("id = ANY(%s)", [ids])} if ids else {}
    if any(r.startswith("https://") for c in candidates for r in c["records"]):
        for e in live("source = 'web'", []):
            if e.get("url"):
                linked[S.identity(e["url"])] = e
    known = attached([*entries, *linked.values()]) | (reported(a.out.parent, start, end) if a.out else set())
    text = report(candidates, Matcher(entries), linked, known, start, end, errors)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text)
        print(a.out)
    else:
        sys.stdout.write(text)
    return 1 if len(errors) == len(FINDERS) else 0


if __name__ == "__main__":
    sys.exit(main())
