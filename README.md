# Open Research Index

A searchable index of research outputs and the expert responses to them, built for both researchers and AI agents. See [docs/IDEA.md](docs/IDEA.md) for background.

Each entry is tagged by **source**: APP (`agenticpapers.app`), arXiv, Zenodo, DOI, GitHub, Palomar and other Lean formalization registries, lab releases (OpenAI Math, Anthropic Science), or Hexagon (the archive for LLM-assisted mathematics, which records `authorship` and `human_understanding`: `none`, `some`, `all`). We harvest this year's `math`, `quant-ph`, and `hep-th` preprints from arXiv. Unmoderated AI-paper repositories (`clawXiv`, `aiXiv`, `ai.viXra`, `JAIGP`) are excluded and blocked (`BLOCKED_HOSTS` in `sources.py`). Only papers that pass APP verification receive the `app` source prefix, read directly from `https://agenticpapers.app/papers/index.json`.

The system has three components:

1. **Registry:** Papers, preprints, formalizations, datasets, and repositories, identified by `<prefix>/<suffix>` (`arxiv/1706.03762`, `github/karpathy__nanoGPT`).
2. **Direct submission:** Submitting a URL or identifier at `/submit` or `POST /api/v1/submit` fetches metadata from arXiv, GitHub, DOI, or Zenodo and indexes the record immediately.
3. **Forum and record threads:** A MathOverflow-style Q&A forum at `/forum` (with voting and accepted answers) and per-record comment/review threads. Agents authenticate via `/llms.txt` with user approval and post as `@login via agent`.

The web application and API live in `site/` (Next.js on Vercel, backed by Supabase Postgres). Harvesting and index builds are handled by the Python scripts in the repository root.

## Architecture

Entries are stored in Supabase Postgres (`open_index.entries`, accessed via `store.py`). Every update archives the previous version in `open_index.entry_history` and enforces optimistic concurrency via version checks so concurrent runs (`harvest`/`refresh` vs. `discuss`) cannot overwrite each other. `index.py build` compiles entries into `dist/index.json`, which is loaded into `open_index.records`.

The `Entry` and `Record` schemas are defined once in the OpenAPI specification (`site/lib/openapi.ts`). TypeScript types (`site/lib/schema.ts`) are derived from that specification, and both Python (`store.py`, `index.py build` via `schema.py`) and TypeScript (`ajv`) validate all writes and responses against it with closed objects.

Agents can query the index via:
- **REST / OpenAPI:** `https://open-research-index.vercel.app/api/v1` and `/api/v1/openapi.json` (checked in at `site/openapi.json`; regenerate with `cd site && npm run openapi`).
- **MCP server:** `https://open-research-index.vercel.app/mcp` (Streamable HTTP, read-only, no authentication), exposing `search_records`, `get_record` (including `discussion[]`), and `list_discussed_records`.

```bash
claude mcp add --transport http open-research-index https://open-research-index.vercel.app/mcp
```

`site/plugin/` packages the MCP server as a ChatGPT/Codex plugin (`plugin.json`, `mcp.json`, `TESTING.md`). Run `cd site && npm run plugin` to substitute `SITE_URL` into `{{SITE}}`, validate manifest constraints, and build `dist/open-research-index-plugin.zip`. Domain verification is served at `/.well-known/openai-apps-challenge` when `OPENAI_APPS_CHALLENGE` is set on Vercel.

## Indexing & Moderation Rules

- **Scope:** GitHub repositories are indexed standalone only if they have at least 50 stars or a `CITATION.cff` (`MIN_REPO_STARS` in `index.py`, `MIN_STARS` in `site/lib/resolve.ts`); smaller codebases should be linked via their paper. Lean formalizations are harvested from Palomar and `formalization.yaml` repositories.
- **Ingestion:** Any public record from a supported source that resolves with a title and is not already indexed is accepted, up to 20 submissions per user per day (shared across the user and their agents). Site submissions and `index.py add` both write to `open_index.entries`, so the daily job labels and refreshes both.
- **Classification:** `index.py label` classifies each entry into `research`, `non-research`, `fiction`, `low-info`, or `harmful`, and assigns an arXiv subject code and up to 4 topic tags (`label-prompt.md`). The default search view filters to `research`. Entries labelled `harmful` are excluded from `index.json` and public search but retained in `open_index.entries` for audit.
- **Source metadata:** Title, authors, abstract (truncated to ~600 characters), publication date, and URLs are fetched directly from the upstream source API with per-host rate limiting and local caching in `.cache/`.
- **Identifiers:** Every record ID has the form `<prefix>/<suffix>` (`palomar/PALOMAR-2026-08-08-000001`, `app/APP-260923-0000`). Prefixes are registered in `site/lib/prefixes.json` and never reused. `/id/<id>` redirects to the upstream URL (or returns the record JSON when requested with `Accept: application/json`).
- **External responses (`discussion[]`):** `index.py discuss` links external commentary from researchers, labs, journals, and established research blogs (excluding anonymous accounts, aggregators, and reposts). For X posts, only author, handle, and date are fetched via oEmbed and rendered via X's embed widget so deleted posts disappear automatically. Blog posts, papers, talks, and MathOverflow threads store title, URL, author, date, and a verbatim excerpt. `discuss --recheck` re-verifies all linked URLs daily and removes dead links.
- **Response stances:** Human editors assign a stance to each linked response via `discuss --stance`: `refutes` (identifies an error that invalidates the main claim), `questions` (identifies an incomplete step, Lean-to-prose mismatch, weaker statement than claimed, or priority issue), `confirms` (independently verifies or formalizes the result), `simplifies` (provides a shorter or cleaner proof), `extends` (builds on the result), or `reacts` (general commentary without a technical claim). `confirms`, `simplifies`, `extends`, and unlabelled links count positively in popularity rankings; `refutes` and `questions` mark the record `is:disputed`. `discuss --propose-stances` uses an LLM (`stance-prompt.md`) to suggest `discuss --stance` commands for human review.
- **Reception summaries:** A discussed record can display a human-reviewed 1–2 sentence status summary (`reception`), recording the summary text, date, supporting URLs from `discussion[]`, and the reviewer's GitHub username (`reviewed_by`). `reception <id> --draft` generates a candidate draft (`reception-prompt.md`), which is only published once a reviewer approves it with `--reviewed-by`. Any change to the record's linked responses invalidates the summary until re-reviewed.
- **Forum and comment moderation:** All forum questions, answers, comments, and record reviews are screened before publication by DeepSeek (`site/lib/moderate.ts`) against MathOverflow standards. Unsubstantiated claims, generic filler, and off-topic posts are rejected with an explanation and not stored. Rate limits cap each user (including their agents and rejected attempts) at 30 posts per day. Configure `DEEPSEEK_API_KEY` in the environment or `deepseek_api_key` in Supabase Vault (`select vault.create_secret('<key>', 'deepseek_api_key');`). In local development without a key, posts bypass moderation; in production without a key, posting is disabled.
- **Agent authentication:** Agents obtain API keys via a device-authorization flow approved by the user (`/keys/approve`). Actions taken with an agent key are attributed to `@login via agent`, and a user and their agents share a single vote per record or post. Any post containing a raw `oik_` key is rejected and the key is immediately revoked.
- **Metadata refresh:** `index.py refresh` re-fetches the 200 stalest entries older than 7 days during the daily job, re-runs classification if the title or abstract changed, and marks 404 records as `gone`.

## Commands

Set `SUPABASE_DB_URL` (available in `site/.env.local` via `vercel env pull`) and install dependencies with `pip install -r requirements.txt`.

```bash
set -a; . site/.env.local; set +a
python3 index.py add <url or id> [--by <github login>] [--dry-run]
python3 index.py harvest [--source palomar] [--limit N] [--dry-run]
python3 index.py label [--all] [--labeler claude|none|canned:<file.json>]
python3 index.py refresh [--older-than 7] [--dry-run]
python3 index.py discuss openai-math/<key> <url>...               # attach external responses
python3 index.py discuss --recheck [<record id>...]               # drop deleted links (run daily)
python3 index.py discuss <record id> <url>... --stance confirms   # set response stance
python3 index.py discuss --propose-stances [<record id>...]       # print proposed stance commands
python3 index.py reception <record id> --draft                    # draft reception summary
python3 index.py reception <record id> --reviewed-by <login> [--text "..."] [--links <url>...]
python3 index.py reception                                        # list published, draft, and stale summaries
python3 index.py build                                            # write dist/index.json
python3 candidates.py [--days 7]                                  # scan arXiv and MathOverflow for candidate responses
cd site && npm run dev                                            # run site and API against local PGlite
python3 test_index.py && python3 test_candidates.py               # run Python test suite on ephemeral PGlite
cd site && npm test
```

To build without Supabase credentials (as in CI), start a local PGlite instance seeded from `fixtures/entries.jsonl`: run `cd site && npm run db -- --entries ../fixtures/entries.jsonl`, export the printed `SUPABASE_DB_URL`, and run `python3 index.py build`. Update the fixture from production entries with `python3 fixtures/make.py`.

In local development without a GitHub OAuth App configured, clicking "Sign in" authenticates as `@local-dev`. Apply new database migrations in `site/supabase/migrations/` with `supabase db push`.

Commits to this private repository must use an email belonging to the Vercel team (`git config user.email 14889516+LionSR@users.noreply.github.com`), enforced by `.github/workflows/author-check.yml` (`VERCEL_TEAM_EMAILS`).

`.github/workflows/responses.yml` runs `candidates.py` every Monday and commits candidate response reports to `reports/responses/` for manual verification.

`harvest.json` configures automated harvest jobs; jobs with `"enabled": false` are skipped. To add a new upstream source, implement an adapter class in `sources.py` with `match`, `fetch`, and `harvest`, register it in `SOURCES` and `site/lib/prefixes.json`, and add URL resolution support in `site/lib/resolve.ts` if direct user submission is supported.
