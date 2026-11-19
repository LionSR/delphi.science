-- Two things the pre-release security review asked for.
--
-- 1. An account is a GitHub login, and GitHub lets a login change hands: a person renames or deletes their
--    account and someone else registers the name. Each login is therefore bound to the numeric id of the first
--    GitHub account that signs in with it, and a different account with the same login is refused
--    (lib/accounts/identity.ts). Authorization and attribution still use the login.
create table if not exists open_index.github_accounts (
  login     text primary key check (login = lower(login)), -- lowercase GitHub login
  github_id bigint not null,                               -- GitHub's numeric user id, which a rename keeps
  bound_at  timestamptz not null default now()
);
create index if not exists github_accounts_github_id on open_index.github_accounts (github_id);
alter table open_index.github_accounts enable row level security;

-- 2. Sign-in endpoints that anyone can call are limited by caller (lib/accounts/attempts.ts): one row per attempt,
--    `origin` a SHA-256 of the caller's address, rows older than a day deleted as new ones arrive.
create table if not exists open_index.auth_attempts (
  kind   text not null,
  origin text not null,
  at     timestamptz not null default now()
);
create index if not exists auth_attempts_kind_origin_at on open_index.auth_attempts (kind, origin, at);
create index if not exists auth_attempts_at on open_index.auth_attempts (at);
alter table open_index.auth_attempts enable row level security;
