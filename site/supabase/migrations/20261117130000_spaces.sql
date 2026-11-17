-- Spaces: a place for discussion with a member list. A private space with one member is a person's notebook
-- with their own agents; with two it is a direct conversation; with more, a group. The forum is the one public
-- space. A space holds topics, and topics hold posts (open_index.comments), as the forum always has.
--
-- Additive: existing topics get space_id 'forum' by default, so no row moves. Applies after
-- 20261117130000_events.sql (the file names sort that way), whose sequence and ordering lock it uses.
--
-- Permissions are three rules (site/lib/posts/spaces.ts): an agent is its owner; a space is public (anyone
-- reads, the signed-in write) or private (accepted members read and write); members are equal, except that the
-- creator can remove a member and delete the space.
create table if not exists open_index.spaces (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,47}$'),  -- the slug in ws/<slug>
  title      text not null check (char_length(title) between 1 and 200),
  about      text not null default '' check (char_length(about) <= 4000),
  creator    text not null,                                              -- GitHub login, '' for the forum
  agent      text not null default '',
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  at         timestamptz not null default now()
);
insert into open_index.spaces (id, title, creator, visibility) values ('forum', 'Forum', '', 'public')
  on conflict (id) do nothing;

-- Who is in a space. A row without accepted_at is an invitation. Logins are stored in lower case (GitHub
-- logins ignore case). invited_seq and accepted_seq are drawn from the log's own sequence (open_index.events),
-- so an invitation and its acceptance each take a place in the log (site/lib/posts/log.ts) among the records
-- and posts, and a reader's since covers them too.
create table if not exists open_index.space_members (
  space_id     text not null references open_index.spaces (id) on delete cascade,
  login        text not null check (login = lower(login)),
  invited_by   text not null,                                            -- GitHub login as it signs posts
  agent        text not null default '',                                 -- the inviter's agent, if one invited
  note         text not null default '' check (char_length(note) <= 200),
  at           timestamptz not null default now(),
  accepted_at  timestamptz,
  invited_seq  bigint not null,                                          -- set by the trigger below
  accepted_seq bigint,
  primary key (space_id, login)
);
create index if not exists space_members_login on open_index.space_members (login);

-- Like every writer of the log, it takes the ordering lock before a seq, so seqs commit in order.
create or replace function open_index.log_member_event() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform open_index.event_order();
    new.invited_seq := nextval('open_index.events_seq_seq');
  elsif new.accepted_at is not null and old.accepted_at is null then
    perform open_index.event_order();
    new.accepted_seq := nextval('open_index.events_seq_seq');
  end if;
  return new;
end $$;
drop trigger if exists space_members_event on open_index.space_members;
create trigger space_members_event before insert or update on open_index.space_members
  for each row execute function open_index.log_member_event();

alter table open_index.topics
  add column if not exists space_id text not null default 'forum' references open_index.spaces (id) on delete cascade;
create index if not exists topics_space on open_index.topics (space_id, last_at desc, id desc);

-- THE visibility rule, and the only one: a space can be read by `login` (null for nobody signed in) when it
-- is public, or when that login is an accepted member. Every read and write of a topic or its posts goes
-- through it. Posts on records belong to no space and are public.
create or replace function open_index.can_read(space text, reader text) returns boolean language sql stable as $$
  select exists (select 1 from open_index.spaces s where s.id = $1 and (s.visibility = 'public'
    or exists (select 1 from open_index.space_members m
               where m.space_id = s.id and m.login = lower($2) and m.accepted_at is not null)))
$$;
alter function open_index.can_read(text, text) set search_path = '';

alter table open_index.spaces        enable row level security;
alter table open_index.space_members enable row level security;
