"""Source adapters: one class per site or registry that hosts research outputs.

Each adapter has match(url) -> key or None, fetch(key) -> entry, and harvest(query, n) -> entries.
Entries are plain dicts in the shape of the Entry schema (site/lib/api/openapi.ts). A record that cannot be
read raises NotFound or SourceError.
"""

from __future__ import annotations

import datetime as dt
import functools
import hashlib
import html
import json
import re
import subprocess
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


# ---- HTTP: cached, with a per-host delay ----

_last_hit: dict[str, float] = {}
DELAY = {"data.palomar-registry.org": 0.1, "www.anthropic.com": 1.0, "export.arxiv.org": 3.0, "arxiv.org": 1.0, "hexagonmath.org": 0.5}
TOKEN: str | None = None  # GitHub token, set by index.py


def get(url: str, *, accept: str | None = None, cache: bool = True, max_age: float = 86400, data: bytes | None = None,
        headers: dict[str, str] | None = None) -> bytes:
    """The body at url; with data, the body of a POST of that JSON. Extra headers are not part of the cache key."""
    host = urllib.parse.urlsplit(url).hostname or ""
    path = CACHE / hashlib.sha1(f"{accept}|{url}".encode() + (b"|" + data if data else b"")).hexdigest()
    if cache and path.exists() and time.time() - path.stat().st_mtime < max_age:
        return path.read_bytes()
    wait = DELAY.get(host, 0.2) - (time.time() - _last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    headers = {"User-Agent": USER_AGENT, **(headers or {})}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if accept:
        headers["Accept"] = accept
    if host == "api.github.com" and TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    try:
        for attempt in (1, 2):  # retry once: arXiv sometimes times out
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=45) as r:
                    body = r.read()
                break
            except (TimeoutError, ConnectionResetError):
                if attempt == 2:
                    raise SourceError(f"timed out reading {url}") from None
                time.sleep(5)
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == 2:
                    raise
                time.sleep(int(e.headers.get("Retry-After") or 20))  # rate limited: wait as long as Retry-After says, once
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


def get_json(url: str, accept: str = "application/json", **kw: Any) -> Any:
    try:
        return json.loads(get(url, accept=accept, **kw))
    except json.JSONDecodeError:
        raise SourceError(f"{url} did not return JSON") from None


def get_text(url: str, **kw: Any) -> str:
    return get(url, **kw).decode("utf-8", "replace")


# ---- Text helpers ----

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
    """Collects <meta name|property=… content=…> (repeated names become lists), <title>, and the first
    <h1> and <p>, for pages that carry no metadata at all."""

    def __init__(self, text: str = "") -> None:
        super().__init__()
        self.meta: dict[str, list[str]] = {}
        self.title = self.h1 = self.p = ""
        self._in_title = False
        self._in = ""  # "h1" or "p" while inside the first of each
        if text:
            self.feed(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "meta" and a.get("content") is not None:
            name = (a.get("name") or a.get("property") or "").lower()
            if name:
                self.meta.setdefault(name, []).append(a["content"] or "")
        self._in_title = tag == "title" and not self.title  # the document's title, not the SVG icons' <title>s after it
        if tag in ("h1", "p") and not getattr(self, tag) and not self._in:
            self._in = tag

    def handle_endtag(self, tag: str) -> None:
        self._in_title = False
        if tag == self._in:
            self._in = ""

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._in:
            setattr(self, self._in, getattr(self, self._in) + data)

    def one(self, name: str) -> str:
        """The first value of a meta tag, or ''."""
        return (self.meta.get(name) or [""])[0]


# ---- Discussion: posts and articles about a record ----

# An X post is read through X's oEmbed endpoint and keeps only link, author, handle and day (X's embed
# shows the text). Anything else is read from the page's own meta tags.
OEMBED = "https://publish.twitter.com/oembed"
X_HOSTS = {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}
LINK_CHARS = 300


def parse_oembed(data: dict[str, Any]) -> dict[str, Any]:
    """An X post from its oEmbed record: who wrote it and the day."""
    h = data.get("html", "")
    when = re.search(r">([A-Z][a-z]+ \d{1,2}, \d{4})</a>\s*</blockquote>", h)
    handle = (data.get("author_url") or "").rstrip("/").rsplit("/", 1)[-1]
    post = re.search(r"/status/(\d+)", data.get("url") or "")
    return {
        "kind": "x", "url": f"https://x.com/{handle}/status/{post[1]}" if handle and post else data.get("url", ""),
        "author": clean(data.get("author_name")), "handle": handle,
        "date": dt.datetime.strptime(when[1], "%B %d, %Y").date().isoformat() if when else "",
    }


def passage(page: str, fragment: str) -> tuple[str, str]:
    """Returns (prefix, the page's text from start onward) for a text-fragment URL
    (#:~:text=prefix-,start,end,-suffix). The prefix may name the person quoted. The fragment is still URL-encoded, so %2C is a literal comma."""
    text = clean(re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", page, flags=re.S | re.I))
    parts = [urllib.parse.unquote(x) for x in fragment.split(",")]
    prefix = clean(parts.pop(0)[:-1]) if parts[0].endswith("-") else ""
    start = clean(parts[0]) if parts else ""
    low = text.lower()
    after = low.find(prefix.lower()) if prefix else 0
    i = low.find(start.lower(), after) if start and after >= 0 else -1
    return (prefix, trim(text[i:], LINK_CHARS)) if i >= 0 else ("", "")


YOUTUBE_HOSTS = {"www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"}


def youtube(url: str, page: str) -> dict[str, str]:
    """A talk on YouTube: the channel as author (oEmbed), the upload date from the page."""
    try:
        data = get_json("https://www.youtube.com/oembed?" + urllib.parse.urlencode({"url": url, "format": "json"}), cache=False)
    except (NotFound, SourceError):
        return {}
    when = re.search(r'"publishDate":"(\d{4}-\d{2}-\d{2})', page)
    return {"title": clean(data.get("title")), "author": clean(data.get("author_name")), "date": when[1] if when else ""}


STACKEXCHANGE = {"mathoverflow.net": "mathoverflow", "math.stackexchange.com": "math", "cstheory.stackexchange.com": "cstheory",
                 "physics.stackexchange.com": "physics"}
# An answer: /a/<id>, /answers/<id>, or /questions/<question id>/<slug>/<answer id>, the link Stack Exchange shares.
SE_ANSWER = re.compile(r"/(?:a|answers)/(\d+)|/questions/\d+/[^/?#]+/(\d+)")
SE_QUESTION = re.compile(r"/questions/(\d+)")


def stackexchange(host: str, url: str) -> dict[str, str]:
    """A MathOverflow (or Stack Exchange) question or answer: its author, the day posted, the opening of the body."""
    path = urllib.parse.urlsplit(url).path
    if m := SE_ANSWER.search(path):
        kind, post = "answers", m[1] or m[2]
    elif m := SE_QUESTION.search(path):
        kind, post = "questions", m[1]
    else:
        return {}
    try:
        data = get_json(f"https://api.stackexchange.com/2.3/{kind}/{post}?site={STACKEXCHANGE[host]}&filter=withbody", cache=False)
    except (NotFound, SourceError):
        return {}
    q = (data.get("items") or [{}])[0]
    if not q:
        raise NotFound(url)
    if kind == "answers":  # an answer has no title of its own
        question = get_json(f"https://api.stackexchange.com/2.3/questions/{q['question_id']}?site={STACKEXCHANGE[host]}", cache=False)
        q["title"] = "Answer to: " + ((question.get("items") or [{}])[0].get("title") or "")
    return stackexchange_item(q)


def stackexchange_item(q: dict[str, Any]) -> dict[str, str]:
    """The title, author, opening text and date of a Stack Exchange API question or answer (filter=withbody)."""
    created = q.get("creation_date")
    return {"title": clean(q.get("title")), "author": clean((q.get("owner") or {}).get("display_name")),
            "text": trim(q.get("body"), LINK_CHARS), "date": dt.date.fromtimestamp(created).isoformat() if created else ""}


def discussion_link(url: str) -> dict[str, Any]:
    """Reads a discussion link from the post or page. Raises NotFound when the post or page is gone. A text-fragment URL
    (page#:~:text=a%20passage) quotes that passage."""
    url = url.strip()
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    if host in X_HOSTS:
        if not re.search(r"/status/\d+", url):
            raise ValueError(f"not a post: {url}")
        q = urllib.parse.urlencode({"url": url, "omit_script": "true", "dnt": "true"})
        link = parse_oembed(get_json(f"{OEMBED}?{q}", cache=False))
    else:
        link = web_link(url, parts, host)
    return {k: v for k, v in link.items() if v}


def page_author(m: MetaParser) -> str:
    """The page's author from its meta tags, or from a window title like "Post title | Asaf Karagila"."""
    # citation_author (arXiv, journals) is "Last, First"; shown as "First Last".
    authors = [" ".join(reversed(clean(a).split(", ", 1))) for a in m.meta.get("citation_author", []) if clean(a)]
    author = ", ".join(authors[:4]) + (" et al." if len(authors) > 4 else "") or clean(m.one("author") or m.one("article:author"))
    byline = re.split(r"\s+[|–—]\s+", clean(m.title))
    if not author and len(byline) > 1 and byline[-1] != clean(m.one("og:site_name")):
        author = byline[-1]
    return author


def web_link(url: str, parts: urllib.parse.SplitResult, host: str) -> dict[str, Any]:
    # Stack Exchange is read through its API only.
    body = b"" if host in STACKEXCHANGE else get(urllib.parse.urlunsplit(parts._replace(fragment="")), cache=False)
    if body.lstrip()[:5] == b"%PDF-":  # a note on someone's home page: its title and author are given by a person
        return {"kind": "web", "url": url, "site": host.removeprefix("www.")}
    page = body.decode("utf-8", "replace")
    who, quoted = passage(page, parts.fragment[len(":~:text="):]) if parts.fragment.startswith(":~:text=") else ("", "")
    if who:  # the URL keeps only the passage; the name goes in author
        url = urllib.parse.urlunsplit(parts._replace(fragment=":~:text=" + parts.fragment.split("-,", 1)[1]))
    m = MetaParser(page)
    one = m.one
    extra = youtube(url, page) if host in YOUTUBE_HOSTS else stackexchange(host, url) if host in STACKEXCHANGE else {}
    author = who or page_author(m)
    return {
        "kind": "web", "url": url,
        "title": extra.get("title") or clean(one("citation_title") or one("og:title") or m.title or m.h1),
        "site": clean(one("og:site_name")) or host.removeprefix("www."),
        "author": extra.get("author") or ("" if "://" in author else author),
        "text": quoted or extra.get("text") or trim(one("og:description") or one("description") or m.p, LINK_CHARS),
        "date": extra.get("date") or iso_date(one("article:published_time") or one("citation_publication_date") or one("citation_date")
                                              or one("citation_online_date") or one("date") or one("article:modified_time")),
    }


# ---- Adapters ----


class Source:
    name = ""  # the source label, and the first part of its record ids (<source>/<key>)
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
        """Fetches the record again, for refresh."""
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
            repo=d["html_url"],
            title=d["name"].replace("-", " ").replace("_", " "),
            authors=[d["owner"]["login"]],
            summary=trim(d.get("description")),
            tags=d.get("topics") or [],
            published=iso_date(d.get("created_at")),
            updated=iso_date(d.get("pushed_at")),
            stars=d.get("stargazers_count", 0),
            agent_ready=bool(files & {"AGENTS.md", "CLAUDE.md"}),
            citation_cff="CITATION.cff" in files,
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
    PAGE = 1000

    def _feed(self, params: str, cache: bool = True) -> tuple[int, list[ET.Element]]:
        """The total hits and this page's entries. The API reports its own failures as an entry."""
        root = ET.fromstring(get(f"https://export.arxiv.org/api/query?{params}", cache=cache))
        entries = root.findall("a:entry", self.NS)
        if any("/api/errors" in e.findtext("a:id", "", self.NS) for e in entries):
            raise SourceError(f"arXiv API error for {params}")
        total = int(root.findtext("{http://a9.com/-/spec/opensearch/1.1/}totalResults", "0"))
        return total, [e for e in entries if e.find("a:title", self.NS) is not None]

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
        _, found = self._feed(f"id_list={urllib.parse.quote(key)}")
        if not found:
            raise NotFound(f"arXiv:{key}")
        return self._entry(found[0])

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        q = urllib.parse.quote(query or "")
        start, total = 0, limit
        while start < min(limit, total):
            params = f"search_query={q}&sortBy=submittedDate&sortOrder=descending&start={start}&max_results={min(self.PAGE, limit - start)}"
            for attempt in range(3):  # the API sometimes answers with an error or an empty page: retry uncached
                try:
                    total, page = self._feed(params, cache=attempt == 0)
                except SourceError:
                    page = []
                if page or start >= total:
                    break
                time.sleep(10)
            if not page:
                if start >= total:
                    return
                raise SourceError(f"arXiv returned nothing at {start} of {total} for {query!r}")
            yield from map(self._entry, page)
            start += len(page)


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


class OpenAIMath(Source):
    """github.com/openai/math: manuscripts by an OpenAI model, grouped into result families.

    Read from four files: CONTENTS.md (manuscripts and abstracts by family), overview.tex (each family's
    discipline), lean/formalization.yaml (formalized papers), and history.md (withdrawals). The key drops
    the folder's date, so a revised edition replaces the earlier one.
    """

    name, label, origin = "openai-math", "OpenAI Math", "ai-generated"
    REPO, RAW = "openai/math", "https://raw.githubusercontent.com/openai/math/main"
    # Any branch or commit of the repository, and the community's mirror with its reactions to each paper.
    patterns = [r"^(?:https?://)?(?:github\.com/openai/math/(?:blob|tree)|raw\.githubusercontent\.com/openai/math)/[^/]+/preprints/([^/]+?)(?:/.*)?$",
                r"^(?:https?://)?mathcommunity\.github\.io/oai-math-revised/papers/([^/]+?)(?:/.*)?$"]
    MONTHS = "January February March April May June July August September October November December".split()
    DATED = re.compile(rf"-({'|'.join(MONTHS)})-(\d{{1,2}})-(\d{{4}})$")

    def key_of(self, m: re.Match[str]) -> str:
        return self.DATED.sub("", m.group(1))

    def _date(self, folder: str) -> str:
        m = self.DATED.search(folder)
        return f"{m[3]}-{self.MONTHS.index(m[1]) + 1:02d}-{int(m[2]):02d}" if m else ""

    @staticmethod
    def _norm(title: str) -> str:
        return re.sub(r"[^a-z0-9]", "", title.lower())

    @functools.cached_property
    def catalogue(self) -> dict[str, dict[str, Any]]:
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

        # Withdrawn manuscripts are gone from CONTENTS.md; history.md names them, and their folders remain.
        withdrawn = re.findall(r"^- (.+)$", history.split("**Withdrawals**", 1)[-1].split("**Fixes**", 1)[0], re.M)
        if withdrawn:
            folders = [f["name"] for f in get_json(f"https://api.github.com/repos/{self.REPO}/contents/preprints", max_age=3600)]
            for title in withdrawn:
                hits = sorted(f for f in folders if self._norm(self.DATED.sub("", f)) == self._norm(title))
                if hits:
                    records.setdefault(self.DATED.sub("", hits[-1]), self._withdrawn(hits[-1], title))
        return records

    def _withdrawn(self, folder: str, title: str) -> dict[str, Any]:
        """A withdrawn manuscript, from the withdrawal notice in its folder's README."""
        notice = get_text(f"{self.RAW}/preprints/{folder}/README.md", max_age=3600)
        body = notice.split("## Archived manuscript", 1)[0]
        body = re.sub(r"^#.*$|^OpenAI\s*$|\*\*Withdrawn on [^*]+\*\*", "", body, flags=re.M)
        on = re.search(r"Withdrawn on ([A-Z][a-z]+ \d{1,2}, \d{4})", notice)
        archived = re.search(r"\[Pre-withdrawal PDF\]\((https://[^)]+)\)", notice)
        return self.entry(
            self.DATED.sub("", folder), url=f"https://github.com/{self.REPO}/tree/main/preprints/{folder}", title=clean(title),
            authors=["OpenAI"], published=self._date(folder), withdrawn=True,
            withdrawn_on=dt.datetime.strptime(on[1], "%B %d, %Y").date().isoformat() if on else "",
            pdf=archived[1] if archived else "",
            summary=trim("Withdrawal notice: " + re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", body)),
        )

    def fetch(self, key: str) -> dict[str, Any]:
        rec = self.catalogue.get(key)
        if not rec:
            raise NotFound(f"openai/math: {key}")
        return rec

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        yield from list(self.catalogue.values())[:limit]


class Palomar(Source):
    """palomar-registry.org: Lean 4 formalizations checked at a pinned commit (CC0 JSON API).

    The full record (one more request) adds provenance: the papers a result formalizes or adapts.
    """

    name, label = "palomar", "Palomar"
    DATA = "https://data.palomar-registry.org"
    patterns = [r"^(PALOMAR-\d{4}-\d{2}-\d{2}-\d{6})$", r"^(?:https?://)?data\.palomar-registry\.org/(?:entries|versions)/(PALOMAR-\d{4}-\d{2}-\d{2}-\d{6})"]

    def _entry(self, e: dict[str, Any], full: dict[str, Any] | None) -> dict[str, Any]:
        src = e.get("source") or {}
        repo, commit, path = (src.get(k) or "" for k in ("repository", "commit", "project_path"))
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
    AI involvement comes from the file: automation.methods[].models, or AI authors.
    """

    name, label = "lean", "Lean project"
    # Only links to the file itself; other GitHub links are GitHub records.
    patterns = [r"^(?:https?://)?github\.com/([\w.-]+/[\w.-]+)/blob/[^/]+/(?:([\w./-]+?)/)?formalization\.yaml$"]

    def key_of(self, m: re.Match[str]) -> str:
        return m[1].replace("/", "__") + (f"__{m[2].replace('/', '__')}" if m[2] else "")

    def _read(self, repo: str, folder: str) -> dict[str, Any] | None:
        import yaml  # optional dependency, needed only here

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
    """anthropic.com/science: Anthropic's posts on research done with Claude."""

    name, label = "anthropic-science", "Anthropic Science"
    patterns = [r"^(?:https?://)?(?:www\.)?anthropic\.com/research/([\w-]+)/?$"]

    def fetch(self, key: str) -> dict[str, Any]:
        url = f"https://www.anthropic.com/research/{key}"
        m = MetaParser(get_text(url))
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


class Hexagon(Source):
    """hexagonmath.org: an arXiv-style archive for LLM-assisted mathematics, with a JSON API.

    Records keep the deposit's declarations (authorship, how much a human understood) for readers to judge.
    """

    name, label = "hexagon", "Hexagon"
    API = "https://hexagonmath.org/api/v1/works"
    # The bare form is arXiv's too, so a bare id needs the hexagon: prefix.
    patterns = [r"^(?:https?://)?(?:www\.)?hexagonmath\.org/(?:abs/|pdf/|src/|api/v1/works/)?(\d{4}\.\d{4,5})(?:v\d+)?/?$", r"^hexagon:(\d{4}\.\d{4,5})(?:v\d+)?$"]

    def _entry(self, w: dict[str, Any]) -> dict[str, Any]:
        links = w.get("links") or {}
        formal = [f.get("url") for f in w.get("formalizations") or [] if f.get("url")]
        formal += [w[k] for k in ("mathlibCommitUrl", "palomarUrl", "prove2Url") if w.get(k) and w[k] not in formal]
        return self.entry(
            w["identifier"],
            url=links.get("record") or f"https://hexagonmath.org/abs/{w['identifier']}",
            pdf=links.get("pdf", ""),
            title=clean(w.get("title")),
            authors=[clean(a.get("name")) for a in w.get("authors", [])],
            summary=trim(w.get("abstract")),
            domain=w.get("subject") or "",
            tags=[*(w.get("crossListSubjects") or []), *(f"msc:{m}" for m in w.get("mscCodes") or []), *(w.get("tags") or [])][:12],
            published=iso_date(w.get("publishedAt") or w.get("createdAt")),
            updated=iso_date(w.get("versionCreatedAt")),
            version=w.get("versionNumber"),
            doi=w.get("doi") or "",
            ai_models=[t["name"] for t in w.get("tools") or [] if t.get("name") and t["name"] != "Lean"],
            authorship=w.get("authorshipMode") or "",
            human_understanding=w.get("humanUnderstanding") or "",
            **({"origin": "ai-generated"} if w.get("authorshipMode") != "human" else {}),
            formalized=bool(formal),
            formalizations=formal,
            withdrawn=bool(w.get("withdrawnAt")) or w.get("status") == "withdrawn",
            withdrawn_on=iso_date(w.get("withdrawnAt")),
        )

    def _detail(self, versioned: str) -> dict[str, Any]:
        return get_json(f"{self.API}/{versioned}")["work"]

    def fetch(self, key: str) -> dict[str, Any]:
        try:
            return self._entry(self._detail(key))
        except (NotFound, SourceError):
            pass
        latest = None  # the API may require a version: try v1, v2, ... and keep the last one found
        for v in range(1, 51):
            try:
                latest = self._detail(f"{key}v{v}")
            except NotFound:
                break
        if latest is None:
            raise NotFound(f"Hexagon {key}")
        return self._entry(latest)

    def harvest(self, query: str | None, limit: int) -> Iterator[dict[str, Any]]:
        """Newest first, one record per work. The detail record adds the formalization links the list leaves out."""
        cursor = None
        while True:
            page = get_json(f"{self.API}?limit=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""), max_age=3600)
            for w in page.get("works", []):
                try:
                    w = {**w, **self._detail(w["id"].removeprefix("hexagon:"))}
                except (NotFound, SourceError):
                    pass  # the list record is enough to index it
                yield self._entry(w)
            pg = page.get("page") or {}
            cursor = pg.get("next_cursor")
            if not pg.get("has_more") or not cursor:
                return


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
        try:
            result = subprocess.run(["node", "--experimental-strip-types", "site/scripts/read-web.ts"],
                                    cwd=HERE, input=json.dumps({"url": url}), text=True, capture_output=True, timeout=12)
            if result.returncode or len(result.stdout) > 16_384:
                raise SourceError("bounded webpage retrieval could not complete")
            data = json.loads(result.stdout)
            if isinstance(data, dict) and data.get("error") == "not_found":
                raise NotFound("public webpage not found")
            if not isinstance(data, dict) or data.get("source") != "web" or not data.get("title"):
                raise SourceError("public HTML metadata is unavailable or unsupported")
            return data
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            raise SourceError("bounded webpage retrieval requires Node.js") from error

    def refetch(self, entry: dict[str, Any]) -> dict[str, Any]:
        return {**self.fetch_url(entry["url"]), "key": entry["key"]}


# The first adapter that matches wins, so specific ones come before GitHub, DOI and Web.
SOURCES: list[Source] = [OpenAIMath(), Palomar(), AnthropicScience(), Hexagon(), ArXiv(), Zenodo(), HuggingFace(), Formalization(), GitHub(), Doi(), Web()]
BY_NAME = {s.name: s for s in SOURCES}


# Venues whose listings are mostly pseudoscience. They are rejected, even as plain web pages.
BLOCKED_HOSTS = ("vixra.org", "aixiv.science", "clawxiv.org", "jaigp.org")


def blocked(url: str) -> bool:
    host = (urllib.parse.urlsplit(url.strip() if "://" in url else f"https://{url.strip()}").hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS)


def detect(url: str) -> tuple[Source, str]:
    """The adapter and key for a URL or bare ID. Raises ValueError if nothing matches or the venue is blocked."""
    if blocked(url):
        raise ValueError(f"not taken: {url!r} is on a venue this index does not list")
    for s in SOURCES:
        key = s.match(url)
        if key:
            return s, key
    raise ValueError(f"not a URL or a known ID: {url!r}")


TRACKING = re.compile(r"utm_.*|fbclid|gclid|ref|ref_src|r|s|t")  # query parameters that do not identify a page


def identity(url: str) -> str:
    """What a link points at, so two spellings of one link compare equal: its record id, or for any other page its URL
    over https without fragment, tracking parameters or trailing slash (a blog post can be ?p=15979), with X posts
    under x.com."""
    url = urllib.parse.urldefrag(url.strip())[0]
    try:
        src, key = detect(url)
    except ValueError:
        src, key = BY_NAME["web"], ""
    if src.name != "web":
        return f"{src.name}/{key}"
    u = urllib.parse.urlsplit(url)
    host = "x.com" if u.hostname in X_HOSTS else u.hostname or ""
    query = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(u.query) if not TRACKING.fullmatch(k)])
    return urllib.parse.urlunsplit(("https", host, u.path.rstrip("/"), query, ""))


def today() -> str:
    return dt.date.today().isoformat()
