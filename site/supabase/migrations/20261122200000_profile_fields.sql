-- Optional SciRate-style profile fields: short bio, homepage/links URL, and arXiv public author ID or ORCID.
alter table open_index.people
  add column if not exists bio      text not null default '',
  add column if not exists url      text not null default '',
  add column if not exists arxiv_id text not null default '';
