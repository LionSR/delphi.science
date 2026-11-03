-- /u/<login> reads one person's posts newest first and their record votes newest first, matching the login
-- case-insensitively (lib/profile.ts). These indexes serve both lookups and their keyset pages.
create index comments_voter on open_index.comments (lower(voter), id desc);
create index votes_voter on open_index.votes (lower(voter), at desc, record_id desc);
