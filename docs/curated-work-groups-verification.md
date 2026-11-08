# Persistent canonical works: isolated verification

2026-11-05. Validated against main `206c692602e98cf3a6537de40c22d40437984243`; unrelated #61 attribution changes remain intact. Schema iteration, upgrade/backfill, role and ingestion tests used isolated PGlite databases; focused real concurrency probes used a disposable local PostgreSQL 17/pgvector container. **No live migration, backfill, SQL/advisor call, PR merge or manual deployment was performed.**

## Automated results

- `python test_index.py`: **65 passed**; `python test_candidates.py`: **4 passed**; `python test_x_candidates.py`: **6 passed**.
- `cd site && npm test`: **336 passed, 0 failed, 0 skipped** against the final implementation. The local source index contains the standard 344-row fixture build plus the two public source snapshots.
- Canonical query/response regressions: **13 passed** in `work-groups.test.ts`. Coverage includes all sorts, complete source filters and exact IDs, counts/pages/cursors, fixed official main, raw titles and independent publication metadata, missing members, URL union/conflicting assertions, source-bound same-person interactions, unrelated similar-title work, hybrid ranking and complete pagination beyond its candidate window, REST/MCP/Markdown contracts and original upstream redirects.
- Migration/data-safety regressions: **9 passed** in `work-migration.test.ts`. They exercise representative pre-migration rows/legacy IDs, exact preservation of raw JSON/content hashes/timestamps/entry versions/history/comments/votes, singleton and unbuilt-source backfill, unchanged-hash import, entries-first/records-only/reserved source arrival, idempotent reconciliation/replays, overlapping local imports, supplied wrong work IDs, source-ID immutability, stale/null CAS rejection, alias/main-member constraints, explicit before/after source-work and target-work audit snapshots (including publication-only changes and no-op replays), false-match prevention and old-schema compatibility.
- New-alias tests assert raw database work/membership/key rows immediately after insertion, before query/display helpers: DOI/Zenodo in both arrival orders, normalized aliases, entry-first/records-only/replay, late proof, absent main, distinct version DOI, conflicts/multiple proofs and non-identity references. Python/TypeScript authoritative adapter tests verify mismatched/missing DOI responses reject and proof survives build.
- `node --experimental-strip-types scripts/check-work-concurrency.ts`: real PostgreSQL 17, two independent backends; the second alias waits on the normalized identity advisory lock in both arrival orders, then one work/two sources exist. Operator-versus-new-alias contention preserves the reviewed target without split membership. The probe starts/removes its own disposable container and never reads `DATABASE_URL`.
- Hostile `ALTER DEFAULT PRIVILEGES` fixtures verify explicit anon/authenticated/service-role revocation. Ingestion can resolve verified aliases but cannot invent a new DOI key on a curated work or bypass review through direct membership/legacy-ID collisions. No new function is SECURITY DEFINER.
- Ambiguous legacy memberships, empty/unreviewed multi-source works and deterministic-ID collisions reject atomically; snapshots confirm no original data is discarded and schema changes roll back.
- `npx tsc --noEmit`, normal Next.js production build and `git diff --check`: passed. OpenAPI tests exercise canonical API 200/400/404/503 responses. No dependency/lockfile change.

The migration file was created using the installed Supabase CLI migration command (v2.101.0). The current changelog, CLI version/help, private-schema RLS and PostgreSQL constraints/function-permission documentation were checked before implementation. No CLI command targeted a remote database.

## Indexed SQL plans

`node --experimental-strip-types scripts/check-work-plans.ts` constructs a fresh isolated database with **5,002 source rows / 5,001 visible canonical works**, analyzes it and runs actual `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, printing compact reproducible index/count/timing summaries. The bulky generated plan dump was removed.

Natural plans use `records_source` for the selective source filter, `records_work` for persisted work ordering, and `work_records_pkey`/`records_pkey` for membership/source hydration. Canonical grouping ranks narrow rows and fetches source JSON only after selecting the work page. On this local run, source-filter page/count took about **0.19/0.04 ms**, broad page/count about **13.44/3.51 ms**. These are local engine measurements, not production latency guarantees. Global work ordering still visits the filtered candidate set; a production-scale staging plan/load check is required before rollout.

## Browser checks

Chromium desktop 1280×900 light and mobile 390×844 dark against the local production build:

- Migrated isolated database: one persisted work, two retained sources, official Lean/GitHub main under newest/oldest/score and alternative-source filters; stable main title/link/canonical URL/JSON-LD identifier; **10 distinct external responses with 6 shared**, all source assertions reachable; original source-bound action IDs and upstream redirects.
- Title/H1/citation/JSON-LD preserve `2^{o(n)}` while raw source titles remain visible. Citation publication date and JSON-LD `datePublished` both use **2026-10-27**, not repository creation **2026-08-06**; publication PDF comes from the paper. Unit regressions also verify omission when that publication source is absent.
- Automatic DOI group with its main materialization removed: durable member count 2, one available source, fixed unavailable-main disclosure, canonical citation/JSON-LD identity and persisted DOI provenance remain visible.
- Canonical API reads the persisted main and publication source; the retained Hexagon work alias resolves to the official work with `requested_work_id`.
- A separately isolated **unmigrated** PGlite fixture: two raw source cards, explicit source-record mode, no inferred group, and canonical-work endpoint 503. Schema readiness changes are also exercised in-process by the upgrade tests.
- No page errors or horizontal overflow. Migrated desktop/mobile search/detail and legacy source-mode screenshots were inspected. External browser requests/widgets were blocked; no write/sign-in action was submitted.

## Independent review and remaining limits

Independent schema/data-safety review audited persisted authority and fresh ingestion/replay, not just UI behavior. Its isolated upgrade tests preserved legacy IDs, source JSON/hashes and archives, and rejected ambiguous legacy data atomically. It independently reran **9/9** migration tests and **15/15** adapter/registry tests plus the Python DOI-proof build test, and confirmed null/stale CAS rejection, exact no-op replay, alias-chain rejection, publication-only history, hostile-default ACLs, ingestion-role guards and complete hybrid pages (**100/100/5** for 205 matching works). Reported findings were corrected and regression-tested.

PGlite serializes execution. The additional PostgreSQL 17 probe covers same-key and operator contention across two real backends, but is not an exhaustive lock/load test. Real transactions may still deadlock and require retry after rereading expectations; constraints/transactions protect integrity rather than deadlock freedom. Production table size, lock duration and query latency remain untested. Review the [migration-before-code rollout and forward recovery contract](curated-work-groups.md) before any separately authorized live change. Until that migration is authorized/applied, a draft preview connected to an old database deliberately remains in raw source-record mode.
