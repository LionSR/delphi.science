#!/usr/bin/env python3
"""Open index prototype: APP papers plus any research link, each labelled by its source.

Entries live in Postgres (open_index.entries, see store.py), one per record, under the id <source>/<key>:
the source's own ID, so adding the same record twice finds the existing entry. APP papers are not
copied: they are read from the APP registry at build time and shown with the APP label.

    python index.py add <url or id> [--by <github login>] [--dry-run]
    python index.py harvest [--source NAME] [--limit N] [--dry-run]
    python index.py label [--all] [--labeler deepseek|none|canned:<file.json>]
    python index.py refresh [--older-than DAYS] [--limit N] [--dry-run]
    python index.py discuss <record id> <url>... [--stance STANCE] [--drop] [--dry-run]
    python index.py discuss --recheck [<record id>...] [--dry-run]   # daily: deleted posts drop out
    python index.py discuss --propose-stances [<record id>...] [--labeler deepseek|canned:<file.json>]
    python index.py reception [<record id>] [--draft [--labeler ...] | --text TEXT] [--reviewed-by LOGIN] [--links URL...]
    python index.py build            # writes dist/index.json, which the site loads into open_index.records
"""

from __future__ import annotations

import argparse
import itertools
import datetime as dt
import functools
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from collections import Counter
from typing import Any, Iterable

import schema
import sources as S
import store
import taxonomy as TX
from store import Conflict, Ref

HERE = Path(__file__).resolve().parent
DIST = HERE / "dist"
SITE = "https://agenticpapers.app"
APP_INDEX = f"{SITE}/papers/index.json"  # the APP registry's published entries


def load_entries() -> list[dict[str, Any]]:
    """APP papers, as the registry publishes them (the same shape as its entry files)."""
    return S.get_json(APP_INDEX, max_age=3600)


def _drop_empty(d: dict[str, Any]) -> dict[str, Any]:
    """Fields the source does not provide are left out, not blanked."""
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def pick(d: dict[str, Any], keys: Iterable[str]) -> dict[str, Any]:
    return {k: d[k] for k in keys if k in d}


def github_token() -> str | None:
    """GITHUB_TOKEN, GH_TOKEN, or `gh auth token`, for GitHub's API rate limit."""
    import os

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token
    try:
        return subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None

# Display labels for the agent's categories. Worded to describe the entry, never the person who added it.
CATEGORIES = {
    "research": "Research",
    "non-research": "Not research",
    "fiction": "Fiction / creative work",
    "low-info": "Little information",
    "harmful": "Hidden: flagged content",
}
MAX_ADDS_PER_DAY = 20  # per GitHub login; the only limit on who may post
# A repository is listed on its own only when it is well used or citable: this many stars, or a CITATION.cff.
# Otherwise its paper is the record (site/lib/resolve.ts MIN_STARS says the same).
MIN_REPO_STARS = 50


load = store.load


def read_entry(record: str) -> tuple[Ref, dict[str, Any]] | None:
    """One record's entry; None, saying so, when there is no such record."""
    if not (found := store.get(record)):
        print(f"no entry {record}")
    return found


def save(ref: Ref, entry: dict[str, Any]) -> Ref:
    return store.save(ref, _drop_empty(entry))


def repo_key(url: str) -> str:
    return url.lower().rstrip("/")


def app_repos() -> dict[str, str]:
    return {repo_key(e["repo_url"]): e["id"] for e in load_entries()}


def app_entry(p: dict[str, Any]) -> dict[str, Any]:
    """An APP registry paper as an ordinary entry, so one mapping (to_item) serves every source."""
    v = p["versions"][-1]
    return {
        "key": p["id"], "source": "app", "url": f"{SITE}/papers/{p['id']}/", "repo": p["repo_url"],
        "title": v["title"], "authors": [a["name"] for a in v.get("authors", [])], "summary": S.trim(v.get("paper_summary")),
        "tags": v.get("tags", []), "domain": v.get("domain"), "published": p["versions"][0]["listed_at"],
        "agent_ready": True, "json": f"{SITE}/papers/{p['id']}.json",
    }


def listed_as(entry: dict[str, Any], known: set[str], repos: dict[str, str]) -> str | None:
    """Why this record is already in the index (its entry, or the APP paper for its repo), or None."""
    if rid(entry) in known:
        return rid(entry)
    app = repos.get(repo_key(entry["url"]))
    return f"APP paper {app}: {SITE}/papers/{app}/" if app else None


# ---- add ----


def check(entry: dict[str, Any]) -> list[str]:
    """The hard checks. Anything that passes them is posted; the agent's label does the rest."""
    problems = []
    if entry["source"] == "github" and entry.get("stars", 0) < MIN_REPO_STARS and not entry.get("citation_cff"):
        problems.append(f"a repository is listed only with at least {MIN_REPO_STARS} stars or a CITATION.cff; add its paper instead")
    known = {rid(entry)} if store.get(rid(entry)) else set()
    listed = listed_as(entry, known, app_repos())
    if listed:
        problems.append(f"already listed: {listed}")
    if not entry.get("title"):
        problems.append("the record has no title")
    return problems


def adds_today(login: str) -> int:
    return store.added_today(login, S.today())


def add(url: str, by: str, dry_run: bool) -> int:
    try:
        source, key = S.detect(url)
        print(f"{url} → {source.name}:{key}")
        entry = S.fetch(url)
    except ValueError as e:
        print(f"rejected: {e}")
        return 2
    except S.NotFound as e:
        print(f"rejected: the record was not found or is not public ({e})")
        return 2
    except S.SourceError as e:
        print(f"rejected: {e}")
        return 2
    problems = check(entry)
    if by and not by.startswith("harvest:") and adds_today(by) >= MAX_ADDS_PER_DAY:
        problems.append(f"@{by} has added {MAX_ADDS_PER_DAY} links today; try again tomorrow")
    if problems:
        print("rejected: " + "; ".join(problems))
        return 2
    entry.update(added=S.today(), added_by=by, refreshed=S.today())
    print(json.dumps(_drop_empty(entry), indent=2, ensure_ascii=False))
    if not dry_run:
        try:
            save(Ref(rid(entry)), entry)
        except Conflict:
            print(f"rejected: already listed: {rid(entry)}")  # added by another run since check()
            return 2
        print(f"stored {rid(entry)}")
    return 0


# ---- harvest ----


def harvest(only: str | None, limit: int | None, dry_run: bool) -> int:
    config = json.loads((HERE / "harvest.json").read_text())
    known = store.ids()
    repos = app_repos()
    total = 0
    for job in config["jobs"]:
        if (only and job["source"] != only) or not job.get("enabled", True):
            continue  # "enabled": false keeps a job written down without running it (arXiv, for now)
        name, src = job["name"], S.BY_NAME[job["source"]]
        new: list[tuple[str, dict[str, Any]]] = []
        n_seen = 0
        try:
            n = limit or job.get("limit", 50)
            for entry in itertools.islice(src.harvest(job.get("query"), n), n):
                n_seen += 1
                if listed_as(entry, known, repos):
                    continue
                known.add(rid(entry))
                entry.update(added=S.today(), added_by=f"harvest:{name}", refreshed=S.today())
                new.append((rid(entry), _drop_empty(entry)))
                if dry_run:
                    print(f"  + {rid(entry)}  {entry['title'][:80]}")
        except (S.SourceError, S.NotFound) as e:
            print(f"{name}: stopped: {e}", file=sys.stderr)
        n_new = len(new) if dry_run else store.add_all(new)  # what the job read before it stopped is kept
        print(f"{name}: {n_seen} seen, {n_new} new")
        total += n_new
    print(f"{'would add' if dry_run else 'added'} {total} entries")
    return 0


# ---- label ----

BATCH = 20


def label_batch(batch: list[dict[str, Any]], labeler: str, canned: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Returns {key: {category, tags, reason}} for the batch."""
    if labeler == "none":
        return {}
    if labeler == "canned":
        return {e["key"]: canned[e["key"]] for e in batch if e["key"] in canned}
    data = [{"key": e["key"], "source": e["source"], "title": e["title"], "authors": e.get("authors", [])[:6],
             "summary": e.get("summary", ""), "tags": e.get("tags", [])[:8]} for e in batch]
    replies = ask("label-prompt.md", "ENTRIES", data)
    return {r["key"]: r for r in replies if isinstance(r, dict) and r.get("category") in CATEGORIES}


# The labelling model: DeepSeek, as the site's moderator (site/lib/moderate.ts), through its chat completions API.
DEEPSEEK = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"


@functools.cache
def deepseek_key() -> str:
    """DEEPSEEK_API_KEY, or else the secret deepseek_api_key in Supabase Vault, where the moderator reads it too."""
    if key := os.environ.get("DEEPSEEK_API_KEY") or store.secret("deepseek_api_key"):
        return key
    raise SystemExit("no DeepSeek key: set DEEPSEEK_API_KEY, or the secret deepseek_api_key in Supabase Vault (see README)")


def chat(system: str, user: str) -> str:
    """The model's reply to one message."""
    body = json.dumps({"model": MODEL, "temperature": 0, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
    req = urllib.request.Request(DEEPSEEK, body.encode(), {"Authorization": f"Bearer {deepseek_key()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        out = json.load(r)
    try:
        return out["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(f"DeepSeek gave no reply: {json.dumps(out)[:300]}") from None


def ask(prompt_file: str, name: str, data: Any, reply: str = r"\[.*\]") -> Any:
    """The labelling model's JSON reply to a prompt file, with the data between BEGIN_<name> and END_<name>.
    It has no tools: the data is third-party text, and the prompt says to treat it as such."""
    out = chat((HERE / prompt_file).read_text(), f"BEGIN_{name}\n{json.dumps(data, ensure_ascii=False)}\nEND_{name}")
    if not (m := re.search(reply, out, re.S)):
        raise RuntimeError(f"labeler gave no JSON: {out.strip()[:300]}")
    return json.loads(m.group(0))


# How an ask call fails: the API errs or hangs, or the model gives no JSON or broken JSON.
LABELER_ERRORS = (RuntimeError, json.JSONDecodeError, urllib.error.URLError, TimeoutError)


def canned_replies(labeler: str) -> Any:
    """For --labeler canned:<file.json>, the replies in that file, standing in for the agent's (tests); else None."""
    return json.loads(Path(labeler.split(":", 1)[1]).read_text()) if labeler.startswith("canned:") else None


def label(relabel_all: bool, labeler: str, limit: int | None = None, missing_subject: bool = False) -> int:
    canned: dict[str, Any] = canned_replies(labeler) or {}
    if labeler.startswith("canned:"):
        labeler = "canned"
    if missing_subject:
        todo = [(p, e) for p, e in load() if not TX.subject_of(e.get("domain"), e.get("review", {}).get("subject"))][:limit]
    elif relabel_all:
        todo = load(limit=limit)
    else:
        # arXiv is moderated: its bulk-harvested papers are shown as research without a label.
        todo = load("NOT entry ? 'review' AND coalesce(entry->>'added_by', '') NOT LIKE 'harvest:arxiv-%%'", limit=limit)
    done = 0
    for i in range(0, len(todo), BATCH):
        chunk = todo[i : i + BATCH]
        try:
            replies = label_batch([e for _, e in chunk], labeler, canned)
        except LABELER_ERRORS as err:
            print(f"batch {i // BATCH + 1}: {err}", file=sys.stderr)
            continue
        for ref, e in chunk:
            r = replies.get(e["key"])
            if r:
                e["review"] = _drop_empty({"category": r["category"], "subject": str(r.get("subject", ""))[:24], "tags": [str(t) for t in r.get("tags", [])][:6],
                                           "reason": str(r.get("reason", ""))[:200], "by": MODEL if labeler == "deepseek" else labeler, "at": S.today()})
                try:
                    save(ref, e)
                except Conflict as err:
                    print(f"skipped  {err}", file=sys.stderr)  # labelled next time
                    continue
                done += 1
        print(f"labelled {done}/{len(todo)}")
    return 0


# ---- refresh ----


def saved(ref: Ref, entry: dict[str, Any]) -> bool:
    """Saves what a pass over many entries made of one; an entry changed meanwhile (a person's discuss) is
    left for the next pass, which reads it again."""
    try:
        save(ref, entry)
        return True
    except Conflict as err:
        print(f"skipped  {err}", file=sys.stderr)
        return False


def refresh(older_than: int, limit: int, dry_run: bool) -> int:
    cutoff = (dt.date.today() - dt.timedelta(days=older_than)).isoformat()
    # The stalest first, so an entry its source keeps failing on does not hold back the rest.
    stale = load("coalesce(entry->>'refreshed', '') <= %s", [cutoff], limit, f"coalesce(entry->>'refreshed', ''), {store.ID_ORDER}")
    changed = gone = 0
    for ref, e in stale:
        src = S.BY_NAME[e["source"]]
        try:
            fresh = src.refetch(e)
        except S.NotFound:
            gone += 1
            print(f"gone     {rid(e)}")
            if not dry_run:
                saved(ref, {**e, "gone": True, "refreshed": S.today()})
            continue
        except S.SourceError as err:
            print(f"skipped  {rid(e)}: {err}", file=sys.stderr)
            continue
        keep = {k: e[k] for k in ("added", "added_by", "review") if k in e}
        updated = {**e, **_drop_empty(fresh), **keep, "refreshed": S.today()}
        updated.pop("gone", None)
        if e.get("discussion"):
            updated["discussion"] = recheck(e["discussion"])
        if any(updated.get(k) != e.get(k) for k in ("title", "summary")):
            updated.pop("review", None)  # the text changed: label it again
            changed += 1
            print(f"changed  {rid(e)}  {updated['title'][:70]}")
        if not dry_run:
            saved(ref, updated)
    print(f"checked {len(stale)}: {changed} changed, {gone} gone")
    return 0


# ---- discuss ----


# A link's fields that a person set, not the source: kept when the link is read again.
KEPT = ("added", "stance")
# The entries with links: store.load's condition for them.
DISCUSSED = "jsonb_typeof(entry->'discussion') = 'array' AND jsonb_array_length(entry->'discussion') > 0"

# What a response says about the record, set by a person (discuss --stance): names and meanings, which count as
# upvotes in the popularity sorts (and whether a link with no stance yet does), and which mark the record disputed
# (is:disputed). Shared with the site, which reads the same file.
STANCE_FILE = json.loads((Path(__file__).resolve().parent / "site" / "lib" / "stances.json").read_text())
STANCES: dict[str, str] = STANCE_FILE["stances"]
UPVOTING = set(STANCE_FILE["upvoting"])
DISPUTING = set(STANCE_FILE["disputing"])


def counts_as_upvote(link: dict[str, Any]) -> bool:
    return link["stance"] in UPVOTING if "stance" in link else STANCE_FILE["unlabelled_upvotes"]


def upvoting(links: list[dict[str, Any]]) -> int:
    """How many responses count as upvotes: the ones that support the result, and those not yet labelled."""
    return sum(1 for d in links if counts_as_upvote(d))


def disputed(links: list[dict[str, Any]]) -> bool:
    return any(d.get("stance") in DISPUTING for d in links)


def unlabelled(e: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in e.get("discussion") or [] if "stance" not in d]


def with_stance(link: dict[str, Any], stance: str) -> dict[str, Any]:
    """The link with that stance; "none" clears it."""
    out = {k: v for k, v in link.items() if k != "stance"}
    return out if stance == "none" else {**out, "stance": stance}


def link_url(url: str, attached: Iterable[str] = ()) -> str:
    """A link as it is stored, to find it among a record's links without reading it again: as given when it is
    attached so (a page whose query matters), else as an X post is stored (x.com, no query)."""
    url = url.strip()
    return url if url in attached else url.replace("twitter.com/", "x.com/").split("?")[0]


def recheck(links: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each link read again: edits come through, a deleted post or page drops out, an unreachable one is kept."""
    out = []
    for d in links:
        try:
            out.append({**S.discussion_link(d["url"]), **pick(d, KEPT)})
        except S.NotFound:
            print(f"dropped  {d['url']}")
        except (ValueError, S.SourceError) as err:
            print(f"kept     {d['url']}: {err}", file=sys.stderr)
            out.append(d)
    return out


def propose_stances(records: list[str], labeler: str) -> int:
    """The labelling agent proposes a stance for each link that has none (stance-prompt.md); a person decides.
    Nothing is written: each proposal is printed as the discuss command that sets it, to run after reading the
    link. --labeler canned:<file.json> reads {url: {stance, reason}} instead, for tests."""
    canned = canned_replies(labeler)
    todo = [e for _, e in load(DISCUSSED) if (not records or rid(e) in records) and unlabelled(e)]
    batches: list[list[dict[str, Any]]] = [[]]
    for e in todo:  # whole records, about BATCH links to a batch
        if sum(len(x["discussion"]) for x in batches[-1]) >= BATCH:
            batches.append([])
        batches[-1].append(e)
    n = 0
    for batch in filter(None, batches):
        data = [{"id": rid(e), "title": e["title"], "summary": e.get("summary", ""),
                 "responses": [pick(d, ("url", "kind", "author", "title", "text")) for d in unlabelled(e)]} for e in batch]
        try:
            replies = canned if canned is not None else {r["url"]: r for r in ask("stance-prompt.md", "RECORDS", data) if isinstance(r, dict) and "url" in r}
        except LABELER_ERRORS as err:
            print(f"skipped {len(batch)} records: {err}", file=sys.stderr)
            continue
        for r in data:
            print(f"\n# {r['id']}: {r['title'][:90]}")
            for d in r["responses"]:
                p = replies.get(d["url"]) or {}
                if p.get("stance") in STANCES:
                    n += 1
                    print(f"python3 index.py discuss {shlex.quote(r['id'])} {shlex.quote(d['url'])} --stance {p['stance']}"
                          f"   # {str(p.get('reason', ''))[:120]}")
                else:
                    print(f"# no proposal, open it: {d['url']}")
    print(f"\n{n} stances proposed for {sum(len(unlabelled(e)) for e in todo)} unlabelled links on {len(todo)} records; nothing written."
          " Run the commands you agree with.")
    return 0


def recheck_all(records: list[str], dry_run: bool) -> int:
    """Every record's links read again (or only the named records'), apart from the weekly refresh, so a
    deleted post leaves the index within a day. The daily workflow runs it."""
    todo = [(p, e) for p, e in load(DISCUSSED) if not records or rid(e) in records]
    n = dropped = 0
    for ref, e in todo:
        links = recheck(e["discussion"])
        n += len(e["discussion"])
        dropped += len(e["discussion"]) - len(links)
        if links != e["discussion"] and not dry_run:
            saved(ref, {**e, "discussion": links})
    print(f"rechecked {n} links on {len(todo)} records: {dropped} dropped")
    return 0


def discuss(record: str, urls: list[str], drop: bool, dry_run: bool, stance: str | None = None) -> int:
    """Attach posts and articles about a record: X posts through oEmbed, anything else through its Open Graph tags.
    Only voices with a public scholarly record are taken (see README); --drop removes links again. With --stance,
    new links are attached with that stance and links already attached take it without being read again
    (--stance none clears it)."""
    if not urls:
        print("name the links to attach, or use --recheck")
        return 2
    if not (found := read_entry(record)):
        return 2
    ref, e = found
    links = e.get("discussion", [])
    if drop:
        attached = {x["url"] for x in links}
        gone = {link_url(u, attached) for u in urls}
        links = [x for x in links if x["url"] not in gone]
        print(f"{len(e.get('discussion', [])) - len(links)} dropped")
    for url in [] if drop else urls:
        attached = {x["url"]: x for x in links}
        old = attached.get(link_url(url, attached))
        if old and stance:
            links = [with_stance(x, stance) if x is old else x for x in links]
            print(f"= {stance:<10} {old['url']}")
            continue
        try:
            d = S.discussion_link(url)
        except (ValueError, S.NotFound, S.SourceError) as err:
            print(f"skipped {url}: {err}", file=sys.stderr)
            continue
        new = {**d, "added": S.today(), **pick(old or attached.get(d["url"], {}), KEPT)}  # read again: keeps its stance
        links = [x for x in links if x["url"] != d["url"]] + [with_stance(new, stance) if stance else new]
        print(f"+ {d.get('author') or d.get('site')}: {(d.get('text') or d.get('title') or d['url'])[:90]}")
    e["discussion"] = sorted(links, key=lambda d: d.get("date", ""))
    if not dry_run:
        save(ref, e)
    return 0


# ---- reception ----

# A record with responses opens with one or two sentences saying where the work stands, resting on some of its
# links. The labelling agent may draft it (reception-prompt.md); only a person's review publishes it, and it
# stops being published as soon as the links it was written against change (one added, dropped or relabelled).
RECEPTION_CHARS = 400
LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")  # a GitHub login


def basis(links: list[dict[str, Any]]) -> str:
    """A short hash of the record's links and their stances, as they were when the reception was written."""
    pairs = sorted([d["url"], d.get("stance") or ""] for d in links)
    return hashlib.sha1(json.dumps(pairs).encode()).hexdigest()[:12]


def reception_state(e: dict[str, Any]) -> str | None:
    """published, draft (not reviewed yet), stale (the links changed after it was written), or None."""
    r = e.get("reception")
    if not r:
        return None
    if r.get("basis") != basis(e.get("discussion") or []):
        return "stale"
    return "published" if r.get("reviewed_by") and r.get("text") else "draft"


def published_reception(e: dict[str, Any]) -> dict[str, Any] | None:
    return pick(e["reception"], ("text", "written", "links", "reviewed_by")) if reception_state(e) == "published" else None


def draft_reception(e: dict[str, Any], labeler: str) -> dict[str, Any]:
    """The labelling agent's draft, from the links a person labelled. canned:<file.json> reads {record id: {text, links}}."""
    labelled = [d for d in e.get("discussion") or [] if d.get("stance")]
    if not labelled:
        raise ValueError("no labelled links: label them first (discuss --stance, or --propose-stances)")
    canned = canned_replies(labeler)
    if canned is not None:
        reply = canned.get(rid(e)) or {}
    else:
        data = {"id": rid(e), "title": e["title"], "summary": e.get("summary", ""), "withdrawn": e.get("withdrawn_on") or bool(e.get("withdrawn")),
                "responses": [pick(d, ("url", "kind", "author", "site", "date", "stance", "title", "text")) for d in labelled]}
        reply = ask("reception-prompt.md", "RECORD", data, reply=r"\{.*\}")
    if not isinstance(reply, dict):
        raise ValueError("the labeler did not reply with an object")
    text = S.clean(str(reply.get("text", "")))
    if not text:
        raise ValueError("the labeler gave no text")
    urls = {d["url"] for d in labelled}
    return {"text": text[:RECEPTION_CHARS], "links": [u for u in reply.get("links", []) if u in urls] or sorted(urls),
            "drafted_by": labeler if canned is not None else MODEL}


def list_receptions() -> int:
    rows = [(rid(e), reception_state(e), e["reception"]) for _, e in load("entry ? 'reception'")]
    for i, state, r in rows:
        print(f"{state:<9} {i}  {r.get('text', '')[:80]}  {'@' + r['reviewed_by'] if r.get('reviewed_by') else ''}")
    print(f"{len(rows)} receptions: {sum(s == 'published' for _, s, _ in rows)} published")
    return 0


def reception(record: str | None, draft: bool, text: str | None, reviewed_by: str | None, links: list[str] | None,
              labeler: str, dry_run: bool) -> int:
    """Draft, write or review a record's reception; with no record, list every reception and its state."""
    if not record:
        return list_receptions()
    if not (found := read_entry(record)):
        return 2
    ref, e = found
    attached = e.get("discussion") or []
    old = e.get("reception") or {}
    if reviewed_by and not LOGIN.match(reviewed_by):
        print(f"not a GitHub login: {reviewed_by}")
        return 2
    if draft and (reviewed_by or text):
        print("a draft is reviewed after it is read: run --draft first, then --reviewed-by (or --text) on its own")
        return 2
    if not (draft or text or reviewed_by):
        print(json.dumps(old, indent=2, ensure_ascii=False) if old else f"{record} has no reception")
        print(f"state: {reception_state(e)}")
        return 0
    if not attached:
        print(f"{record} has no links to rest a reception on (discuss attaches them)")
        return 2
    try:
        if draft:
            new = draft_reception(e, labeler)
        elif text is not None:
            new = {"text": S.clean(text), "links": old.get("links") or [d["url"] for d in attached]}
        else:
            new = pick(old, ("text", "links", "drafted_by"))
            if not new.get("text"):
                raise ValueError("nothing to review: draft it (--draft) or write it (--text) first")
    except (ValueError, *LABELER_ERRORS) as err:
        print(f"no reception written: {err}")
        return 2
    urls = {d["url"] for d in attached}
    if links:
        new["links"] = [link_url(u, urls) for u in links]
    if missing := [u for u in new["links"] if u not in urls]:
        print(f"not among {record}'s links: {', '.join(missing)}")
        return 2
    if len(new["text"]) > RECEPTION_CHARS:
        print(f"the text has {len(new['text'])} characters; keep it to one or two sentences, under {RECEPTION_CHARS}")
        return 2
    # Written against the links as they are now; a person's review (draft or their own text) publishes it.
    e["reception"] = _drop_empty({**new, "written": S.today(), "reviewed_by": None if draft else reviewed_by, "basis": basis(attached)})
    print(json.dumps(e["reception"], indent=2, ensure_ascii=False))
    print(f"state: {reception_state(e)}" + ("" if reviewed_by else f"; a person publishes it with: python3 index.py reception {record} --reviewed-by <login>"))
    if not dry_run:
        save(ref, e)
    return 0


# ---- build ----


# Entry fields served as they are; to_item adds id, tags, published, category and subject.
PASSTHROUGH = ("source", "url", "title", "authors", "summary", "domain", "origin", "agent_ready", "gone", "stars", "pdf",
               "family", "family_title", "formalized", "withdrawn", "withdrawn_on", "verified", "trust", "ai_models",
               "formalizes", "formalizations", "authorship", "human_understanding", "repo", "json")


PREFIXES = json.loads((Path(__file__).resolve().parent / "site" / "lib" / "prefixes.json").read_text())["prefixes"]


def rid(e: dict[str, Any]) -> str:
    """A record's id, <prefix>/<suffix> like a DOI: the source's prefix, then the source's own key."""
    return f"{e['source']}/{e['key']}"


# What is served of an X post: who, when and where. Its text is X's to show, in its own embed (the
# record page renders one from the url), so it is never served, even from an entry that still has it.
X_FIELDS = ("kind", "url", "author", "handle", "date", "added", "stance")


def served_link(d: dict[str, Any]) -> dict[str, Any]:
    return pick(d, X_FIELDS) if d.get("kind") == "x" else dict(d)


def to_item(e: dict[str, Any]) -> dict[str, Any] | None:
    """What the page, index.json and the API serve for one entry. None for entries labelled harmful,
    which are left out; their entries keep the label for editors."""
    r = e.get("review", {})
    if r.get("category") == "harmful":
        return None
    subject = TX.subject_of(e.get("domain"), r.get("subject"))
    links = e.get("discussion") or []
    return _drop_empty({
        "id": rid(e), **{k: e.get(k) for k in PASSTHROUGH}, "discussion": [served_link(d) for d in links],
        "disputed": disputed(links) or None, "reception": published_reception(e),
        "tags": list(dict.fromkeys([*(e.get("tags") or []), *(r.get("tags") or [])]))[:10],
        "published": e.get("published") or e.get("added"), "category": r.get("category", "research"),
        "subject": subject, "division": TX.division_of(subject) if subject else None,
    })


def crosslink(all_items: list[dict[str, Any]]) -> None:
    """A discussion link whose paper is itself in the index points at that record ("record"), and the
    record lists what it discusses ("discusses"), so an arXiv response and the manuscript it answers
    link both ways. Resolved with sources.detect, so it works for every source, not only arXiv."""
    by_id = {it["id"]: it for it in all_items}
    for it in all_items:
        for link in it.get("discussion") or []:
            try:
                src, key = S.detect(link["url"])
            except ValueError:
                continue
            target = by_id.get(f"{src.name}/{key}")
            if not target or target is it:
                continue
            link["record"] = target["id"]
            discusses = target.setdefault("discusses", [])
            if all(d["id"] != it["id"] for d in discusses):
                discusses.append({"id": it["id"], "title": it["title"]})


def items(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """APP papers (oldest first), then every other entry, newest first."""
    out = [to_item(e) for e in [*map(app_entry, load_entries()), *entries]]
    kept = [it for it in out if it]
    crosslink(kept)
    apps = sorted((it for it in kept if it["source"] == "app"), key=lambda it: it.get("published", ""))
    rest = sorted((it for it in kept if it["source"] != "app"), key=lambda it: it.get("published", ""), reverse=True)
    return apps + rest


def labels() -> dict[str, str]:
    return {"app": "agenticpapers.app", **{s.name: s.label for s in S.SOURCES}}


def dumps(obj: Any) -> str:
    """JSON for every file the build writes. U+FFFD that a source itself serves is kept, but escaped,
    so the files stay clean text."""
    return json.dumps(obj, ensure_ascii=False).replace("\ufffd", "\\ufffd")


def build() -> int:
    entries = [e for _, e in load()]
    all_items = items(entries)
    if unknown := {it["source"] for it in all_items} - PREFIXES.keys():
        raise SystemExit(f"no prefix for {', '.join(sorted(unknown))}: add it to site/lib/prefixes.json (prefixes are never renamed)")
    # What is served must fit the API's Record schema: a field it leaves out, or a wrong type, stops the build.
    if bad := [p for it in all_items for p in schema.problems(it, {"$ref": "#/components/schemas/Record"}, it["id"])]:
        raise SystemExit(f"{len(bad)} problems with the Record schema (site/lib/openapi.ts; then npm run openapi in site/):\n  " + "\n  ".join(bad[:20]))
    counts = Counter(it["source"] for it in all_items)
    names = labels()
    index = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "labels": names,
             "categories": CATEGORIES, "taxonomy": TX.as_json(), "counts": dict(counts), "items": all_items}
    DIST.mkdir(exist_ok=True)
    (DIST / "index.json").write_text(dumps(index))
    TX.write_json()
    print(f"built dist/index.json: {len(all_items)} items " + ", ".join(f"{names.get(k, k)} {v}" for k, v in counts.most_common()))
    if stale := [rid(e) for e in entries if reception_state(e) == "stale"]:
        print(f"{len(stale)} receptions not published, their links changed after they were written: {', '.join(stale)}."
              " Review each again: python3 index.py reception <id> --reviewed-by <login> (or --text, or --draft)", file=sys.stderr)
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add"); a.add_argument("url"); a.add_argument("--by", default=""); a.add_argument("--dry-run", action="store_true")
    h = sub.add_parser("harvest"); h.add_argument("--source"); h.add_argument("--limit", type=int); h.add_argument("--dry-run", action="store_true")
    lb = sub.add_parser("label"); lb.add_argument("--all", action="store_true"); lb.add_argument("--labeler", default="deepseek"); lb.add_argument("--limit", type=int); lb.add_argument("--missing-subject", action="store_true")
    r = sub.add_parser("refresh"); r.add_argument("--older-than", type=int, default=7); r.add_argument("--limit", type=int, default=200); r.add_argument("--dry-run", action="store_true")
    d = sub.add_parser("discuss"); d.add_argument("record", nargs="?"); d.add_argument("urls", nargs="*"); d.add_argument("--drop", action="store_true"); d.add_argument("--dry-run", action="store_true")
    d.add_argument("--recheck", action="store_true", help="read every link again (or the named records' links); a deleted post drops out")
    d.add_argument("--stance", choices=[*STANCES, "none"], help="what the links say about the record (see site/lib/stances.json); set on links already attached without reading them again")
    d.add_argument("--propose-stances", action="store_true", help="the labelling agent proposes stances for unlabelled links (or the named records'); prints them as commands, writes nothing")
    d.add_argument("--labeler", default="deepseek", help="for --propose-stances: deepseek, or canned:<file.json>")
    rc = sub.add_parser("reception"); rc.add_argument("record", nargs="?"); rc.add_argument("--draft", action="store_true"); rc.add_argument("--text")
    rc.add_argument("--reviewed-by", help="the GitHub login of the person who checked the text against its links; publishes it")
    rc.add_argument("--links", nargs="+", help="the links the text rests on (default: all of the record's)"); rc.add_argument("--labeler", default="deepseek")
    rc.add_argument("--dry-run", action="store_true")
    sub.add_parser("build")
    args = ap.parse_args(list(argv) if argv is not None else None)
    S.TOKEN = github_token()
    if args.cmd == "add":
        return add(args.url, args.by, args.dry_run)
    if args.cmd == "harvest":
        return harvest(args.source, args.limit, args.dry_run)
    if args.cmd == "label":
        return label(args.all, args.labeler, args.limit, args.missing_subject)
    if args.cmd == "refresh":
        return refresh(args.older_than, args.limit, args.dry_run)
    if args.cmd == "discuss":
        named = [x for x in [args.record, *args.urls] if x]
        if args.recheck:
            return recheck_all(named, args.dry_run)
        if args.propose_stances:
            return propose_stances(named, args.labeler)
        if not args.record:
            ap.error("discuss needs a record id, or --recheck or --propose-stances")
        return discuss(args.record, args.urls, args.drop, args.dry_run, args.stance)
    if args.cmd == "reception":
        return reception(args.record, args.draft, args.text, args.reviewed_by, args.links, args.labeler, args.dry_run)
    return build()


if __name__ == "__main__":
    sys.exit(main())
