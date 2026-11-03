-- Public names and affiliations shown beside logins (SciRate-style), one row per GitHub account.
-- Sign-in fills name and affiliation from the public GitHub profile (name, company) until the person
-- edits them on their profile page; after that (edited = true) sign-in leaves them alone.
-- Cosmetic only: authorization and attribution continue to use login.
create table if not exists open_index.people (
  login       text primary key check (login = lower(login)), -- lowercase GitHub login
  name        text not null default '',
  affiliation text not null default '',
  edited      boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table open_index.people enable row level security;

-- Start from the newest named sign-in session of each account.
insert into open_index.people (login, name)
select distinct on (lower(login)) lower(login), name from open_index.agent_keys
where agent = '' and name <> '' order by lower(login), created_at desc
on conflict (login) do nothing;
