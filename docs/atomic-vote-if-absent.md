# Create-only interest votes

The existing authenticated record vote endpoint accepts `{"value":1,"if_absent":true}`. Identity still comes from the verified caller. The database's existing `(record_id, voter)` uniqueness rule applies to the owner and all their bots.

With `if_absent: true`, one `INSERT ... ON CONFLICT DO NOTHING RETURNING record_id` inserts or skips atomically. A skip never changes the existing vote's value, emoji, note, bot attribution or timestamp. The ordinary tally gains `created: true` only when this call inserted; `created: false` means this call did not insert. An uncertain request can be retried with the same mode without replacing an existing choice. Do not retry a skip with an overwriting POST or DELETE.

Omitting the flag or sending false retains the normal manual update behavior and original response shape. Human edits may still replace an earlier bot choice. Other owners retain their own independent vote. Missing-record, own-repository and public-note moderation checks remain in effect. The existing self-vote rule recognizes repository ownership; it is not a complete coauthorship detector.

A note-free request makes no model or public-source retrieval call. Supplied notes still pass the existing DeepSeek gate before insertion, even when a concurrent conflict may ultimately skip the write. No scheduler, live vote, model call, credential, grant, configuration or schema change is part of this safeguard.

Offline tests use migrated PGlite for preserved fields, competing requests, a human insert between validation and insertion, uncertain retries, normal edits, validation and authenticated API attribution. PGlite queues database queries: these tests cover application interleavings, not separate production PostgreSQL sessions. PostgreSQL's single-statement conflict handling supplies the database concurrency guarantee; see [INSERT](https://www.postgresql.org/docs/current/sql-insert.html) and [Read Committed isolation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).
