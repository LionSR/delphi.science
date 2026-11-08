# Persisted canonical works and source records

The database owns work identity. This change extends the existing private `open_index.works` and `open_index.work_records` tables; it does not maintain a second work model or a TypeScript identity list. Original source IDs, JSON, URLs, entry versions, comment/review threads, votes, mentions and ownership remain source-bound.

## Model and invariants

- `works` stores the canonical ID, title, fixed `main_record_id`, independent `publication_record_id`, reviewed evidence and reviewer. A retained old work ID can instead be an empty alias via `redirect_work_id`.
- `work_records` is the durable source-ID/membership registry: one `record_id` belongs to exactly one work, with role, date meaning and reviewed evidence. It includes reviewed reservations for sources not currently materialized. The old FK to the disposable `records` materialization is replaced, without deleting its rows, so a rebuild/removal cannot silently erase membership.
- `entries.work_id` and `records.work_id` are non-null persisted references. Deferred composite FKs bind `(work_id,id)` to the registry. Main and publication IDs must belong to their work. Aliases cannot own members, point to another alias, self-reference or form cycles.
- Before raw inserts/refreshes/upserts, one SQL resolver chooses the persisted work from membership and accepted exact identifiers before creating any singleton. Caller-supplied `work_id` cannot overwrite membership. Source IDs are immutable. Automatic main-source titles may track source metadata; existing legacy titles and reviewed titles are preserved.
- `store.py`, harvest/refresh, site submission, build/import and `load.ts` all reach these database triggers. Build JSON remains raw source metadata; importing it does not replace reviewed relationships. `load.ts` strips API work projections before hashing/storing source JSON. Reloading unchanged hashes cannot detach a source.
- `work_identifiers` maps each accepted normalized DOI to exactly one work, with original source/proof. A new source with that DOI joins the work immediately, without creating a second singleton. A source with no accepted key creates a singleton. Known reviewed source reservations also bind before insertion. Unknown similar titles/URLs do not imply identity.

Existing legacy memberships are inspected before changes: multiple works for one source, unreviewed multi-source works, orphan works, or deterministic singleton-ID collisions block the migration atomically for operator review. Existing arbitrary singleton work IDs are retained. An already-associated exact Anthropic pair is supported because its main choice and evidence are explicit. No legacy association is discarded to satisfy a uniqueness constraint.

## Ingestion identity resolution

The Python harvester and TypeScript submit adapter emit `identity` only for an authoritative self DOI: doi.org CSL content negotiation must return the requested DOI (case-insensitive exact comparison), or the Zenodo record API must return its own specific `10.5281/zenodo.<record-id>` DOI. They retain the original `doi` separately. `index.py`/`itemOf` preserve the proof through records-only build/import. DOI normalization trims whitespace, recognizes DOI/resolver prefixes and folds case; it preserves suffix punctuation and versions. See the [DOI handbook](https://www.doi.org/doi-handbook/HTML/doi-name-syntax2.html) and [Zenodo version DOI documentation](https://support.zenodo.org/help/en-gb/1-upload-deposit/97-what-is-doi-versioning).

`resolve_work_source` is the only ingestion identity path for entries, records and idempotent backfill. It validates proof/source agreement, locks the normalized DOI then source ID, and rereads membership/key ownership. An existing key binds a new alias before creating any work; otherwise it creates a self-singleton and claims the key atomically. Unique DOI/source constraints and deferred FKs enforce one identity; a canonical-work row lock serializes reviewed association with new aliases. The first source remains main until explicit review; the Anthropic group's reviewed official main is fixed independently.

Existing source membership cannot be overwritten by refresh. Late verified proof may claim an unclaimed DOI for that work and is retained in membership; a key already owned by another work rejects the entire import for review. Accepted source proof and the key's first assertion are retained even when later raw metadata omits them. Available source API snapshots expose persisted `identity`, independently of raw metadata. An owner-reviewed singleton association moves its keys with it and retains the old work alias and audit history.

**Deliberate boundary:** one authoritative self DOI per source is supported. Multiple/invalid proofs reject instead of bridging works. Arbitrary DOI fields, references, concept DOIs, repository roots, `formalizes`/`adapts` links, title similarity and unverified webpage claims cannot auto-merge. arXiv/preprint-to-journal equivalence and other identifier namespaces require reviewed association or a future verified adapter; this is not universal automatic deduplication. If pre-existing accepted metadata conflicts with retained legacy membership, migration/backfill fails atomically for operator review. No cross-work merge is inferred to repair it. The database trusts the restricted source importer to have fetched the authoritative response; it does not perform network verification, and public submitters cannot supply these proofs directly.

## Reviewed initial data

The migration seeds one verified relationship as database data:

- Main: `lean/anthropics__formal-math__eth`, the official Anthropic paper/Lean repository. Source date **2026-08-06** means repository creation, not this paper's publication.
- Alternative: `hexagon/2610.00577`, the paper. Publication source date **2026-10-27**.

The [official README](https://github.com/anthropics/formal-math/blob/main/eth/README.md) names the paper and Lean formalization; the [Hexagon paper](https://hexagonmath.org/2610.00577v1) matches its title/contribution. The persisted work title, `A 2^{o(n)} Time Algorithm for 3-SAT`, preserves the exponent lost by the README parser. Original source titles remain inspectable. The distinct OpenAI ETH result is not associated. Work identity establishes neither byte-identical artifacts nor machine verification.

Canonical main and publication source are independent. Citation title/link/identifier follow the official main and evidence-backed work title; publication date/PDF come from the paper source. If that source is unavailable, those publication fields are omitted, never replaced with repository creation. If main materialization is absent, its main ID remains fixed, the UI labels it unavailable, and available-source links remain usable.

## SQL query and API contract

The complete query is evaluated against individual source rows first: a conjunction must match one row, and `source:hexagon is:formalized` cannot borrow Lean's assertion. Exact IDs, source filters, `NOT`/`OR`, source date ranges and text searches retain this meaning.

SQL then chooses one best-ranked matching row per persisted `work_id` with `DISTINCT ON`, before global order, limit and offset. The total is `count(DISTINCT work_id)` over the same source filter. No page is fetched then deduplicated, and no runtime catalog preflight chooses membership. Indexed source/member lookups hydrate the persisted main and available sources afterward. `member_count` counts durable memberships, so an automatic group still discloses its fixed main when that raw record is temporarily unavailable. API roots retain the selected source view and source-bound counters; `work_id`, `work.main_record_id` and `work.view_record_id` make the distinction explicit.

Ranking uses the best individual matching source, not a sum of votes, reactions, mentions or shared responses. Source-date filters/order use original source dates; work publication metadata is a separate field. Hybrid ranking retains 200 keyword and 200 vector candidates for reciprocal-rank fusion, then appends other matching works with zero fusion points in deterministic source publication/ID order. Thus counts and later pages cover all matches, including beyond the ranking window. Source inventory badges still count source records. Cursor totals retain the existing live-read/cached-total contract, not snapshot isolation; concurrent operator changes can require retry.

`GET /api/v1/works?id=<work_id>` reads the canonical work, available sources and provenance; retained aliases resolve to the canonical work and include `requested_work_id`. Both original source GETs and `/id/` upstream redirects remain intact. REST and MCP full records expose persisted work data; compact results omit the response union payload. Singleton work identity is persisted too, while ordinary singleton cards keep their existing compact presentation.

## Reviewed association path and permissions

A future association uses owner-only `open_index.associate_work_source`, with explicit main/source IDs, expected current source work, reviewer, nonempty evidence, title, source role/date meaning and publication source. It uses deterministic work locks and compare-and-swap membership checks, permits attaching only an uncurated singleton, and rejects implicit group merges or alternative-to-main promotion. Exact no-op replays are allowed; stale edits are rejected. Old singleton work rows become aliases instead of being deleted. Work/membership changes, including publication-only changes, are recorded in `work_membership_history`. Its full-row snapshots are explicit: `previous_source_work.id` matches `previous_work_id`, `previous_target_work` is the target before association, `source_work` preserves the source work after it becomes an alias (or the same canonical work), and `target_work.id` matches `work_id`. Review timestamps are retained. When only publication metadata changes within one work, source/target snapshots agree on each side of that change. Exact no-op replays do not add timestamp-only events; available affected records receive a changes-feed event. Raw source archives and hashes are untouched.

Example for a separately authorized, isolated review database (parameters must be reviewed, not inferred):

```sql
BEGIN;
SELECT open_index.associate_work_source(
  'example/main', 'example/paper', 'example/paper',
  'reviewer-login', '["https://example.org/primary-evidence"]',
  'Reviewed work title', 'Paper', 'Paper publication', 'example/paper'
);
COMMIT;
```

There is no public association/write API. All functions are `SECURITY INVOKER` with empty `search_path`. Explicit revocations neutralize PUBLIC and role-specific default grants. The ingestion service receives only required resolver/table privileges and first-proof updates. Guards prohibit arbitrary cross-source membership or fabricating a new key against another work; a new key must belong to its existing source work or fresh self-singleton, and a new alias must match an existing accepted key. Legacy-ID collisions cannot bypass these checks. The operator function and private audit history remain owner-only. Existing private-schema RLS stays enabled with no public policies. FK lookup columns are indexed. The application database role remains trusted; this is not a new end-user SQL interface.

Real concurrent transactions can deadlock with ingestion's row locks; callers must retry SQLSTATE `40P01`/`40001` in a new transaction after rereading expectations. Deferred FKs and atomic transactions protect integrity, not deadlock freedom. PGlite serializes execution; a separate disposable PostgreSQL 17 probe verifies two-backend same-key contention in both arrival orders and operator-versus-alias contention. This is focused coverage, not a production lock/load guarantee.

## Rollout and recovery

This draft does **not** apply a migration/backfill to any live database, merge or deploy. The migration is `20261105095935_persistent_canonical_works.sql`, created with the installed Supabase CLI's migration command and tested only in isolated PGlite databases and a disposable local PostgreSQL 17 container.

An operator must separately authorize a backup, preflight existing associations, schedule the migration's table-lock window, and apply it atomically **before** enabling canonical runtime behavior. Large live-table migration duration/locks need staging validation. The app detects schema readiness without applying DDL: before migration it continues serving raw source records with `work_model: source_records`; canonical-work GET returns explicit 503. After migration it reads persisted relationships with `work_model: canonical`. Draft previews connected to an unmigrated production database therefore do not pretend the migration/grouping exists. Local tests/previews use migrated isolated data.

After a rollout problem, roll code back while retaining additive schema and data. Do not drop work tables/columns, restore the old cascading membership FK, delete aliases, or rewrite source IDs. Correct a reviewed relationship through an explicitly reviewed forward transaction with expected-state checks and preserved audit; the attach function deliberately does not offer arbitrary group splitting/merging. A failed ambiguous-data preflight leaves the original database untouched. Existing source-record deletion still has its prior interaction cascades; this feature never deletes records and does not claim to change that unrelated behavior.

See [verification](curated-work-groups-verification.md) for local test coverage, query plans and remaining production limits.

The refactor removes the prior TypeScript identity list and excluded/only query preflight branches. Query/display code only consumes SQL-owned relationships. Full generated plan dumps are omitted; the small plan probe prints reproducible index/count/timing summaries.
