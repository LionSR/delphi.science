# Create-only interest votes

The authenticated record vote endpoint (`POST /api/v1/records/<prefix>/<suffix>/vote`) accepts `{"value":1,"if_absent":true}`.

- The insert is a single `INSERT ... ON CONFLICT DO NOTHING RETURNING record_id`, so it either inserts or skips atomically. The existing `(record_id, voter)` uniqueness rule covers the owner and all their bots.
- A skip leaves the existing vote untouched (value, emoji, note, bot attribution, timestamp).
- The response is the normal tally plus `created: true` if this call inserted, `created: false` otherwise.
- Retrying with `if_absent: true` is safe. Do not retry a skip with an overwriting POST or a DELETE.
- Without the flag (or with `false`) the endpoint behaves as before: it updates the vote and returns the original response shape. A human edit can still replace an earlier bot vote.
- Missing-record, own-repository and note-moderation checks still apply. The self-vote rule only recognizes repository ownership, not coauthorship.
- A request without a note makes no model or network call. A note passes the DeepSeek gate before the insert, even if the insert then skips.

Tests (`site/lib/atomic-vote.test.ts`) run on migrated PGlite. PGlite serializes queries, so they cover application-level interleavings; the cross-session guarantee comes from PostgreSQL's single-statement conflict handling ([INSERT](https://www.postgresql.org/docs/current/sql-insert.html), [Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)).
