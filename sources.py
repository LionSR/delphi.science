"""Source adapters for the open index: one class per place a research output can live.

Each adapter knows three things about its source:

  match(url)      -> key or None   Is this URL (or bare ID) one of ours? The key names the entry file.
  fetch(key)      -> entry         The record's metadata, read from the source itself.
  harvest(q, n)   -> entries       Up to n records, from a search query or the source's own listing.

Entries are plain dicts in the open-index format (see README.md). Nothing is typed in by hand:
every field comes from the source. A record that cannot be read raises NotFound or SourceError,
and no partial entry is ever written.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterator

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
USER_AGENT = "open-index-prototype/0.1 (+https://agenticpapers.app; research index, metadata only)"
SUMMARY_CHARS = 600


class NotFound(Exception):
    """The record does not exist or is not public."""


class SourceError(Exception):
    """The source answered, but not in the shape this adapter expects."""


# ---- HTTP: one request at a time, cached, with a per-host delay ----

_last_hit: dict[str, float] = {}
DELAY = {"data.palomar-registry.org": 0.1, "www.anthropic.com": 1.0, "aixiv.science": 1.0, "ai.vixra.org": 1.0, "jaigp.org": 1.0, "www.clawxiv.org": 0.5, "export.arxiv.org": 3.0}
TOKEN: str | None = None  # GitHub token, set by index.py


def get(url: str, *, accept: str | None = None, cache: bool = True, max_age: float = 86400) -> bytes:
    host = urllib.parse.urlsplit(url).hostname or ""
    path = CACHE / hashlib.sha1(f"{accept}|{url}".encode()).hexdigest()
    if cache and path.exists() and time.time() - path.stat().st_mtime < max_age:
        return path.read_bytes()
    wait = DELAY.get(host, 0.2) - (time.time() - _last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    if host == "api.github.com" and TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    try:
        for attempt in (1, 2):  # one retry: arXiv in particular times out now and then
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as r:
                    body = r.read()
                break
            except (TimeoutError, ConnectionResetError):
                if attempt == 2:
                    raise SourceError(f"timed out reading {url}") from None
                time.sleep(5)
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == 2:
                    raise
                time.sleep(int(e.headers.get("Retry-After") or 20))  # rate limited: wait as asked, once
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            raise NotFound(url) from None
        raise SourceError(f"HTTP {e.code} from {url}") from None
    except urllib.error.URLError as e:
        raise SourceError(f"cannot reach {url}: {e.reason}") from None
    finally:
        _last_hit[host] = time.time()
    if cache:
        CACHE.mkdir(exist_ok=True)
        path.write_bytes(body)
    return body


def get_json(url: str, **kw: Any) -> Any:
    try:
        return json.loads(get(url, accept=kw.pop("accept", "application/json"), **kw))
    except json.JSONDecodeError:
        raise SourceError(f"{url} did not return JSON") from None


def get_text(url: str, **kw: Any) -> str:
    return get(url, **kw).decode("utf-8", "replace")


# ---- Small text helpers ----


# Some sites (ai.viXra) write characters outside the BMP as two UTF-16 halves: &#55349;&#56395;.
SURROGATE_PAIR = re.compile(r"&#(5[5-6]\d{3});&#(5[6-7]\d{3});")


def _join_pair(m: re.Match[str]) -> str:
    hi, lo = int(m[1]), int(m[2])
    if 0xD800 <= hi <= 0xDBFF and 0xDC00 <= lo <= 0xDFFF:
        return chr(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00))
    return m[0]


def clean(text: str | None) -> str:
    """Collapse whitespace and HTML entities; drop tags."""
    text = SURROGATE_PAIR.sub(_join_pair, text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def trim(text: str | None, n: int = SUMMARY_CHARS) -> str:
    text = clean(text)
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def iso_date(text: str | None) -> str:
    """Accepts 2026-10-22T…, 2026/10/22, or 2026-10-22; returns YYYY-MM-DD or ''."""
    m = re.search(r"(\d{4})[-/](\d{2})[-/](\d{2})", text or "")
    return f"{m[1]}-{m[2]}-{m[3]}" if m else ""


class MetaParser(HTMLParser):
    """Collects <meta name|property=… content=…> (repeated names become lists) and <title>."""

    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, list[str]] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "meta" and a.get("content") is not None:
            name = (a.get("name") or a.get("property") or "").lower()
            if name:
                self.meta.setdefault(name, []).append(a["content"] or "")
        self._in_title = tag == "title"

    def handle_endtag(self, tag: str) -> None:
        self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data

    def one(self, name: str) -> str:
        """The first value of a meta tag, or ''."""
        return (self.meta.get(name) or [""])[0]


def page_meta(url: str) -> MetaParser:
    p = MetaParser()
    p.feed(get_text(url))
    return p


def from_citation_meta(m: MetaParser) -> dict[str, Any]:
    """Highwire Press citation_* tags, which most scholarly sites (and Google Scholar) use."""
    one = m.one
    return {
        "title": clean(one("citation_title") or one("og:title")),
        "authors": [clean(a) for a in m.meta.get("citation_author", []) if clean(a)],
        "summary": trim(one("citation_abstract") or one("og:description") or one("description")),
        "published": iso_date(one("citation_publication_date") or one("citation_online_date") or one("citation_date")),
        "pdf": one("citation_pdf_url"),
    }


# ---- Adapters ----


class Source:
    name = ""  # the source label, and the folder under entries/
    label = ""  # shown on the page
    origin = ""  # "ai-generated" when the venue declares its papers are
    patterns: list[str] = []

    def match(self, url: str) -> str | None:
        for p in self.patterns:
            m = re.match(p, url.strip())
            if m:
                return self.key_of(m)
        return None

    def key_of(self, m: re.Match[str]) -> str:
        return m.group(1)

    def fetch(self, key: str) -> dict[str, Any]:
        raise NotImplementedError

    def fetch_url(self, url: str) -> dict[str, Any]:
        return self.fetch(self.match(url) or "")

    def refetch(self, entry: dict[str, Any]) -> dict[str, Any]:
        """The record again, for refresh."""
        return self.fetch(entry["key"])

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        raise NotImplementedError(f"{self.name} has no harvest")

    def entry(self, key: str, **fields: Any) -> dict[str, Any]:
        e = {"key": key, "source": self.name, **fields}
        if self.origin and "origin" not in fields:
            e["origin"] = self.origin
        if not e.get("title"):
            raise SourceError(f"{self.name}:{key} has no title")
        return e


class GitHub(Source):
    name, label = "github", "GitHub"
    patterns = [r"^(?:https?://)?github\.com/([\w.-]+/[\w.-]+?)(?:\.git)?(?:/.*)?$", r"^(?!10\.\d)([\w.-]+/[\w.-]+)$"]

    def key_of(self, m: re.Match[str]) -> str:
        return m.group(1).replace("/", "__")

    def fetch(self, key: str) -> dict[str, Any]:
        repo = key.replace("__", "/", 1)
        d = get_json(f"https://api.github.com/repos/{repo}")
        if d.get("private"):
            raise NotFound(repo)
        return self.from_api(d)

    def from_api(self, d: dict[str, Any]) -> dict[str, Any]:
        repo = d["full_name"]
        try:
            files = {f["name"] for f in get_json(f"https://api.github.com/repos/{repo}/contents/")}
        except (NotFound, SourceError):
            files = set()
        return self.entry(
            repo.replace("/", "__"),
            url=d["html_url"],
            title=d["name"].replace("-", " ").replace("_", " "),
            authors=[d["owner"]["login"]],
            summary=trim(d.get("description")),
            tags=d.get("topics") or [],
            published=iso_date(d.get("created_at")),
            updated=iso_date(d.get("pushed_at")),
            stars=d.get("stargazers_count", 0),
            agent_ready=bool(files & {"AGENTS.md", "CLAUDE.md"}),
        )

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        q = urllib.parse.quote(query or "")
        items = get_json(f"https://api.github.com/search/repositories?q={q}&sort=updated&per_page={min(limit, 100)}").get("items", [])
        for d in items[:limit]:
            yield self.from_api(d)


class ArXiv(Source):
    name, label = "arxiv", "arXiv"
    patterns = [r"^(?:https?://)?(?:www\.)?arxiv\.org/(?:abs|pdf|html)/([\w./-]+?)(?:v\d+)?(?:\.pdf)?/?$", r"^(?:arXiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$"]
    NS = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}

    def _query(self, params: str) -> list[ET.Element]:
        root = ET.fromstring(get(f"https://export.arxiv.org/api/query?{params}"))
        return [e for e in root.findall("a:entry", self.NS) if e.find("a:title", self.NS) is not None]

    def _entry(self, e: ET.Element) -> dict[str, Any]:
        t = lambda p: (e.findtext(p, "", self.NS) or "").strip()  # noqa: E731
        key = re.sub(r"v\d+$", "", t("a:id").rsplit("/abs/", 1)[-1])
        cat = e.find("x:primary_category", self.NS)
        return self.entry(
            key,
            url=f"https://arxiv.org/abs/{key}",
            title=clean(t("a:title")),
            authors=[clean(a.findtext("a:name", "", self.NS)) for a in e.findall("a:author", self.NS)],
            summary=trim(t("a:summary")),
            domain=cat.get("term", "") if cat is not None else "",
            tags=[c.get("term", "") for c in e.findall("a:category", self.NS)],
            published=iso_date(t("a:published")),
            updated=iso_date(t("a:updated")),
        )

    def fetch(self, key: str) -> dict[str, Any]:
        found = self._query(f"id_list={urllib.parse.quote(key)}")
        if not found:
            raise NotFound(f"arXiv:{key}")
        return self._entry(found[0])

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        q = urllib.parse.quote(query or "")
        for e in self._query(f"search_query={q}&sortBy=submittedDate&sortOrder=descending&max_results={limit}"):
            yield self._entry(e)


class Zenodo(Source):
    name, label = "zenodo", "Zenodo"
    patterns = [r"^(?:https?://)?zenodo\.org/(?:records?|doi/10\.5281/zenodo\.)/?(\d+)", r"^(?:https?://doi\.org/)?10\.5281/zenodo\.(\d+)$"]

    def _entry(self, d: dict[str, Any]) -> dict[str, Any]:
        m = d.get("metadata", {})
        return self.entry(
            str(d["id"]),
            url=d.get("links", {}).get("self_html") or f"https://zenodo.org/records/{d['id']}",
            title=clean(m.get("title")),
            authors=[clean(c.get("name")) for c in m.get("creators", [])],
            summary=trim(m.get("description")),
            tags=m.get("keywords") or [],
            domain=(m.get("resource_type") or {}).get("type", ""),
            published=iso_date(m.get("publication_date")),
            doi=d.get("doi", ""),
        )

    def fetch(self, key: str) -> dict[str, Any]:
        return self._entry(get_json(f"https://zenodo.org/api/records/{key}"))

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        q = urllib.parse.quote(query or "")
        hits = get_json(f"https://zenodo.org/api/records?q={q}&sort=mostrecent&size={min(limit, 25)}").get("hits", {}).get("hits", [])
        for d in hits[:limit]:
            yield self._entry(d)


class HuggingFace(Source):
    name, label = "huggingface", "Hugging Face"
    patterns = [r"^(?:https?://)?huggingface\.co/((?:datasets/|spaces/)?[\w.-]+/[\w.-]+)/?$"]

    def key_of(self, m: re.Match[str]) -> str:
        path = m.group(1)
        kind = path.split("/")[0] if path.startswith(("datasets/", "spaces/")) else "models"
        return f"{kind}__{path.removeprefix(kind + '/').replace('/', '__')}"

    def fetch(self, key: str) -> dict[str, Any]:
        kind, rest = key.split("__", 1)
        repo = rest.replace("__", "/", 1)
        d = get_json(f"https://huggingface.co/api/{kind}/{repo}")
        page = "" if kind == "models" else f"{kind}/"
        card = d.get("cardData") or {}
        return self.entry(
            key,
            url=f"https://huggingface.co/{page}{repo}",
            title=repo.split("/")[-1].replace("-", " "),
            authors=[d.get("author") or repo.split("/")[0]],
            summary=trim(card.get("description") or (d.get("description") if isinstance(d.get("description"), str) else "")),
            tags=[t for t in d.get("tags", []) if ":" not in t][:12],
            domain=kind.rstrip("s"),
            published=iso_date(d.get("createdAt")),
            updated=iso_date(d.get("lastModified")),
        )


class ClawXiv(Source):
    """clawxiv.org: a preprint server for AI research agents, with a public JSON API."""

    name, label, origin = "clawxiv", "clawXiv", "ai-generated"
    patterns = [r"^(?:https?://)?(?:www\.)?clawxiv\.org/abs/(clawxiv\.[\d.]+)", r"^(clawxiv\.\d{4}\.\d+)$"]
    API = "https://www.clawxiv.org/api/v1"

    def _entry(self, p: dict[str, Any]) -> dict[str, Any]:
        pid = p.get("id") or p["paper_id"]  # the list says "id", the single-paper route "paper_id"
        return self.entry(
            pid,
            url=p.get("url") or f"https://clawxiv.org/abs/{pid}",
            title=clean(p.get("title")),
            authors=[clean(a.get("name")) for a in p.get("authors", [])],
            summary=trim(p.get("abstract")),
            tags=p.get("categories") or [],
            domain=(p.get("categories") or [""])[0],
            published=iso_date(p.get("created_at")),
        )

    def fetch(self, key: str) -> dict[str, Any]:
        return self._entry(get_json(f"{self.API}/papers/{key}"))

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        page = 1
        while True:
            d = get_json(f"{self.API}/papers?page={page}&limit=100")
            yield from map(self._entry, d.get("papers", []))
            if not d.get("hasMore"):
                return
            page += 1


class AiXiv(Source):
    """aixiv.science: AI- and human-authored papers; each abstract page carries citation_* tags."""

    name, label = "aixiv", "aiXiv"
    patterns = [r"^(?:https?://)?aixiv\.science/(?:abs|pdf)/(aixiv\.\d{6}\.\d+)", r"^(aixiv\.\d{6}\.\d+)$"]
    ROW = re.compile(r'href="https://aixiv\.science/abs/(aixiv\.\d{6}\.\d+)".*?</li>', re.S)

    def fetch(self, key: str, ai: bool | None = None) -> dict[str, Any]:
        url = f"https://aixiv.science/abs/{key}"
        f = from_citation_meta(page_meta(url))
        if not f["title"] or f["title"].startswith("aiXiv - "):
            raise NotFound(url)
        # The list badges each paper "AI" or "human"; the authors' "(AI)" suffix says the same on the page.
        ai = ai if ai is not None else any(a.endswith("(AI)") for a in f["authors"])
        if f["summary"].startswith("aiXiv - "):  # no abstract: the page falls back to the site's tagline
            f["summary"] = ""
        return self.entry(
            key, url=url, title=f["title"], authors=f["authors"], summary=f["summary"], published=f["published"],
            **({"origin": "ai-generated"} if ai else {}),
        )

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        listing = get_text("https://aixiv.science/list", max_age=3600)
        rows = [(m.group(1), "badge-ai" in m.group(0)) for m in self.ROW.finditer(listing)]
        if not rows:
            raise SourceError("https://aixiv.science/list: no papers found; the page layout may have changed")
        for key, ai in rows[:limit]:
            yield self.fetch(key, ai)


class AiViXra(Source):
    """ai.viXra.org: open archive of AI-assisted e-prints. The /all/ listing carries each abstract."""

    name, label, origin = "aivixra", "ai.viXra", "ai-generated"
    patterns = [r"^(?:https?://)?ai\.vixra\.org/(?:abs|pdf)/(\d{4}\.\d{4})", r"^(?:ai\.viXra:)?(\d{4}\.\d{4})$"]
    BLOCK = re.compile(
        r'<a href="/abs/(\d{4}\.\d{4})">.*?submitted on (\d{4}-\d{2}-\d{2}).*?<h3>(.*?)</h3>\s*<p><b>Authors:</b>(.*?)<br/>.*?</p>\s*<p>(.*?)<b>Category:</b>\s*<a[^>]*>(.*?)</a>',
        re.S,
    )

    def match(self, url: str) -> str | None:
        return super().match(url) if "vixra" in url.lower() else None  # the bare YYMM.NNNN form is arXiv's

    def fetch(self, key: str) -> dict[str, Any]:
        url = f"https://ai.vixra.org/abs/{key}"
        page = get_text(url)
        m = MetaParser()
        m.feed(page)
        f = from_citation_meta(m)
        abstract = re.search(r'<div id="abstract">\s*<p>(.*?)</p>', page, re.S)
        category = re.search(r'<div id="category">.*?<h2>(.*?)</h2>', page, re.S)
        submitted = re.search(r"\[<a[^>]*>v1</a>\]\s*(\d{4}-\d{2}-\d{2})", page)
        return self.entry(
            key, url=url, title=f["title"], authors=f["authors"], summary=trim(abstract.group(1) if abstract else ""),
            domain=clean(category.group(1)) if category else "",
            published=submitted.group(1) if submitted else f["published"],  # first submission, as the listing shows
        )

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        listing = get_text("https://ai.vixra.org/all/", max_age=3600)
        blocks = self.BLOCK.findall(listing)
        if not blocks:
            raise SourceError("https://ai.vixra.org/all/: no papers found; the page layout may have changed")
        seen = set()
        for key, date, title, authors, abstract, category in blocks:
            if key in seen:  # replacements are listed again further down
                continue
            seen.add(key)
            yield self.entry(
                key,
                url=f"https://ai.vixra.org/abs/{key}",
                title=clean(title),
                authors=[clean(a) for a in re.findall(r"<a[^>]*>(.*?)</a>", authors)] or [clean(authors)],
                summary=trim(abstract),
                domain=clean(category),
                published=date,
            )


class Jaigp(Source):
    """jaigp.org, the Journal for AI Generated Papers: human prompters plus AI co-authors."""

    name, label, origin = "jaigp", "JAIGP", "ai-generated"
    patterns = [r"^(?:https?://)?jaigp\.org/paper/(\d+)"]

    def fetch(self, key: str) -> dict[str, Any]:
        url = f"https://jaigp.org/paper/{key}"
        page = get_text(url)
        m = MetaParser()
        m.feed(page)
        title = re.sub(r"\s+—\s+JAIGP$", "", clean(m.one("og:title")))
        byline = re.search(r"<!-- Author byline -->\s*<div[^>]*>(.*?)</div>", page, re.S)
        authors = [a for a in (clean(x) for x in re.split(r"·", byline.group(1))) if a] if byline else []
        abstract = re.search(r'<header class="paper-abstract">.*?<p>(.*?)</p>', page, re.S)
        if not title:
            raise NotFound(url)
        return self.entry(
            key, url=url, title=title, authors=authors,
            summary=trim(abstract.group(1) if abstract else m.one("og:description")),
            published=iso_date(m.one("article:published_time")),
        )

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        keys = re.findall(r"<loc>https://jaigp\.org/paper/(\d+)</loc>", get_text("https://jaigp.org/sitemap.xml", max_age=3600))
        if not keys:
            raise SourceError("https://jaigp.org/sitemap.xml: no papers found")
        for key in sorted(set(keys), key=int, reverse=True)[:limit]:
            try:
                yield self.fetch(key)
            except NotFound:
                continue


class AIScientist(Source):
    """The example papers written end to end by Sakana AI's The AI Scientist (github.com/SakanaAI/AI-Scientist)."""

    name, label, origin = "ai-scientist", "AI Scientist", "ai-generated"
    REPO = "SakanaAI/AI-Scientist"
    patterns = [r"^(?:https?://)?github\.com/SakanaAI/AI-Scientist/(?:blob|tree)/main/example_papers/([\w-]+?)(?:\.pdf)?/?$"]

    def fetch(self, key: str) -> dict[str, Any]:
        base = f"https://api.github.com/repos/{self.REPO}/contents/example_papers/{key}"
        title, abstract, authors = key.replace("_", " ").capitalize(), "", []
        tex = next((f for f in self._walk(base) if f["name"].endswith(".tex")), None)
        if tex:
            src = get_text(tex["download_url"])
            t = re.search(r"\\title\{(.+?)\}\s*\n", src, re.S)
            a = re.search(r"\\begin\{abstract\}(.*?)\\end\{abstract\}", src, re.S)
            title = clean(re.sub(r"\\\\|\\[a-z]+\{|\}", " ", t.group(1))) if t else title
            abstract = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{([^}]*)\})?", r"\3", a.group(1)) if a else ""
            # \author{GPT-4o \& Claude\\ Department …}: the names are the first line.
            au = re.search(r"\\author\{(.*?)(?:\\\\|\})", src, re.S)
            authors = [clean(au.group(1).replace("\\&", "&"))] if au else []
        return self.entry(
            key,
            url=f"https://github.com/{self.REPO}/blob/main/example_papers/{key}.pdf",
            title=title, authors=authors, summary=trim(abstract),
        )

    def _walk(self, url: str, depth: int = 2) -> Iterator[dict[str, Any]]:
        for f in get_json(url):
            if f["type"] == "file":
                yield f
            elif depth > 0 and f["name"] in ("latex", "paper"):
                yield from self._walk(f["url"], depth - 1)

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        names = [f["name"] for f in get_json(f"https://api.github.com/repos/{self.REPO}/contents/example_papers") if f["type"] == "dir"]
        for key in names[:limit]:
            yield self.fetch(key)


class OpenAIMath(Source):
    """github.com/openai/math: manuscripts by an internal OpenAI model, grouped into result families.

    Four files describe the whole release, so a harvest is a handful of requests, not one per paper:
    CONTENTS.md (every manuscript with its abstract, under its family), overview.tex (each family's
    discipline), lean/formalization.yaml (papers whose main result is formalized in Lean), and
    history.md (withdrawals). The key drops the folder's date, so a revised edition replaces the
    earlier one instead of becoming a second entry.
    """

    name, label, origin = "openai-math", "OpenAI Math", "ai-generated"
    REPO, RAW = "openai/math", "https://raw.githubusercontent.com/openai/math/main"
    patterns = [r"^(?:https?://)?github\.com/openai/math/(?:blob|tree)/main/preprints/([^/]+?)(?:/.*)?$"]
    DATED = re.compile(r"-(January|February|March|April|May|June|July|August|September|October|November|December)-(\d{1,2})-(\d{4})$")
    MONTHS = "January February March April May June July August September October November December".split()

    def key_of(self, m: re.Match[str]) -> str:
        return self.DATED.sub("", m.group(1))

    def _date(self, folder: str) -> str:
        m = self.DATED.search(folder)
        return f"{m[3]}-{self.MONTHS.index(m[1]) + 1:02d}-{int(m[2]):02d}" if m else ""

    @staticmethod
    def _norm(title: str) -> str:
        return re.sub(r"[^a-z0-9]", "", title.lower())

    def _catalogue(self) -> dict[str, dict[str, Any]]:
        if getattr(self, "_parsed", None) is None:
            self._parsed = self._parse()
        return self._parsed

    def _parse(self) -> dict[str, dict[str, Any]]:
        contents = get_text(f"{self.RAW}/CONTENTS.md", max_age=3600)
        overview = get_text(f"{self.RAW}/overview.tex", max_age=3600)
        lean = get_text(f"{self.RAW}/lean/formalization.yaml", max_age=3600)
        history = get_text(f"{self.RAW}/history.md", max_age=3600)

        discipline, current = {}, ""
        for m in re.finditer(r"\\cataloguesection\{([^}]*)\}\{\d+\}|\\resultentry\{(\d{3})\}", overview):
            if m[1]:
                current = m[1]
            elif current:
                discipline[m[2]] = current
        formalized = set(re.findall(r"id: \.\./preprints/([^/\s]+)/", lean))

        records: dict[str, dict[str, Any]] = {}
        family = family_title = ""
        for block in re.split(r"</td>\s*</tr></tbody>", contents):
            fam = re.search(r"\*\*(\d{3})\.\s+(.+?)\.\*\*", block)
            if fam:
                family, family_title = fam[1], clean(fam[2])
                continue
            # Folder names can contain parentheses ("CAT(0)"), so a link ends at ".pdf)".
            ms = re.search(r"&emsp;\[(.+?)\]\(preprints/([^/]+)/([^/]+?)\.pdf\)\s*(.*)", block, re.S)
            if not ms or not family:
                continue
            folder, file = ms[2], ms[3]
            key = self.DATED.sub("", folder)
            if key in records:  # two editions both listed, or two papers in one folder: keep both
                key = folder if file == "paper" else f"{folder}__{file}"
            records[key] = self.entry(
                key,
                url=f"https://github.com/{self.REPO}/tree/main/preprints/{folder}",
                pdf=f"https://github.com/{self.REPO}/blob/main/preprints/{folder}/{file}.pdf",
                title=clean(ms[1]),
                authors=["OpenAI"],
                summary=trim(ms[4]),
                domain=discipline.get(family, ""),
                published=self._date(folder),
                family=family,
                family_title=family_title,
                formalized=folder in formalized,
            )
        listed = contents.count("&emsp;[")
        if len(records) != listed:
            raise SourceError(f"{self.RAW}/CONTENTS.md lists {listed} manuscripts but {len(records)} were parsed")
        if len(records) < 100:
            raise SourceError(f"{self.RAW}/CONTENTS.md: only {len(records)} manuscripts parsed; the layout may have changed")

        # Withdrawn manuscripts are no longer in CONTENTS.md; history.md names them, and their folders remain.
        withdrawn = re.findall(r"^- (.+)$", history.split("**Withdrawals**", 1)[-1].split("**Fixes**", 1)[0], re.M)
        if withdrawn:
            folders = [f["name"] for f in get_json(f"https://api.github.com/repos/{self.REPO}/contents/preprints", max_age=3600)]
            for title in withdrawn:
                hits = sorted(f for f in folders if self._norm(self.DATED.sub("", f)) == self._norm(title))
                if hits:
                    folder = hits[-1]
                    key = self.DATED.sub("", folder)
                    # The folder's README is OpenAI's withdrawal notice: the gap, the date, the archived PDF.
                    notice = get_text(f"{self.RAW}/preprints/{folder}/README.md", max_age=3600)
                    body = notice.split("## Archived manuscript", 1)[0]
                    body = re.sub(r"^#.*$|^OpenAI\s*$|\*\*Withdrawn on [^*]+\*\*", "", body, flags=re.M)
                    on = re.search(r"Withdrawn on ([A-Z][a-z]+ \d{1,2}, \d{4})", notice)
                    archived = re.search(r"\[Pre-withdrawal PDF\]\((https://[^)]+)\)", notice)
                    records.setdefault(key, self.entry(
                        key, url=f"https://github.com/{self.REPO}/tree/main/preprints/{folder}", title=clean(title),
                        authors=["OpenAI"], published=self._date(folder), withdrawn=True,
                        withdrawn_on=dt.datetime.strptime(on[1], "%B %d, %Y").date().isoformat() if on else "",
                        pdf=archived[1] if archived else "",
                        summary=trim("Withdrawal notice: " + re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", body)),
                    ))
        return records

    def fetch(self, key: str) -> dict[str, Any]:
        rec = self._catalogue().get(key)
        if not rec:
            raise NotFound(f"openai/math: {key}")
        return rec

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        yield from list(self._catalogue().values())[:limit]


class Palomar(Source):
    """palomar-registry.org: Lean 4 formalizations machine-checked at one pinned commit (CC0 JSON API).

    The list API gives the summary; each full record (one more request) adds provenance: the papers a
    result formalizes or adapts, which links Lean results back to papers indexed from other sources.
    """

    name, label = "palomar", "Palomar"
    DATA = "https://data.palomar-registry.org"
    patterns = [r"^(PALOMAR-\d{4}-\d{2}-\d{2}-\d{6})$", r"^(?:https?://)?data\.palomar-registry\.org/(?:entries|versions)/(PALOMAR-\d{4}-\d{2}-\d{2}-\d{6})"]

    def _entry(self, e: dict[str, Any], full: dict[str, Any] | None) -> dict[str, Any]:
        src = e.get("source") or {}
        repo, commit, path = src.get("repository", ""), src.get("commit", ""), src.get("project_path", "")
        url = f"https://github.com/{repo}/tree/{commit}/{path}".rstrip("/") if repo else f"{self.DATA}/{e['path']}"
        cls = e.get("classification") or {}
        prov = (full or {}).get("provenance") or {}
        sources = [{k: clean(m.get(k)) for k in ("title", "identifier", "relationship")}
                   for m in prov.get("mathematical_sources", []) if m.get("relationship") in ("formalizes", "adapts")][:5]
        review = (full or {}).get("review") or {}
        return self.entry(
            e["id"],
            url=url,
            json=f"{self.DATA}/{e['path']}" if e.get("path") else "",
            title=clean(e.get("title")),
            authors=[clean(a.get("name")) for a in e.get("authors", [])],
            summary=trim(e.get("abstract")),
            domain=(cls.get("arxiv") or [""])[0],
            tags=[*(cls.get("arxiv") or []), *(f"msc:{m}" for m in cls.get("msc2020") or [])],
            published=iso_date(e.get("published_at") or (full or {}).get("first_registered_on")),
            formalized=True,
            verified=e.get("status") == "registered",  # Palomar lists a result once Lean kernels checked it at the pinned commit
            trust=(e.get("trust") or {}).get("level", ""),
            formalizes=sources,
            reviewer_models=review.get("reviewer_models", []),
            repo=f"https://github.com/{repo}" if repo else "",
            commit=commit,
        )

    def _full(self, e: dict[str, Any]) -> dict[str, Any] | None:
        try:
            return get_json(f"{self.DATA}/{e['path']}") if e.get("path") else None
        except (NotFound, SourceError):
            return None

    def fetch(self, key: str) -> dict[str, Any]:
        found = get_json(f"{self.DATA}/api/v1/results?id={key}").get("entries", [])
        if not found:
            raise NotFound(f"Palomar {key}")
        return self._entry(found[0], self._full(found[0]))

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        cursor = None
        while True:
            qs = "order=registered" + (f"&q={urllib.parse.quote(query)}" if query else "") + (f"&cursor={cursor}" if cursor else "")
            page = get_json(f"{self.DATA}/api/v1/results?{qs}", max_age=3600)
            for e in page.get("entries", []):
                yield self._entry(e, self._full(e))
            cursor = page.get("next")
            if not cursor:
                return


AI_NAMES = re.compile(r"\b(Claude|Anthropic|OpenAI|GPT[-\w.]*|Gemini|AlphaProof|AlphaEvolve|Aristotle|Codex|Grok|DeepSeek|Kimi|Qwen)\b", re.I)


class Formalization(Source):
    """Any GitHub project with a formalization.yaml (mathlib-initiative v0.4), e.g. anthropics/formal-math.

    The query names repositories ("owner/repo owner/repo"); the root and each top-level folder are checked.
    AI involvement is taken only from what the file declares: automation.methods[].models, or AI authors.
    """

    name, label = "lean", "Lean project"
    # Only a link to the file itself; other GitHub links stay GitHub records.
    patterns = [r"^(?:https?://)?github\.com/([\w.-]+/[\w.-]+)/blob/[^/]+/(?:([\w./-]+?)/)?formalization\.yaml$"]

    def key_of(self, m: re.Match[str]) -> str:
        return m[1].replace("/", "__") + (f"__{m[2].replace('/', '__')}" if m[2] else "")

    def _read(self, repo: str, folder: str) -> dict[str, Any] | None:
        import yaml  # PyYAML; only this adapter needs it

        info = get_json(f"https://api.github.com/repos/{repo}")
        branch = info.get("default_branch", "main")
        raw = f"https://raw.githubusercontent.com/{repo}/{branch}/" + (f"{folder}/" if folder else "")
        try:
            doc = yaml.safe_load(get_text(raw + "formalization.yaml")) or {}
        except NotFound:
            doc = None
        if doc is None:  # no catalogue file: the folder's README heading and first paragraph
            try:
                readme = get_text(raw + "README.md")
            except NotFound:
                return None
            head = re.search(r"^#\s+(.+)$", readme, re.M)
            para = next((b for b in re.split(r"\n\s*\n", readme) if b.strip() and not b.lstrip().startswith(("#", "!", "[!", "<", "|", "```"))), "")
            doc = {"project": {"name": head[1] if head else folder, "description": para}}
        proj = doc.get("project") or {}
        models = sorted({str(m) for meth in (doc.get("automation") or {}).get("methods", []) or [] for m in meth.get("models", []) or []})
        authors = [str(a) for a in proj.get("authors", []) or []]
        ai = models or [a for a in authors if AI_NAMES.search(a)]
        papers = [{"title": clean(x.get("title")), "identifier": clean(str(x.get("id", ""))), "relationship": "formalizes"}
                  for x in doc.get("sources", []) or [] if isinstance(x, dict) and x.get("type") in ("article", None)][:5]
        key = f"{repo.replace('/', '__')}__{folder.replace('/', '__')}" if folder else repo.replace("/", "__")
        return self.entry(
            key,
            url=f"https://github.com/{repo}/tree/{branch}/{folder}".rstrip("/"),
            title=clean(proj.get("name")) or folder or repo,
            authors=authors or [repo.split("/")[0]],
            summary=trim(proj.get("description")),
            published=iso_date(info.get("created_at")),
            updated=iso_date(info.get("pushed_at")),
            formalized=True,
            formalizes=papers,
            ai_models=models,
            license=str(proj.get("license") or (info.get("license") or {}).get("spdx_id") or ""),
            repo=f"https://github.com/{repo}",
            **({"origin": "ai-generated"} if ai else {}),
        )

    def fetch(self, key: str) -> dict[str, Any]:
        parts = key.split("__")
        rec = self._read("/".join(parts[:2]), "/".join(parts[2:]))
        if not rec:
            raise NotFound(key)
        return rec

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        for repo in (query or "").split():
            listing = get_json(f"https://api.github.com/repos/{repo}/contents/")
            names = {f["name"] for f in listing}
            folders = [""] if "formalization.yaml" in names else [f["name"] for f in listing if f["type"] == "dir" and not f["name"].startswith(".")]
            for folder in folders:
                rec = self._read(repo, folder)
                if rec:
                    yield rec


class AnthropicScience(Source):
    """anthropic.com/science: Anthropic's posts on research done with Claude. Each post's own meta tags."""

    name, label = "anthropic-science", "Anthropic Science"
    patterns = [r"^(?:https?://)?(?:www\.)?anthropic\.com/research/([\w-]+)/?$"]

    def fetch(self, key: str) -> dict[str, Any]:
        url = f"https://www.anthropic.com/research/{key}"
        m = page_meta(url)
        one = m.one
        return self.entry(
            key, url=url, title=clean(one("og:title") or m.title), authors=["Anthropic"],
            summary=trim(one("og:description") or one("description")), published=iso_date(one("article:published_time")),
        )

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        page = get_text("https://www.anthropic.com/science", max_age=3600)
        keys = list(dict.fromkeys(re.findall(r'href="/research/([a-z0-9-]+)"', page)))
        if not keys:
            raise SourceError("https://www.anthropic.com/science: no posts found; the page layout may have changed")
        for key in keys[:limit]:
            yield self.fetch(key)


class Doi(Source):
    """Any DOI, resolved through doi.org content negotiation (Crossref, DataCite, …)."""

    name, label = "doi", "DOI"
    patterns = [r"^(?:https?://(?:dx\.)?doi\.org/|doi:)?(10\.\d{4,9}/\S+)$"]

    def key_of(self, m: re.Match[str]) -> str:
        return m.group(1).replace("/", "__")

    def fetch(self, key: str) -> dict[str, Any]:
        doi = key.replace("__", "/")
        d = get_json(f"https://doi.org/{urllib.parse.quote(doi, safe='/')}", accept="application/vnd.citationstyles.csl+json")
        parts = ((d.get("issued") or {}).get("date-parts") or [[]])[0]
        return self.entry(
            key,
            url=f"https://doi.org/{doi}",
            title=clean(d.get("title") if isinstance(d.get("title"), str) else (d.get("title") or [""])[0]),
            authors=[clean(f"{a.get('given', '')} {a.get('family', '')}") or clean(a.get("literal")) for a in d.get("author", [])],
            summary=trim(d.get("abstract")),
            domain=d.get("type", ""),
            published="-".join(f"{p:02d}" for p in parts) if len(parts) == 3 else "",
            doi=doi,
        )


class Web(Source):
    """Anything else: the page's own citation_* or Open Graph tags."""

    name, label = "web", "Web"
    patterns = [r"^(https?://\S+)$"]

    def key_of(self, m: re.Match[str]) -> str:
        return hashlib.sha1(m.group(1).encode()).hexdigest()[:12]

    def fetch_url(self, url: str) -> dict[str, Any]:
        m = page_meta(url)
        f = from_citation_meta(m)
        return self.entry(
            self.match(url) or "", url=url, title=f["title"] or clean(m.title), authors=f["authors"],
            summary=f["summary"], published=f["published"],
        )

    def refetch(self, entry: dict[str, Any]) -> dict[str, Any]:
        return self.fetch_url(entry["url"])


# Order matters: the first adapter that matches wins, so specific ones come before GitHub, DOI and Web.
SOURCES: list[Source] = [OpenAIMath(), Palomar(), AnthropicScience(), AIScientist(), ClawXiv(), AiXiv(), AiViXra(), Jaigp(), ArXiv(), Zenodo(), HuggingFace(), Formalization(), GitHub(), Doi(), Web()]
BY_NAME = {s.name: s for s in SOURCES}


def detect(url: str) -> tuple[Source, str]:
    """The adapter and key for a URL or bare ID. Raises ValueError if nothing matches."""
    for s in SOURCES:
        key = s.match(url)
        if key:
            return s, key
    raise ValueError(f"not a URL or a known ID: {url!r}")


def fetch(url: str) -> dict[str, Any]:
    s, _ = detect(url)
    return s.fetch_url(url.strip())


def today() -> str:
    return dt.date.today().isoformat()
