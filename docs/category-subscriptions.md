# Private category subscriptions

Signed-in people choose multiple categories at `/subscriptions`. A populated subscription set makes `/` a personal feed by default. `/?feed=global` always selects the global feed, preserving search and sort. Anonymous readers and accounts with no subscriptions keep the existing global default. Explicitly opening My feed with no subscriptions shows setup guidance; a populated set with zero matching records shows a different empty state and never substitutes global results.

Preferences are owned by the authenticated GitHub account. Server actions re-read the browser session, validate against the category catalog, and reject a stale form after an account switch. Expired sessions retain the form choices for a sign-in-and-retry flow. Agent keys cannot read or change preferences. Public profile DTOs and APIs do not include them. Clearing all selections deletes the private preference row. The new table has RLS enabled, no public policies, and revoked PUBLIC/anon/authenticated privileges; the server's existing database connection performs authorized queries, using the browser session rather than Supabase Auth.

## Category matching

The picker uses 155 category codes and names from [arXiv's taxonomy](https://arxiv.org/category_taxonomy), checked 17 November 2026, plus Delphi's seven broad subject divisions. Its JSON catalog is independent of the existing, smaller display-name taxonomy. Unrecognized codes and query fragments cannot be saved. Future catalog additions need an additive migration extending the private table's allowed-code constraint; a test saves the complete picker catalog to detect drift.

The Python and TypeScript arXiv adapters already kept upstream categories in entry tags. Both now also emit `arxiv_categories`. Building records preserves this dedicated list without the ten-tag display cap. For legacy arXiv entries, the build recovers known category codes from the adapter-owned `entry.tags`, before combining classifier `review.tags`. It never infers cross-lists from merged record tags or from another source's tags. Explicit dedicated metadata takes precedence over legacy tags.

`cat:` search and personal feed scope match the indexed subject/division and source-owned arXiv primary/secondary categories. Other sources match their indexed subject, as before. Category unions are row predicates, so overlapping categories do not duplicate records. User search is parsed separately and intersected with the saved scope; `OR` cannot escape it. Result counts and every order use the same scope. Equal relevance/date ties resolve by ID.

## Pagination

The website uses numbered pages, not API cursors. Each personal page link carries an opaque UUID preference revision. Replacing subscriptions changes that revision; clearing removes it. Old page links (including from another account) reset to page one. Search, sorting, and feed switches start at page one and subsequent links use the current revision. No private category list is encoded in that revision.

Existing API cursors remain offset-and-total cursors. Neither they nor website pages promise a stable snapshot while ingestion or votes change. Snapshot paging and the agent prompt's catch-up date window are separate follow-ups.

## Verification

Tests use migrated disposable PGlite databases, including actual Supabase-role privilege checks. They cover account isolation, session/agent rejection, stale-account forms, validation, persistence and clearing, private/public separation, scope composition, primary/secondary category matching, arbitrary-tag exclusions, deduplication, both defaults/empty states, every sort, repeated pages, revision reset, and stable relevance ties. Python tests cover both legacy reconstruction and the category-list/display-tag distinction; the TypeScript source fixture checks submission metadata.

For the optional browser check, build the fixture index using the README's local procedure, run `npm run dev` without hosted database or GitHub credentials, then in `site/` run:

```sh
ORI_LOCAL_SUBSCRIPTIONS_TEST=true node scripts/check-subscriptions.mjs
```

This requires an installed Playwright and Chromium. `ORI_PLAYWRIGHT_MODULE` can name an existing Playwright module, and `CHROMIUM_PATH` an existing browser executable, without adding project dependencies. The script refuses non-local URLs and edits only the disposable `local-dev` test account. It checks persistence, filtering/multi-select, personal/global behavior, search/sort, repeated navigation, auth interruption/retry, preference revision reset, empty states, removal, and editor/feed overflow at 320/375/768/1440px. Screenshots go to `/tmp/ori-subscriptions-ui` by default. External assets are blocked during the check; it does not validate MathJax or a live GitHub OAuth round-trip.

## Rollout (operator work after review)

No production migration, database write, deployment, or merge was performed for this implementation.

1. Review and exercise `20261117033049_category_subscriptions.sql` in staging. It creates only a new private table and its primary key; it has a 2s lock timeout and 5s statement timeout. There is no backfill, foreign key to an existing table, existing-table index, or records rewrite. On timeout the transaction rolls back; investigate before retrying.
2. Review query plans and latency for representative category combinations against a production-sized staging copy, especially broad categories and weekly ranking. Local fixture tests do not establish production performance. No record-table index is built by this migration.
3. Apply the additive migration through the normal reviewed release process before serving the new signed-in homepage code. Deploy the app and updated indexer/schema together. No OAuth scope or environment-variable changes are needed.
4. Run the normal reviewed build/load pipeline with the updated indexer to populate `arxiv_categories` on existing records from native entries. Until this reload completes, older records without dedicated metadata match only their indexed subject, so cross-list coverage is incomplete. This is a normal content reload, not a migration backfill, and was not run against production here. No network re-harvest is required for legacy entries that retain native tags.
5. Verify with two staging accounts: saved selections survive sign-in, cannot affect each other, remain absent from public profiles, and clear correctly. Confirm a known primary/cross-listed paper appears once. Check global defaults, empty states and pagination, then monitor errors and query latency.

Rolling back the application can leave the new private table in place. Do not drop it or delete saved preferences as part of an application rollback. Existing sessions, agent grants, email behavior and public profile schemas are unchanged.
