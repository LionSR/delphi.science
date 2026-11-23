#!/usr/bin/env python3
"""Delphi.science harvester, classifier, and static build CLI.

Entries are stored in Postgres (open_index.entries, via store.py) keyed by <source>/<key>.
APP papers are read from the published APP registry index at build time.

    python3 indexer/index.py add <url or id> --dry-run  # inspect only; submit through authenticated API
    python3 indexer/index.py harvest [--source NAME] [--limit N] [--dry-run]
    python3 indexer/index.py label [--all] [--labeler deepseek|none|canned:<file.json>]
    python3 indexer/index.py refresh [--older-than DAYS] [--limit N] [--dry-run]
    python3 indexer/index.py discuss <record id> <url>... [--stance STANCE] [--drop] [--dry-run]
    python3 indexer/index.py discuss --recheck [<record id>...] [--dry-run]
    python3 indexer/index.py discuss --propose-stances [<record id>...] [--labeler deepseek|canned:<file.json>]
    python3 indexer/index.py reception [<record id>] [--draft [--labeler ...] | --text TEXT] [--reviewed-by LOGIN] [--links URL...]
    python3 indexer/index.py build
"""

from __future__ import annotations

import argparse
import datetime as dt
import functools
import hashlib
import itertools
import json
import os
import re
import shlex
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

import schema
import sources as S
import store
import taxonomy as TX
from store import Conflict, Ref

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DIST = ROOT / "dist"
SITE = "https://agenticpapers.app"
APP_INDEX = f"{SITE}/papers/index.json"

# Display labels for the labeller's categories; they describe the entry, not who added it.
CATEGORIES = {
    "research": "Research",
    "non-research": "Not research",
    "fiction": "Fiction / creative work",
    "low-info": "Little information",
    "harmful": "Hidden: flagged content",
}
MAX_ADDS_PER_DAY = 20  # per GitHub login

load = store.load


def load_entries() -> list[dict[str, Any]]:
    """APP papers, as the registry publishes them."""
    return S.get_json(APP_INDEX, max_age=3600)


def _drop_empty(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def pick(d: dict[str, Any], keys: Iterable[str]) -> dict[str, Any]:
    return {k: d[k] for k in keys if k in d}


def rid(e: dict[str, Any]) -> str:
    """A record's id: <source>/<key>."""
    return f"{e['source']}/{e['key']}"


def github_token() -> str | None:
    """GITHUB_TOKEN, GH_TOKEN, or `gh auth token`, for GitHub's API rate limit."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token
    try:
        return subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def read_entry(record: str) -> tuple[Ref, dict[str, Any]] | None:
    if not (found := store.get(record)):
        print(f"no entry {record}")
    return found


def save(ref: Ref, entry: dict[str, Any]) -> Ref:
    return store.save(ref, _drop_empty(entry))


def saved(ref: Ref, entry: dict[str, Any]) -> bool:
    """Saves one entry during a bulk pass. An entry that changed since it was read is skipped and left for the next pass."""
    try:
        save(ref, entry)
        return True
    except Conflict as err:
        print(f"skipped  {err}", file=sys.stderr)
        return False


def repo_key(url: str) -> str:
    return url.lower().rstrip("/")


def app_repos() -> dict[str, str]:
    return {repo_key(e["repo_url"]): e["id"] for e in load_entries()}


def app_entry(p: dict[str, Any]) -> dict[str, Any]:
    """Converts an APP registry paper to an ordinary entry, so to_item handles every source the same way."""
    v = p["versions"][-1]
    return {
        "key": p["id"], "source": "app", "url": f"{SITE}/papers/{p['id']}/", "repo": p["repo_url"],
        "title": v["title"], "authors": [a["name"] for a in v.get("authors", [])], "summary": S.trim(v.get("paper_summary")),
        "tags": v.get("tags", []), "domain": v.get("domain"), "published": p["versions"][0]["listed_at"],
        "agent_ready": True, "json": f"{SITE}/papers/{p['id']}.json",
    }


def listed_as(entry: dict[str, Any], known: set[str], repos: dict[str, str]) -> str | None:
    """Why this record is already in the index (its own entry, or the APP paper for its repo), or None."""
    if rid(entry) in known:
        return rid(entry)
    app = repos.get(repo_key(entry["url"]))
    return f"APP paper {app}: {SITE}/papers/{app}/" if app else None


# ---- add ----


def check(entry: dict[str, Any]) -> list[str]:
    problems = []
    known = {rid(entry)} if store.get(rid(entry)) else set()
    if listed := listed_as(entry, known, app_repos()):
        problems.append(f"already listed: {listed}")
    if not entry.get("title"):
        problems.append("the record has no title")
    return problems


def add(url: str, by: str, dry_run: bool) -> int:
    """Inspects a record. Writes go through the site's API, which runs the quality gate."""
    if not dry_run:
        print("not stored: direct CLI submission is closed; use authenticated POST /api/v1/submit for the DeepSeek quality gate, or --dry-run to inspect metadata")
        return 2
    try:
        source, key = S.detect(url)
        print(f"{url} → {source.name}:{key}")
        entry = source.fetch_url(url.strip())
    except S.NotFound as e:
        print(f"rejected: the record was not found or is not public ({e})")
        return 2
    except (ValueError, S.SourceError) as e:
        print(f"rejected: {e}")
        return 2
    problems = check(entry)
    if by and not by.startswith("harvest:") and store.added_today(by, S.today()) >= MAX_ADDS_PER_DAY:
        problems.append(f"@{by} has added {MAX_ADDS_PER_DAY} links today; try again tomorrow")
    if problems:
        print("rejected: " + "; ".join(problems))
        return 2
    entry.update(added=S.today(), added_by=by, refreshed=S.today())
    print(json.dumps(_drop_empty(entry), indent=2, ensure_ascii=False))
    return 0


# ---- harvest ----


def harvest(only: str | None, limit: int | None, dry_run: bool) -> int:
    config = json.loads((HERE / "harvest.json").read_text())
    known = store.ids()
    repos = app_repos()
    total = 0
    for job in config["jobs"]:
        if (only and job["source"] != only) or not job.get("enabled", True):
            continue
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
        n_new = len(new) if dry_run else store.add_all(new)  # keeps what was read before a failure
        print(f"{name}: {n_seen} seen, {n_new} new")
        total += n_new
    print(f"{'would add' if dry_run else 'added'} {total} entries")
    return 0


# ---- the labelling model (DeepSeek, as in site/lib/moderation/moderate.ts) ----

DEEPSEEK = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"
MAX_OUTPUT_TOKENS = 4096
MAX_REQUEST_BYTES = 96_000
# Peak cache-miss rates from api-docs.deepseek.com/quick_start/pricing/, checked 2026-10-27.
INPUT_USD_PER_MILLION = Decimal("0.30")
OUTPUT_USD_PER_MILLION = Decimal("1.20")
DISABLED = "DeepSeek generation is disabled: explicitly authorize it and set a positive per-run USD budget"


class GenerationBudget:
    """A per-run spending cap. Each request reserves its worst-case cost; metered usage can lower it."""

    def __init__(self, enabled: bool = False, limit: Decimal = Decimal(0)):
        self.enabled, self.limit = enabled, limit
        self.calls: list[dict[str, Any]] = []

    @property
    def used(self) -> Decimal:
        return sum((c["cost"] for c in self.calls), Decimal(0))

    def require_enabled(self) -> None:
        if not self.enabled or self.limit <= 0:
            raise RuntimeError(DISABLED)

    def reserve(self, request_bytes: int) -> dict[str, Any]:
        self.require_enabled()
        ceiling = request_bytes + 1024  # input tokens are at most the UTF-8 byte count; the extra 1024 covers chat formatting
        cost = (ceiling * INPUT_USD_PER_MILLION + MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION) / 1_000_000
        if self.used + cost > self.limit:
            raise RuntimeError("DeepSeek run budget exhausted: the next worst-case request would exceed the cap")
        reservation = {"input_ceiling": ceiling, "cost": cost, "state": "reserved"}
        self.calls.append(reservation)
        return reservation

    def settle(self, call: dict[str, Any], usage: Any) -> None:
        if not isinstance(usage, dict):
            return
        prompt, completion = usage.get("prompt_tokens"), usage.get("completion_tokens")
        if type(prompt) is not int or type(completion) is not int:
            return
        if 0 <= prompt <= call["input_ceiling"] and 0 <= completion <= MAX_OUTPUT_TOKENS:
            call.update(cost=(prompt * INPUT_USD_PER_MILLION + completion * OUTPUT_USD_PER_MILLION) / 1_000_000,
                        state="metered_peak_upper_bound", prompt_tokens=prompt, completion_tokens=completion)


GENERATION_BUDGET = GenerationBudget()  # disabled; main() configures it


def parse_usd(value: str, error: str) -> Decimal:
    try:
        amount = Decimal(value)
    except InvalidOperation:
        raise ValueError(error) from None
    if not amount.is_finite() or amount < 0:
        raise ValueError(error)
    return amount


def generation_settings() -> tuple[bool, Decimal]:
    """ORI_DEEPSEEK_ENABLED and ORI_DEEPSEEK_MAX_RUN_USD; unset means disabled."""
    enabled = os.environ.get("ORI_DEEPSEEK_ENABLED", "").lower() == "true"
    limit = parse_usd(os.environ.get("ORI_DEEPSEEK_MAX_RUN_USD") or "0", "ORI_DEEPSEEK_MAX_RUN_USD must be a finite nonnegative number")
    return enabled, limit


def _arg_type(fn, *args):
    def parse(value: str):
        try:
            return fn(value, *args)
        except ValueError as err:
            raise argparse.ArgumentTypeError(str(err)) from None
    return parse


def validate_labeler(labeler: str, allow_none: bool = False) -> str:
    canned = labeler.startswith("canned:") and labeler.split(":", 1)[1].strip()
    if labeler == "deepseek" or (allow_none and labeler == "none") or canned:
        return labeler
    raise ValueError("labeler must be deepseek" + (", none" if allow_none else "") + ", or canned:<file.json>; no other provider is supported")


@functools.cache
def deepseek_key() -> str:
    """DEEPSEEK_API_KEY, or else the secret deepseek_api_key in Supabase Vault."""
    key = os.environ.get("DEEPSEEK_API_KEY") or store.secret("deepseek_api_key")
    if isinstance(key, str) and key.strip():
        return key.strip()
    raise RuntimeError("no DeepSeek key: set DEEPSEEK_API_KEY, or the secret deepseek_api_key in Supabase Vault (see README)")


def chat(system: str, user: str) -> str:
    """The model's reply to one message."""
    body = json.dumps({"model": MODEL, "thinking": {"type": "disabled"}, "temperature": 0, "max_tokens": MAX_OUTPUT_TOKENS,
                       "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    if len(body) > MAX_REQUEST_BYTES:
        raise RuntimeError("DeepSeek request is too large for a bounded classification call")
    GENERATION_BUDGET.require_enabled()  # before resolving the key
    key = deepseek_key()
    reservation = GENERATION_BUDGET.reserve(len(body))
    req = urllib.request.Request(DEEPSEEK, body, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        out = json.load(r)
    if not isinstance(out, dict):
        raise RuntimeError("DeepSeek gave no complete reply")
    GENERATION_BUDGET.settle(reservation, out.get("usage"))
    choices = out.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        raise RuntimeError("DeepSeek gave no complete reply")
    message = choices[0].get("message")
    if choices[0].get("finish_reason") != "stop" or not isinstance(message, dict) or message.get("tool_calls"):
        raise RuntimeError("DeepSeek gave no complete reply")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("DeepSeek gave an empty reply")
    return content


def _text(value: Any, limit: int) -> bool:
    """A non-blank string of at most limit characters."""
    return isinstance(value, str) and bool(value.strip()) and len(value) <= limit


def _check_reception(value: Any, data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"text", "links"} or not _text(value["text"], RECEPTION_CHARS):
        raise RuntimeError("DeepSeek gave an invalid reception draft")
    known = {r["url"] for r in data["responses"]}
    links = value["links"]
    if not isinstance(links, list) or not links or any(not isinstance(u, str) or u not in known for u in links) \
            or len(set(links)) != len(links):
        raise RuntimeError("DeepSeek reception references an unresolved response")
    return value


def _check_label(r: Any) -> None:
    fields = {"key", "category", "subject", "tags", "reason"}
    if not isinstance(r, dict) or set(r) != fields or not isinstance(r["category"], str) or r["category"] not in CATEGORIES:
        raise RuntimeError("DeepSeek gave an invalid classification")
    if not isinstance(r["key"], str) or not isinstance(r["subject"], str) or not TX.is_code(r["subject"]):
        raise RuntimeError("DeepSeek gave an invalid classification identity or subject")
    if not isinstance(r["tags"], list) or len(r["tags"]) > 4 or not all(_text(t, 80) for t in r["tags"]):
        raise RuntimeError("DeepSeek gave invalid classification tags")
    if not _text(r["reason"], 200):
        raise RuntimeError("DeepSeek gave no valid classification reason")


def _check_stance(r: Any) -> None:
    if not isinstance(r, dict) or set(r) != {"url", "stance", "reason"}:
        raise RuntimeError("DeepSeek gave an invalid stance proposal")
    stance = r["stance"]
    if stance is not None and not (isinstance(stance, str) and stance in STANCES):
        raise RuntimeError("DeepSeek gave an invalid stance proposal")
    if not isinstance(r["url"], str) or not _text(r["reason"], 200):
        raise RuntimeError("DeepSeek gave no valid stance identity or reason")


def ask(prompt_file: str, name: str, data: Any) -> Any:
    """The model's validated JSON reply to a prompt file, given the data between BEGIN_<name> and END_<name>."""
    value = json.loads(chat((HERE / "prompts" / prompt_file).read_text(), f"BEGIN_{name}\n{json.dumps(data, ensure_ascii=False)}\nEND_{name}"))
    if prompt_file == "reception.md":
        return _check_reception(value, data)
    if not isinstance(value, dict) or set(value) != {"results"} or not isinstance(value["results"], list):
        raise RuntimeError("DeepSeek gave no results array")
    replies = value["results"]
    if prompt_file == "label.md":
        expected = {entry["key"] for entry in data}
        if len(expected) != len(data):
            raise RuntimeError("ambiguous entry keys in classification batch; split the batch")
        for r in replies:
            _check_label(r)
        returned = [r["key"] for r in replies]
    elif prompt_file == "stance.md":
        expected = {r["url"] for entry in data for r in entry["responses"]}
        for r in replies:
            _check_stance(r)
        returned = [r["url"] for r in replies]
    else:
        raise RuntimeError("unsupported structured DeepSeek prompt")
    if len(returned) != len(expected) or set(returned) != expected:
        raise RuntimeError("DeepSeek omitted, duplicated or invented a result identity")
    return replies


# Errors from ask(): the API fails or times out, or the reply is not valid JSON of the expected shape.
LABELER_ERRORS = (RuntimeError, json.JSONDecodeError, urllib.error.URLError, TimeoutError)


def canned_replies(labeler: str, allow_none: bool = False) -> Any:
    """For --labeler canned:<file.json> (tests), the replies in that file; else None."""
    validate_labeler(labeler, allow_none)
    return json.loads(Path(labeler.split(":", 1)[1]).read_text()) if labeler.startswith("canned:") else None


# ---- label ----

BATCH = 20


def label(relabel_all: bool, labeler: str, limit: int | None = None, missing_subject: bool = False) -> int:
    canned: dict[str, Any] | None = canned_replies(labeler, allow_none=True)
    if missing_subject:
        todo = [(p, e) for p, e in load() if not TX.subject_of(e.get("domain"), e.get("review", {}).get("subject"))][:limit]
    elif relabel_all:
        todo = load(limit=limit)
    else:
        # Bulk-harvested arXiv papers are shown as research without a label.
        todo = load("NOT entry ? 'review' AND coalesce(entry->>'added_by', '') NOT LIKE 'harvest:arxiv-%%'", limit=limit)
    done, failed = 0, False
    for i in range(0, len(todo), BATCH):
        chunk = todo[i : i + BATCH]
        try:
            if labeler == "none":
                replies: dict[str, Any] = {}
            elif canned is not None:
                replies = canned
            else:
                data = [{"key": e["key"], "source": e["source"], "title": e["title"], "authors": e.get("authors", [])[:6],
                         "summary": e.get("summary", ""), "tags": e.get("tags", [])[:8]} for _, e in chunk]
                replies = {r["key"]: r for r in ask("label.md", "ENTRIES", data)}
        except LABELER_ERRORS as err:
            print(f"batch {i // BATCH + 1}: {err}", file=sys.stderr)
            failed = True
            continue
        for ref, e in chunk:
            if not (r := replies.get(e["key"])):
                continue
            e["review"] = _drop_empty({
                "category": r["category"],
                "subject": str(r.get("subject", ""))[:24],
                "tags": [str(t) for t in r.get("tags", [])][:6],
                "reason": str(r.get("reason", ""))[:200],
                "by": "canned" if canned is not None else MODEL,
                "at": S.today(),
            })
            if saved(ref, e):
                done += 1
            else:
                failed = True
        print(f"labelled {done}/{len(todo)}")
    return 2 if failed else 0


# ---- refresh ----


def refresh(older_than: int, limit: int, dry_run: bool) -> int:
    cutoff = (dt.date.today() - dt.timedelta(days=older_than)).isoformat()
    # Stalest first, so an entry whose source keeps failing does not hold back the rest.
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
        keep_fields = ["added", "added_by", "review"]
        if e.get("source") == "github" and e.get("title") and fresh.get("title") and e["title"].lower() != fresh["title"].lower():
            keep_fields.extend(["title", "authors"])
        keep = pick(e, keep_fields)
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

KEPT = ("added", "stance")  # a link's fields set by a person, kept when the link is read again
DESCRIBED = ("title", "author", "date")  # a web link's description; discuss --title/--author/--date give or correct it
DISCUSSED = "jsonb_typeof(entry->'discussion') = 'array' AND jsonb_array_length(entry->'discussion') > 0"

# Stances, which count as upvotes and which mark a record disputed; shared with the site.
STANCE_FILE = json.loads((ROOT / "site" / "lib" / "records" / "stances.json").read_text())
STANCES: dict[str, str] = STANCE_FILE["stances"]
UPVOTING = set(STANCE_FILE["upvoting"])
DISPUTING = set(STANCE_FILE["disputing"])


def upvoting(links: list[dict[str, Any]]) -> int:
    """How many responses count as upvotes, unlabelled ones included if stances.json says so."""
    return sum(1 for d in links if (d["stance"] in UPVOTING if "stance" in d else STANCE_FILE["unlabelled_upvotes"]))


def disputed(links: list[dict[str, Any]]) -> bool:
    return any(d.get("stance") in DISPUTING for d in links)


def unlabelled(e: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in e.get("discussion") or [] if "stance" not in d]


def with_stance(link: dict[str, Any], stance: str | None) -> dict[str, Any]:
    """The link with that stance; "none" clears it, None leaves it unchanged."""
    if not stance:
        return link
    out = {k: v for k, v in link.items() if k != "stance"}
    return out if stance == "none" else {**out, "stance": stance}


def reread(old: dict[str, Any], fresh: dict[str, Any]) -> dict[str, Any]:
    """Merges a fresh read of a link into the stored link. A web page keeps the title, author and date it was
    attached with, because a person may have given or corrected them (a PDF has none; a blog's window title may
    name the blog instead of the guest who wrote the post). An X post keeps only what the post shows now."""
    kept = pick(old, DESCRIBED) if fresh.get("kind") == "web" else {}
    return {**fresh, **kept, **pick(old, KEPT)}


def recheck(links: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rereads each link. A deleted link is dropped; an unreachable one is kept unchanged."""
    out = []
    for d in links:
        try:
            out.append(reread(d, S.discussion_link(d["url"])))
        except S.NotFound:
            print(f"dropped  {d['url']}")
        except (ValueError, S.SourceError) as err:
            print(f"kept     {d['url']}: {err}", file=sys.stderr)
            out.append(d)
    return out


def propose_stances(records: list[str], labeler: str) -> int:
    """Prints a proposed `discuss --stance` command for each unlabelled link; writes nothing.
    canned:<file.json> reads {url: {stance, reason}}."""
    canned = canned_replies(labeler)
    todo = [e for _, e in load(DISCUSSED) if (not records or rid(e) in records) and unlabelled(e)]
    batches: list[list[dict[str, Any]]] = [[]]
    for e in todo:  # about BATCH links per batch; a record is never split across batches
        if sum(len(x["discussion"]) for x in batches[-1]) >= BATCH:
            batches.append([])
        batches[-1].append(e)
    n, failed = 0, False
    for batch in filter(None, batches):
        data = [{"id": rid(e), "title": e["title"], "summary": e.get("summary", ""),
                 "responses": [pick(d, ("url", "kind", "author", "title", "text")) for d in unlabelled(e)]} for e in batch]
        try:
            replies = canned if canned is not None else {r["url"]: r for r in ask("stance.md", "RECORDS", data)}
        except LABELER_ERRORS as err:
            print(f"skipped {len(batch)} records: {err}", file=sys.stderr)
            failed = True
            continue
        for r in data:
            print(f"\n# {r['id']}: {r['title'][:90]}")
            for d in r["responses"]:
                p = replies.get(d["url"]) or {}
                if p.get("stance") in STANCES:
                    n += 1
                    print(f"python3 indexer/index.py discuss {shlex.quote(r['id'])} {shlex.quote(d['url'])} --stance {p['stance']}"
                          f"   # {str(p.get('reason', ''))[:120]}")
                else:
                    print(f"# no proposal, open it: {d['url']}")
    print(f"\n{n} stances proposed for {sum(len(unlabelled(e)) for e in todo)} unlabelled links on {len(todo)} records; nothing written."
          " Run the commands you agree with.")
    return 2 if failed else 0


def recheck_all(records: list[str], dry_run: bool) -> int:
    """Rereads every record's links (or the named records'), so a deleted post is removed within a day."""
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


def discuss(record: str, urls: list[str], drop: bool, dry_run: bool, stance: str | None = None,
            described: dict[str, str] | None = None) -> int:
    """Attaches links about a record, or removes them with drop. With a stance, new links get it, and links
    already attached get it without being read again. `described` (--title, --author, --date) supplies what a
    page does not say about itself, as with a PDF; a web page with no title is not attached."""
    described = _drop_empty(described or {})
    if not urls:
        print("name the links to attach, or use --recheck")
        return 2
    if not (found := read_entry(record)):
        return 2
    ref, e = found
    links = e.get("discussion", [])
    if drop:
        gone = {S.identity(u) for u in urls}
        links = [x for x in links if S.identity(x["url"]) not in gone]
        print(f"{len(e.get('discussion', [])) - len(links)} dropped")
    else:
        for url in urls:
            old = next((x for x in links if S.identity(x["url"]) == S.identity(url)), None)
            if old and (stance or described):
                changed = with_stance({**old, **described}, stance)
                links = [changed if x is old else x for x in links]
                print(f"= {stance or 'described':<10} {old['url']}")
                continue
            try:
                d = S.discussion_link(url)
            except (ValueError, S.NotFound, S.SourceError) as err:
                print(f"skipped {url}: {err}", file=sys.stderr)
                continue
            if d.get("kind") == "web" and not (described.get("title") or d.get("title")):
                print(f"skipped {url}: the page gives no title (a PDF?); give --title and --author", file=sys.stderr)
                continue
            same = next((x for x in links if S.identity(x["url"]) == S.identity(d["url"])), None)
            new = {**d, **described, "added": S.today(), **pick(old or same or {}, KEPT)}
            links = [x for x in links if x is not same and x is not old] + [with_stance(new, stance)]
            print(f"+ {d.get('author') or d.get('site')}: {(d.get('text') or d.get('title') or d['url'])[:90]}")
    e["discussion"] = sorted(links, key=lambda d: d.get("date", ""))
    if not dry_run:
        save(ref, e)
    return 0


# ---- reception ----

# A one- or two-sentence summary of how the work was received, based on some of its links. It is published
# only after a person reviews it, and is unpublished when the links (or their stances) change.
RECEPTION_CHARS = 400
LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")  # a GitHub login


def basis(links: list[dict[str, Any]]) -> str:
    """A short hash of the links and their stances."""
    pairs = sorted([d["url"], d.get("stance") or ""] for d in links)
    return hashlib.sha1(json.dumps(pairs).encode()).hexdigest()[:12]


def reception_state(e: dict[str, Any]) -> str | None:
    """published, draft (not reviewed), stale (links changed since), or None."""
    r = e.get("reception")
    if not r:
        return None
    if r.get("basis") != basis(e.get("discussion") or []):
        return "stale"
    return "published" if r.get("reviewed_by") and r.get("text") else "draft"


def published_reception(e: dict[str, Any]) -> dict[str, Any] | None:
    return pick(e["reception"], ("text", "written", "links", "reviewed_by")) if reception_state(e) == "published" else None


def draft_reception(e: dict[str, Any], labeler: str) -> dict[str, Any]:
    """The model's draft from the labelled links. canned:<file.json> reads {record id: {text, links}}."""
    validate_labeler(labeler)
    labelled = [d for d in e.get("discussion") or [] if d.get("stance")]
    if not labelled:
        raise ValueError("no labelled links: label them first (discuss --stance, or --propose-stances)")
    canned = canned_replies(labeler)
    if canned is not None:
        reply = canned.get(rid(e)) or {}
    else:
        data = {"id": rid(e), "title": e["title"], "summary": e.get("summary", ""), "withdrawn": e.get("withdrawn_on") or bool(e.get("withdrawn")),
                "responses": [pick(d, ("url", "kind", "author", "site", "date", "stance", "title", "text")) for d in labelled]}
        reply = ask("reception.md", "RECORD", data)
    if not isinstance(reply, dict):
        raise ValueError("the labeler did not reply with an object")
    text = S.clean(str(reply.get("text", "")))
    if not text:
        raise ValueError("the labeler gave no text")
    urls = {d["url"] for d in labelled}
    return {"text": text[:RECEPTION_CHARS], "links": [u for u in reply.get("links", []) if u in urls] or sorted(urls),
            "drafted_by": "canned" if canned is not None else MODEL}


def list_receptions() -> int:
    rows = [(rid(e), reception_state(e), e["reception"]) for _, e in load("entry ? 'reception'")]
    for i, state, r in rows:
        print(f"{state:<9} {i}  {r.get('text', '')[:80]}  {'@' + r['reviewed_by'] if r.get('reviewed_by') else ''}")
    print(f"{len(rows)} receptions: {sum(s == 'published' for _, s, _ in rows)} published")
    return 0


def reception(record: str | None, draft: bool, text: str | None, reviewed_by: str | None, links: list[str] | None,
              labeler: str, dry_run: bool) -> int:
    """Draft, write or review a record's reception; with no record, list every reception."""
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
        stored = {S.identity(u): u for u in urls}
        new["links"] = [stored.get(S.identity(u), u) for u in links]
    if missing := [u for u in new["links"] if u not in urls]:
        print(f"not among {record}'s links: {', '.join(missing)}")
        return 2
    if len(new["text"]) > RECEPTION_CHARS:
        print(f"the text has {len(new['text'])} characters; keep it to one or two sentences, under {RECEPTION_CHARS}")
        return 2
    e["reception"] = _drop_empty({**new, "written": S.today(), "reviewed_by": None if draft else reviewed_by, "basis": basis(attached)})
    print(json.dumps(e["reception"], indent=2, ensure_ascii=False))
    print(f"state: {reception_state(e)}" + ("" if reviewed_by else f"; a person publishes it with: python3 indexer/index.py reception {record} --reviewed-by <login>"))
    if not dry_run:
        save(ref, e)
    return 0


# ---- build ----

# Entry fields served as they are; to_item adds id, tags, published, category and subject.
PASSTHROUGH = ("source", "url", "title", "authors", "summary", "domain", "origin", "agent_ready", "gone", "stars", "pdf",
               "family", "family_title", "formalized", "withdrawn", "withdrawn_on", "verified", "trust", "ai_models",
               "formalizes", "formalizations", "authorship", "human_understanding", "repo", "json")
PREFIXES = json.loads((ROOT / "site" / "lib" / "records" / "prefixes.json").read_text())["prefixes"]
# An X post's text is shown by X's own embed, so it is never served.
X_FIELDS = ("kind", "url", "author", "handle", "date", "added", "stance")


def served_link(d: dict[str, Any]) -> dict[str, Any]:
    return pick(d, X_FIELDS) if d.get("kind") == "x" else dict(d)


def to_item(e: dict[str, Any]) -> dict[str, Any] | None:
    """What the site and API serve for one entry; None for entries labelled harmful or merged into another record."""
    r = e.get("review", {})
    if r.get("category") == "harmful" or e.get("merged_into"):
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
    """Links indexed records to each other: a discussion link to a paper that is also in the index gets a
    "record" field, and that record lists the item under "discusses"."""
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
    kept = [it for e in [*map(app_entry, load_entries()), *entries] if (it := to_item(e))]
    crosslink(kept)
    apps = sorted((it for it in kept if it["source"] == "app"), key=lambda it: it.get("published", ""))
    rest = sorted((it for it in kept if it["source"] != "app"), key=lambda it: it.get("published", ""), reverse=True)
    return apps + rest


def dumps(obj: Any) -> str:
    """JSON for the build's files, with any U+FFFD from a source escaped."""
    return json.dumps(obj, ensure_ascii=False).replace("�", "\\ufffd")


def build() -> int:
    entries = [e for _, e in load()]
    all_items = items(entries)
    if unknown := {it["source"] for it in all_items} - PREFIXES.keys():
        raise SystemExit(f"no prefix for {', '.join(sorted(unknown))}: add it to site/lib/records/prefixes.json (prefixes are never renamed)")
    if bad := [p for it in all_items for p in schema.problems(it, {"$ref": "#/components/schemas/Record"}, it["id"])]:
        raise SystemExit(f"{len(bad)} problems with the Record schema (site/lib/api/openapi.ts; then npm run openapi in site/):\n  " + "\n  ".join(bad[:20]))
    counts = Counter(it["source"] for it in all_items)
    names = {"app": "agenticpapers.app", **{s.name: s.label for s in S.SOURCES}}
    index = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "labels": names,
             "categories": CATEGORIES, "taxonomy": TX.as_json(), "counts": dict(counts), "items": all_items}
    DIST.mkdir(exist_ok=True)
    (DIST / "index.json").write_text(dumps(index))
    TX.write_json()
    print(f"built dist/index.json: {len(all_items)} items " + ", ".join(f"{names.get(k, k)} {v}" for k, v in counts.most_common()))
    if stale := [rid(e) for e in entries if reception_state(e) == "stale"]:
        print(f"{len(stale)} receptions not published, their links changed after they were written: {', '.join(stale)}."
              " Review each again: python3 indexer/index.py reception <id> --reviewed-by <login> (or --text, or --draft)", file=sys.stderr)
    return 0


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="inspect with --dry-run; writes use authenticated POST /api/v1/submit")
    a.add_argument("url")
    a.add_argument("--by", default="")
    a.add_argument("--dry-run", action="store_true")

    h = sub.add_parser("harvest")
    h.add_argument("--source")
    h.add_argument("--limit", type=int)
    h.add_argument("--dry-run", action="store_true")

    lb = sub.add_parser("label")
    lb.add_argument("--all", action="store_true")
    lb.add_argument("--labeler", default="deepseek", type=_arg_type(validate_labeler, True))
    lb.add_argument("--limit", type=int)
    lb.add_argument("--missing-subject", action="store_true")

    r = sub.add_parser("refresh")
    r.add_argument("--older-than", type=int, default=7)
    r.add_argument("--limit", type=int, default=200)
    r.add_argument("--dry-run", action="store_true")

    d = sub.add_parser("discuss")
    d.add_argument("record", nargs="?")
    d.add_argument("urls", nargs="*")
    d.add_argument("--drop", action="store_true")
    d.add_argument("--dry-run", action="store_true")
    d.add_argument("--recheck", action="store_true", help="read every link again (or the named records' links); deleted posts are removed")
    d.add_argument("--stance", choices=[*STANCES, "none"], help="what the links say about the record (see site/lib/records/stances.json); set on links already attached without reading them again")
    d.add_argument("--title", help="the link's title, for a page that does not give one (a PDF note on a home page)")
    d.add_argument("--author", help="who wrote it, for a page that does not say (a PDF)")
    d.add_argument("--date", type=lambda s: dt.date.fromisoformat(s).isoformat(), help="YYYY-MM-DD, for a page that does not say")
    d.add_argument("--propose-stances", action="store_true", help="the labelling agent proposes stances for unlabelled links (or the named records'); prints them as commands, writes nothing")
    d.add_argument("--labeler", default="deepseek", type=_arg_type(validate_labeler), help="for --propose-stances: deepseek, or canned:<file.json>")

    rc = sub.add_parser("reception")
    rc.add_argument("record", nargs="?")
    rc.add_argument("--draft", action="store_true")
    rc.add_argument("--text")
    rc.add_argument("--reviewed-by", help="the GitHub login of the person who checked the text against its links; publishes it")
    rc.add_argument("--links", nargs="+", help="the links the text is based on (default: all of the record's links)")
    rc.add_argument("--labeler", default="deepseek", type=_arg_type(validate_labeler))
    rc.add_argument("--dry-run", action="store_true")

    for p in (lb, d, rc):
        p.add_argument("--allow-paid-deepseek", action="store_true", help="explicitly authorize DeepSeek generation for this run; requires a positive USD cap")
        p.add_argument("--max-cost-usd", type=_arg_type(parse_usd, "budget must be a finite nonnegative USD amount"),
                       help="total run cap; absent ORI_DEEPSEEK_MAX_RUN_USD defaults to 0 (disabled)")

    sub.add_parser("build")
    return ap


def main(argv: Iterable[str] | None = None) -> int:
    global GENERATION_BUDGET
    ap = parser()
    args = ap.parse_args(list(argv) if argv is not None else None)
    uses_generation = args.cmd == "label" or (args.cmd == "discuss" and args.propose_stances) or (args.cmd == "reception" and args.draft)
    if uses_generation:
        try:
            enabled, limit = generation_settings()
        except ValueError as err:
            print(err, file=sys.stderr)
            return 2
        GENERATION_BUDGET = GenerationBudget(enabled or args.allow_paid_deepseek,
                                             limit if args.max_cost_usd is None else args.max_cost_usd)
    S.TOKEN = github_token()
    try:
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
            return discuss(args.record, args.urls, args.drop, args.dry_run, args.stance,
                           {"title": args.title, "author": args.author, "date": args.date})
        if args.cmd == "reception":
            return reception(args.record, args.draft, args.text, args.reviewed_by, args.links, args.labeler, args.dry_run)
        return build()
    finally:
        if uses_generation and GENERATION_BUDGET.calls:
            print(f"DeepSeek run budget: ${GENERATION_BUDGET.used} of ${GENERATION_BUDGET.limit} "
                  f"used/reserved across {len(GENERATION_BUDGET.calls)} requests (unknown usage retains reservation)", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
