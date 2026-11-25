# Operations, indexing, and curation

Runbook for maintaining the Delphi.science index, curating external responses, operating the moderation gate, and running scheduled workflows. For local development without credentials, see [README.md](../README.md#local-development) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Environment

Operator scripts read `SUPABASE_DB_URL` from the environment (`vercel env pull` writes it to `site/.env.local`):

```bash
pip install -r indexer/requirements.txt
set -a; . site/.env.local; set +a
```

## Indexing and classification

- **Ingestion:** Any public record from a supported source that resolves with a title and is not yet indexed is accepted. Users and their agents share a limit of 20 direct submissions per day.
- **Metadata:** Title, authors, abstract (truncated to ~600 characters), date, and URLs are fetched from upstream APIs with per-host rate limiting and disk caching in `.cache/`. General HTTPS pages are fetched through `site/scripts/read-web.ts` with size and timeout limits, so reading or refreshing web URLs from Python requires Node.js.
- **Refresh:** `indexer/index.py refresh` re-fetches the 200 stalest entries older than 7 days, relabels entries whose title or abstract changed, and marks HTTP 404 responses as `gone`.
- **Classification:** `indexer/index.py label` uses DeepSeek (`indexer/prompts/label.md`) to assign a category (`research`, `non-research`, `fiction`, `low-info`, or `harmful`), an arXiv subject code, and up to 4 topic tags. Search defaults to `research`. Entries labeled `harmful` remain in `open_index.entries` but are omitted from `dist/index.json` and search. Classification is optional metadata, not peer review.
- **Open problems:** A record with a `problem` object is an open problem or conjecture, not a paper (`is:problem`, `is:open`, `is:solved`). Its summary is the statement and `problem.status` is what the source states. Formal Conjectures (`google-deepmind/formal-conjectures`) is read from the repository tarball, one record per Lean file that tags a statement `research open` or `research solved`. Its Erdős folder is skipped until erdosproblems.com agrees, and arXiv-based files keep no statement text. The harvest job is off in `indexer/harvest.json` until enabled. The paper or MathOverflow question a file is named after goes in `formalizes` (shown as "Posed in"; the paper's page lists the problem under "Stated in Lean"), and its formal-proof links in `formalizations`. A paper that settles a problem is attached with `discuss --stance solves`. A problem has no publication date, so it sorts after dated records. Its page lists the public forum topics that name it and, for the reader alone, their private spaces whose description names its id.
- **UnsolvedMath:** `ulamai/UnsolvedMath` on Hugging Face gathers named problem lists (Oberwolfach reports, AIM lists, the Kourovka Notebook, Kirby's list, Open Problem Garden and others). Its statuses and some statements are machine-made, so records carry its name as their source and link the original statement where the dataset gives one (`problem.source`). Its notes and literature reviews are not taken, and its Erdős set is skipped. When two sources list the same collection and number, the build serves the one from the source that comes first in `SOURCES` (Formal Conjectures before UnsolvedMath). Problem records are not sent to the labelling model.
- **Tracked source details:** APP (`agenticpapers.app`) is harvested from `https://agenticpapers.app/papers/index.json`. Hexagon tracks `authorship` and `human_understanding` (`none`, `some`, `all`). Unmoderated venues (`vixra.org`, `aixiv.science`, `clawxiv.org`, `jaigp.org`) are blocked in `BLOCKED_HOSTS` in `indexer/sources.py`.

## External responses and candidate discovery

`indexer/index.py discuss` attaches responses from researchers, labs, journals, and established research blogs (excluding anonymous accounts, aggregators, and reposts). X posts store only author, handle, and date via oEmbed and render through X's embed widget so deleted posts disappear automatically; other links store title, URL, author, date, and a verbatim excerpt.

For pages without embedded metadata (such as standalone PDFs) or guest posts needing attribution overrides, pass `--title`, `--author`, and `--date`; untitled pages are otherwise skipped, and rechecks preserve manual metadata. MathOverflow, Math.SE, CSTheory.SE, and Physics.SE links query the Stack Exchange API and credit answer URLs (`/a/<id>` or `/questions/<id>/<slug>/<answer id>`) to the answer's author. `discuss --recheck` runs daily to drop dead links.

`indexer/candidates.py` discovers candidate responses across four streams:

- Research blog feeds listed in `indexer/blogs.json` (mapped to full author names).
- New arXiv papers mentioning OpenAI, GPT, Anthropic, or Claude outside language-model categories, plus referenced AI-generated records parsed from arXiv HTML bibliographies.
- New arXiv papers that cite a record and mention it in their abstract (via INSPIRE for physics and Semantic Scholar otherwise; set `S2_API_KEY` to avoid shared rate limits).
- MathOverflow, CSTheory.SE, and Physics.SE posts, plus Bluesky posts linking lab release pages or already-discussed records.

Direct links and citations match deterministically; lab-only mentions match against that lab's record titles and appear last. Each report omits candidates already listed in earlier reports in the same folder, and every candidate is reviewed manually before attaching.

### Stances and reception summaries

Editors tag external responses with `discuss --stance`:

| Stance | Meaning | Effect |
| --- | --- | --- |
| `refutes` | Identifies an error invalidating the main claim | Flags record `is:disputed` |
| `questions` | Flags an incomplete step, Lean/prose mismatch, weaker result, or priority issue | Flags record `is:disputed` |
| `confirms` | Independently verifies or formalizes the result | Contributes to popularity |
| `simplifies` | Provides a shorter or cleaner proof | Contributes to popularity |
| `extends` | Builds on the result | Contributes to popularity |
| `solves` | Settles the open problem a problem record states (proof, disproof or answer) | Neutral; the source's `problem.status` stays as it is |
| `reacts` | Commentary without a specific technical claim | Neutral |

Unlabeled links also contribute to popularity. `discuss --propose-stances` generates suggested stance commands via an LLM (`indexer/prompts/stance.md`) for editor review.

Discussed records can also carry a 1–2 sentence `reception` summary with date, supporting links, and reviewer (`reviewed_by`). Draft one with `reception <id> --draft` (`indexer/prompts/reception.md`); publishing requires `--reviewed-by`. Any change to a record's linked responses marks its summary stale until re-reviewed.

### Indexer command reference

```bash
python3 indexer/index.py add <url or id> --dry-run                        # inspect metadata without writing
python3 indexer/index.py harvest [--source palomar] [--limit N] [--dry-run]
python3 indexer/index.py label [--all] [--labeler deepseek|none|canned:<file.json>]
python3 indexer/index.py refresh [--older-than 7] [--dry-run]
python3 indexer/index.py discuss openai-math/<key> <url>...               # attach external responses
python3 indexer/index.py discuss --recheck [<record id>...]               # drop dead links
python3 indexer/index.py discuss <record id> <url>... --stance confirms   # set response stance
python3 indexer/index.py discuss <record id> <pdf> --title "..." --author "..." [--date YYYY-MM-DD]
python3 indexer/index.py discuss --propose-stances [<record id>...]       # propose stance commands
python3 indexer/index.py reception <record id> --draft                    # draft a reception summary
python3 indexer/index.py reception <record id> --reviewed-by <login> [--text "..."] [--links <url>...]
python3 indexer/index.py reception                                        # list published, draft, and stale summaries
python3 indexer/index.py build                                            # write dist/index.json
python3 indexer/candidates.py [--days 7]                                  # find candidate responses
X_BEARER_TOKEN=... python3 indexer/x_candidates.py [--days 4]            # query X API (stdout only)
```

## Paid DeepSeek guardrails

Python DeepSeek calls (labeling, stance proposals, reception drafts) are disabled by default even when an API key is present:

- **One-off runs:** Pass `--allow-paid-deepseek --max-cost-usd <USD>`. Worst-case cost is reserved before each request; if token usage is missing from the reply, the full reservation is deducted.
- **Offline labeling:** Pass `--labeler none` or `--labeler canned:<file.json>` (other provider names are rejected).
- **Daily CI job:** Requires repository variables `ORI_DEEPSEEK_ENABLED=true` and a positive `ORI_DEEPSEEK_MAX_RUN_USD`; otherwise labeling is skipped while harvesting, building, and loading still run. Labeling errors fail the job after ingestion completes.
- **Pricing assumptions:** Cost caps assume `deepseek-flash` rates of $0.30/M input tokens and $1.20/M output tokens (checked 2026-10-27); re-verify before enabling.

## Publication moderation internals

Public submissions, forum posts, record reviews, and public vote notes pass through `site/lib/moderation/moderate.ts` before storage (public policy at [/moderation](https://delphi.science/moderation), `site/app/moderation/page.tsx`):

- **Decisions:** `ACCEPT`, `REQUEST_REVISION`, `REJECT`, or `REVIEW_NEEDED`. Only `ACCEPT` publishes.
- **Model and fail-closed behavior:** Runs `deepseek-flash` in non-thinking JSON mode using `DEEPSEEK_API_KEY` or the Supabase Vault secret `deepseek_api_key`. Missing keys or empty, malformed, or failed responses block publication with no bypass or fallback provider. Tests must inject a mock moderator explicitly.
- **Error contract:** Always returns `{error:{code,message,fix}}` with HTTP 422 `moderation_rejected`, 409 `moderation_review_needed`, or 503 `moderation_unavailable`.
- **Drafts and rate limits:** Refused text is not stored server-side; the browser keeps local drafts per author and form. All moderated routes share a 30-attempt daily limit per user and their agents, recorded in a private audit table.
- **Operator isolation:** `indexer/index.py add` supports `--dry-run` only so public submissions cannot bypass moderation. Scheduled operator jobs run separately from public submission endpoints.

## Scheduled workflows and releases

| Workflow / config | Purpose |
| --- | --- |
| `.github/workflows/daily.yml` | Daily harvest, label, refresh, link recheck, build, and Postgres load (05:30 UTC) |
| `.github/workflows/responses.yml` | Daily `indexer/candidates.py` run (04:17 UTC, 4-day window) committing deduplicated reports to `reports/responses/` |
| `.github/workflows/test.yml` | CI test suite: builds sample index on PGlite, runs Python and site tests, and runs `tsc --noEmit` |
| `.github/workflows/release-cli.yml` | Publishes `cli/` to npm as `delphi-science` on `cli-v*` tags via OIDC trusted publishing ([cli/PUBLISHING.md](../cli/PUBLISHING.md)) |
| `.github/workflows/usage-retention.yml` | Optional cleanup of usage counters older than 90 UTC dates ([usage-analytics.md](usage-analytics.md)) |
| `.github/workflows/author-check.yml` | Enforces a Vercel team commit email (`VERCEL_TEAM_EMAILS`, e.g., `14889516+LionSR@users.noreply.github.com`) |
| `indexer/harvest.json` | Configures scheduled harvest jobs (`"enabled": false` disables a job) |

- **Plugin packaging:** Run `cd site && npm run plugin` to build `dist/delphi-plugin.zip` and `dist/chatgpt-app-submission.json` (see [site/plugin/TESTING.md](../site/plugin/TESTING.md)).
- **Usage analytics:** Off by default; see [usage-analytics.md](usage-analytics.md) for environment flags, privacy bounds, and Vercel cost considerations.
