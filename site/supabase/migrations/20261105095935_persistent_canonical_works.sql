-- Extend the existing private works/work_records model. Apply atomically, migration before code.
-- No source ID, source JSON, interaction, or archived source version is rewritten/deleted.
lock table open_index.works, open_index.work_records, open_index.entries, open_index.records in share row exclusive mode;
do $$ begin
  if exists (select 1 from open_index.work_records group by record_id having count(*) > 1) then
    raise exception 'Canonical work migration blocked: a legacy source belongs to multiple works; operator review required';
  end if;
  if exists (select 1 from open_index.works w left join open_index.work_records m on m.work_id=w.id
    group by w.id having count(m.record_id) <> 1 and
      coalesce(array_agg(m.record_id order by m.record_id), array[]::text[]) <>
      array['hexagon/2610.00577','lean/anthropics__formal-math__eth']::text[]) then
    raise exception 'Canonical work migration blocked: empty or ambiguous legacy work needs an explicit reviewed main';
  end if;
end $$;

alter table open_index.works
  add column main_record_id text,
  add column publication_record_id text,
  add column redirect_work_id text references open_index.works(id),
  add column curated boolean not null default false,
  add column auto_title boolean not null default false,
  add column evidence jsonb not null default '[]' check (jsonb_typeof(evidence)='array'),
  add column reviewed_by text,
  add column reviewed_at timestamptz;
alter table open_index.work_records
  add column role text not null default 'Source',
  add column date_meaning text not null default 'Source date',
  add column evidence jsonb not null default '[]' check (jsonb_typeof(evidence)='array'),
  add column reviewed_by text,
  add column identity jsonb,
  add constraint work_records_one_work unique(record_id);
-- Membership is a durable identity registry, including reviewed sources not materialized yet.
-- Replace only the FK; retaining its old cascade would erase canonical identity on rebuild/removal.
alter table open_index.work_records drop constraint work_records_record_id_fkey;
update open_index.works w set
  main_record_id=(select case when count(*)=2 then 'lean/anthropics__formal-math__eth' else min(record_id) end from open_index.work_records m where m.work_id=w.id),
  publication_record_id=(select case when count(*)=2 then 'hexagon/2610.00577' else min(record_id) end from open_index.work_records m where m.work_id=w.id);
alter table open_index.works
  add constraint works_root_or_alias check ((main_record_id is not null and redirect_work_id is null) or
    (main_record_id is null and publication_record_id is null and redirect_work_id is not null and redirect_work_id<>id)),
  add constraint works_main_member foreign key(id,main_record_id) references open_index.work_records(work_id,record_id) deferrable initially deferred,
  add constraint works_publication_member foreign key(id,publication_record_id) references open_index.work_records(work_id,record_id) deferrable initially deferred;
create index works_main_record on open_index.works(main_record_id);
create index works_publication_record on open_index.works(publication_record_id);
create index works_redirect on open_index.works(redirect_work_id);
alter table open_index.entries add column work_id text;
alter table open_index.records add column work_id text;
create index entries_work on open_index.entries(work_id,id);
create index records_work on open_index.records(work_id,published desc nulls last,id);

create table open_index.work_membership_history (
  seq bigserial primary key,
  record_id text not null,
  previous_work_id text not null references open_index.works(id),
  work_id text not null references open_index.works(id),
  -- Each ID names an explicit side of the association, before/after (including review timestamps).
  previous_source_work jsonb not null,
  previous_target_work jsonb not null,
  source_work jsonb not null,
  target_work jsonb not null,
  previous_membership jsonb not null,
  membership jsonb not null,
  reviewed_by text not null,
  evidence jsonb not null,
  at timestamptz not null default now()
);
create index work_membership_history_record on open_index.work_membership_history(record_id,seq);
create index work_membership_history_previous on open_index.work_membership_history(previous_work_id);
create index work_membership_history_work on open_index.work_membership_history(work_id);
alter table open_index.work_membership_history enable row level security;
revoke all on open_index.work_membership_history from public;
revoke all on sequence open_index.work_membership_history_seq_seq from public;

-- Accepted exact identity keys are private ingestion state, never derived from titles/links.
-- One key per source is deliberately supported: a DOI verified by an authoritative adapter.
create table open_index.work_identifiers (
  doi text primary key,
  work_id text not null references open_index.works(id),
  record_id text not null,
  evidence jsonb not null,
  foreign key(work_id,record_id) references open_index.work_records(work_id,record_id) deferrable initially deferred
);
create index work_identifiers_member on open_index.work_identifiers(work_id,record_id);
create index work_identifiers_record on open_index.work_identifiers(record_id);
alter table open_index.work_identifiers enable row level security;

create function open_index.normalized_doi(value text) returns text
language sql immutable strict security invoker set search_path='' as $$
  select lower(regexp_replace(btrim(value),'^(https?://(dx\.)?doi\.org/|doi:)[[:space:]]*','','i'))
$$;

-- The source adapters emit this proof only after checking the returned authoritative identifier.
-- Arbitrary DOI fields, cited DOIs, concept DOIs and formalizes/adapts links are not accepted.
create function open_index.source_doi(p_id text, proof jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare doi text; begin
  if proof is null or proof='null'::jsonb then return null; end if;
  doi:=open_index.normalized_doi(proof->>'value');
  if jsonb_typeof(proof)<>'object' or proof->>'scheme' is distinct from 'doi' or
    doi is null or doi !~ '^10\.[0-9]{4,9}/[^[:space:]]+$' then raise exception 'Invalid verified source identifier'; end if;
  if (proof->>'verified_by'='doi-csl' and p_id like 'doi/%' and
      doi=open_index.normalized_doi(replace(substr(p_id,5),'__','/')) and
      proof->>'evidence'='https://doi.org/'||doi) or
     (proof->>'verified_by'='zenodo-record' and p_id ~ '^zenodo/[0-9]+$' and
      doi='10.5281/zenodo.'||substr(p_id,8) and
      proof->>'evidence'='https://zenodo.org/api/records/'||substr(p_id,8)) then return doi; end if;
  raise exception 'Unverified or conflicting source identifier; operator review required';
end $$;

-- Ingestion can associate only a verified key already bound to the target work.
-- Reviewed associations remain owner-only; membership cannot be changed by an importer.
create function open_index.guard_work_membership() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='work_identifiers' then
    if new.doi is distinct from open_index.source_doi(new.record_id,new.evidence) then raise exception 'Invalid identifier provenance'; end if;
    if current_user<>pg_get_userbyid((select relowner from pg_class where oid='open_index.works'::regclass)) and not (
      exists(select 1 from open_index.work_identifiers k where k.doi=new.doi and k.work_id=new.work_id) or
      exists(select 1 from open_index.work_records m where m.record_id=new.record_id and m.work_id=new.work_id) or
      exists(select 1 from open_index.works w where w.id=new.work_id and w.id=new.record_id and w.main_record_id=new.record_id and w.redirect_work_id is null and not w.curated and w.auto_title)
    ) then raise exception 'Only the work owner may assign a new identifier to another work'; end if;
    return new;
  end if;
  if new.record_id !~ '^[a-z0-9-]+/.+' then raise exception 'Invalid source identity'; end if;
  if current_user<>pg_get_userbyid((select relowner from pg_class where oid='open_index.works'::regclass)) and
    ((tg_op='UPDATE' and (new.record_id is distinct from old.record_id or new.work_id is distinct from old.work_id or
      (old.identity is not null and new.identity is distinct from old.identity))) or not (
      (new.work_id=new.record_id and exists(select 1 from open_index.works where id=new.work_id and main_record_id=new.record_id and redirect_work_id is null and not curated)) or
      exists(select 1 from open_index.work_identifiers where doi=open_index.source_doi(new.record_id,new.identity) and work_id=new.work_id)
    )) then raise exception 'Only the work owner or a verified identifier may associate source identities'; end if;
  return new;
end $$;
create trigger work_identifier_guard before insert or update on open_index.work_identifiers
  for each row execute function open_index.guard_work_membership();
create trigger work_membership_guard before insert or update on open_index.work_records
  for each row execute function open_index.guard_work_membership();

-- Single ingestion identity path for entries, records, rebuilds and backfills.
-- place_work_source chooses or creates the work, and its caller must keep other writers of the source out.
-- resolve_work_source does this by locking the normalized identity, then the source, so different aliases
-- arriving at once cannot create disconnected canonical works. The backfill holds table locks instead:
-- advisory locks last until commit, and one per source would overflow the shared lock table.
create function open_index.place_work_source(p_id text, p_title text, proof jsonb default null) returns text
language plpgsql security invoker set search_path='' as $$
declare wid text; keyed text; v_doi text; prior jsonb;
begin
  if p_id is null or p_id !~ '^[a-z0-9-]+/.+' then raise exception 'Invalid source identity'; end if;
  v_doi:=open_index.source_doi(p_id,proof);
  select work_id,identity into wid,prior from open_index.work_records where record_id=p_id;
  if v_doi is not null and ((prior is not null and open_index.source_doi(p_id,prior)<>v_doi) or
    exists(select 1 from open_index.work_identifiers k where k.record_id=p_id and k.doi<>v_doi)) then
    raise exception 'Source identifier changed; operator review required';
  end if;
  if v_doi is not null then select work_id into keyed from open_index.work_identifiers where work_identifiers.doi=v_doi; end if;
  if wid is not null and keyed is not null and wid<>keyed then
    raise exception 'Source identifier conflicts with existing membership; operator review required';
  end if;
  if wid is null then
    wid:=coalesce(keyed,p_id);
    if keyed is null then
      if exists(select 1 from open_index.works where id=p_id) then
        raise exception 'Singleton work ID collision for %; operator review required',p_id;
      end if;
      insert into open_index.works(id,title,main_record_id,publication_record_id,auto_title)
        values(wid,coalesce(nullif(p_title,''),p_id),p_id,p_id,true);
    end if;
    perform 1 from open_index.works where id=wid for update;
    if not exists(select 1 from open_index.works where id=wid and redirect_work_id is null) then
      raise exception 'Canonical work changed during ingestion; retry transaction';
    end if;
    -- Register proof before membership so its guard can verify a non-singleton insertion.
    if v_doi is not null then
      insert into open_index.work_identifiers values(v_doi,wid,p_id,proof) on conflict(doi) do nothing;
    end if;
    insert into open_index.work_records(work_id,record_id,relation,identity)
      values(wid,p_id,case when keyed is null then 'source' else 'alternative' end,proof);
  elsif v_doi is not null then
    insert into open_index.work_identifiers values(v_doi,wid,p_id,proof) on conflict(doi) do nothing;
    update open_index.work_records set identity=proof where record_id=p_id and identity is null;
    -- Preserve original accepted provenance on refresh. New proof for an existing source is retained
    -- in raw entry/record history; the key's first verified assertion remains immutable.
  end if;
  return wid;
end $$;

create function open_index.resolve_work_source(p_id text, p_title text, proof jsonb default null) returns text
language plpgsql security invoker set search_path='' as $$
declare v_doi text;
begin
  if p_id is null or p_id !~ '^[a-z0-9-]+/.+' then raise exception 'Invalid source identity'; end if;
  v_doi:=open_index.source_doi(p_id,proof);
  if v_doi is not null then perform pg_advisory_xact_lock(hashtextextended('work-doi:'||v_doi,0)); end if;
  perform pg_advisory_xact_lock(hashtextextended('work-source:'||p_id,0));
  return open_index.place_work_source(p_id,p_title,proof);
end $$;

create function open_index.bind_work_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare title_text text; proof jsonb;
begin
  if tg_op='UPDATE' and new.id is distinct from old.id then raise exception 'Source IDs are immutable'; end if;
  if tg_table_name='entries' then title_text:=new.entry->>'title'; proof:=new.entry->'identity';
  else title_text:=new.record->>'title'; proof:=new.record->'identity'; end if;
  new.work_id:=open_index.resolve_work_source(new.id,title_text,proof);
  -- Source refreshes update only automatic singleton titles, never reviewed work metadata.
  update open_index.works set title=coalesce(nullif(title_text,''),title)
    where id=new.work_id and auto_title and not curated and main_record_id=new.id;
  return new;
end $$;

-- Check constraints cannot express cross-table alias/root rules; defer until an atomic attach commits.
create function open_index.check_work_graph() returns trigger
language plpgsql security invoker set search_path='' as $$
declare wid text; ids text[]; w open_index.works;
begin
  if tg_table_name='works' then ids:=array[new.id]; else ids:=array[new.work_id];
    if tg_op='UPDATE' then ids:=ids||old.work_id; end if; end if;
  for wid in select distinct v from unnest(ids) v where v is not null
  loop
    select * into w from open_index.works where id=wid;
    if w.redirect_work_id is not null and
      (exists(select 1 from open_index.works where redirect_work_id=wid) or
       exists(select 1 from open_index.work_records where work_id=wid) or
       not exists(select 1 from open_index.works where id=w.redirect_work_id and redirect_work_id is null)) then
      raise exception 'Work aliases must be empty and redirect directly to a canonical work';
    end if;
  end loop;
  return null;
end $$;
create constraint trigger works_graph after insert or update on open_index.works deferrable initially deferred
  for each row execute function open_index.check_work_graph();
create constraint trigger work_records_graph after insert or update on open_index.work_records deferrable initially deferred
  for each row execute function open_index.check_work_graph();

-- Idempotent reconciliation for existing entries/records; never changes reviewed membership.
create function open_index.backfill_work_sources() returns void
language plpgsql security invoker set search_path='' as $$
declare src record; begin
  lock table open_index.works, open_index.work_records, open_index.entries, open_index.records in share row exclusive mode;
  for src in select id,payload from (
    select id,entry payload from open_index.entries union all select id,record payload from open_index.records
  ) s order by id,(coalesce(payload->'identity','null'::jsonb)<>'null'::jsonb) desc
  loop perform open_index.place_work_source(src.id,src.payload->>'title',src.payload->'identity'); end loop;
  update open_index.entries e set work_id=m.work_id from open_index.work_records m where m.record_id=e.id and e.work_id is distinct from m.work_id;
  update open_index.records r set work_id=m.work_id from open_index.work_records m where m.record_id=r.id and r.work_id is distinct from m.work_id;
end $$;
select open_index.backfill_work_sources();
alter table open_index.entries alter column work_id set not null;
alter table open_index.records alter column work_id set not null;
alter table open_index.entries add constraint entries_work_member foreign key(work_id,id)
  references open_index.work_records(work_id,record_id) deferrable initially deferred;
alter table open_index.records add constraint records_work_member foreign key(work_id,id)
  references open_index.work_records(work_id,record_id) deferrable initially deferred;
-- Bound after the backfill, whose updates would otherwise resolve every source again under its own locks.
create trigger entries_bind_work before insert or update of id,work_id,entry on open_index.entries
  for each row execute function open_index.bind_work_source();
create trigger records_bind_work before insert or update of id,work_id,record on open_index.records
  for each row execute function open_index.bind_work_source();

-- Owner-only reviewed association path. No public RPC or ingestion-provided membership overrides.
-- A caller supplies its expected current source work, preventing stale or accidental group merges.
create function open_index.associate_work_source(
  p_main text,p_source text,p_expected_work text,p_reviewer text,p_evidence jsonb,
  p_title text,p_source_role text,p_source_date_meaning text,p_publication text
) returns text language plpgsql security invoker set search_path='' as $$
declare target text; previous text; old_member jsonb; new_member jsonb; old_source_work jsonb; old_target_work jsonb; new_source_work jsonb; new_target_work jsonb;
begin
  if p_main=p_source or coalesce(trim(p_expected_work),'')='' or coalesce(trim(p_reviewer),'')='' or coalesce(trim(p_title),'')='' or
    jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)=0 or
    exists(select 1 from jsonb_array_elements(p_evidence) proof where jsonb_typeof(proof)<>'string' or trim(proof#>>'{}')='') or
    coalesce(trim(p_source_role),'')='' or coalesce(trim(p_source_date_meaning),'')='' then
    raise exception 'Reviewed distinct IDs, title, role, date meaning and nonempty evidence are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('work-source:'||v,0)) from unnest(array[p_main,p_source]) v order by v;
  target:=open_index.resolve_work_source(p_main,p_title);
  previous:=open_index.resolve_work_source(p_source,p_source);
  perform 1 from open_index.works where id in(target,previous) order by id for update;
  if not exists(select 1 from open_index.works where id=target and main_record_id=p_main and redirect_work_id is null) then
    raise exception 'Requested main must already be the canonical main of its work';
  end if;
  if previous<>p_expected_work then
    -- An exact replay of an already-applied association is harmless; stale edits are not.
    if previous=target and exists(select 1 from open_index.work_membership_history where record_id=p_source and previous_work_id=p_expected_work and work_id=target)
      and exists(select 1 from open_index.works where id=target and curated and title=p_title and evidence=p_evidence and reviewed_by=p_reviewer and publication_record_id is not distinct from p_publication)
      and exists(select 1 from open_index.work_records where record_id=p_source and role=p_source_role and date_meaning=p_source_date_meaning and evidence=p_evidence and reviewed_by=p_reviewer) then return target; end if;
    raise exception 'Stale source membership; review again';
  end if;
  if previous<>target and (not exists(select 1 from open_index.works where id=previous and main_record_id=p_source and not curated and redirect_work_id is null)
    or (select count(*) from open_index.work_records where work_id=previous)<>1
    or exists(select 1 from open_index.works where redirect_work_id=previous)) then
    raise exception 'Only an uncurated singleton may be associated; group merge requires separate review';
  end if;
  if p_publication is not null and p_publication not in(p_main,p_source) and
    not exists(select 1 from open_index.work_records where work_id=target and record_id=p_publication) then
    raise exception 'Publication source must belong to the work';
  end if;
  select to_jsonb(w) into old_source_work from open_index.works w where id=previous;
  select to_jsonb(w) into old_target_work from open_index.works w where id=target;
  select to_jsonb(m) into old_member from open_index.work_records m where record_id=p_source;
  update open_index.work_identifiers set work_id=target where work_id=previous and record_id=p_source;
  update open_index.work_records set work_id=target,relation='alternative',role=p_source_role,
    date_meaning=p_source_date_meaning,evidence=p_evidence,reviewed_by=p_reviewer where record_id=p_source;
  if previous<>target then
    update open_index.works set main_record_id=null,publication_record_id=null,redirect_work_id=target where id=previous;
  end if;
  update open_index.works set curated=true,auto_title=false,title=p_title,publication_record_id=p_publication,
    evidence=p_evidence,reviewed_by=p_reviewer,reviewed_at=case when evidence is distinct from p_evidence or title is distinct from p_title or reviewed_by is distinct from p_reviewer or publication_record_id is distinct from p_publication or not curated then now() else reviewed_at end
    where id=target;
  update open_index.entries set work_id=target where id=p_source and work_id<>target;
  update open_index.records set work_id=target where id=p_source and work_id<>target;
  select to_jsonb(m) into new_member from open_index.work_records m where record_id=p_source;
  select to_jsonb(w) into new_source_work from open_index.works w where id=previous;
  select to_jsonb(w) into new_target_work from open_index.works w where id=target;
  if old_member is distinct from new_member or old_source_work is distinct from new_source_work or old_target_work is distinct from new_target_work then
    insert into open_index.work_membership_history(record_id,previous_work_id,work_id,previous_source_work,previous_target_work,source_work,target_work,previous_membership,membership,reviewed_by,evidence)
      values(p_source,previous,target,old_source_work,old_target_work,new_source_work,new_target_work,old_member,new_member,p_reviewer,p_evidence);
    insert into open_index.changes(record_id,kind) select id,'updated' from open_index.records where work_id=target;
  end if;
  return target;
end $$;

-- Versioned evidence-backed DATA, not a runtime identity list. Reservations cover either arrival order.
do $$ declare expected text; target text; proof jsonb:='["https://github.com/anthropics/formal-math/blob/main/eth/README.md","https://hexagonmath.org/2610.00577v1"]'; begin
  perform open_index.resolve_work_source('lean/anthropics__formal-math__eth','A 2^{o(n)} Time Algorithm for 3-SAT');
  expected:=open_index.resolve_work_source('hexagon/2610.00577','A 2^{o(n)} Time Algorithm for 3-SAT');
  target:=open_index.associate_work_source('lean/anthropics__formal-math__eth','hexagon/2610.00577',expected,
    'curated-migration:anthropic-eth',proof,'A 2^{o(n)} Time Algorithm for 3-SAT','Paper','Paper publication','hexagon/2610.00577');
  update open_index.work_records set relation='main',role='Paper and Lean proof repository',
    date_meaning='Repository creation; not paper publication',evidence=proof,reviewed_by='curated-migration:anthropic-eth'
    where record_id='lean/anthropics__formal-math__eth';
end $$;

-- RLS remains enabled, without public policies. These helpers are not exposed to PUBLIC/anon/authenticated.
revoke all on function open_index.guard_work_membership() from public;
revoke all on function open_index.backfill_work_sources() from public;
revoke all on open_index.works,open_index.work_records,open_index.work_identifiers from public;
revoke all on function open_index.normalized_doi(text),open_index.source_doi(text,jsonb) from public;
revoke all on function open_index.place_work_source(text,text,jsonb),open_index.resolve_work_source(text,text,jsonb) from public;
revoke all on function open_index.bind_work_source() from public;
revoke all on function open_index.check_work_graph() from public;
revoke all on function open_index.associate_work_source(text,text,text,text,jsonb,text,text,text,text) from public;
-- Explicit role revocation also neutralizes ALTER DEFAULT PRIVILEGES grants.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=r) then
      execute format('revoke all on open_index.works,open_index.work_records,open_index.work_identifiers,open_index.work_membership_history from %I',r);
      execute format('revoke all on sequence open_index.work_membership_history_seq_seq from %I',r);
      execute format('revoke all on function open_index.normalized_doi(text),open_index.source_doi(text,jsonb),open_index.guard_work_membership(),open_index.backfill_work_sources(),open_index.place_work_source(text,text,jsonb),open_index.resolve_work_source(text,text,jsonb),open_index.bind_work_source(),open_index.check_work_graph(),open_index.associate_work_source(text,text,text,text,jsonb,text,text,text,text) from %I',r);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert on open_index.works,open_index.work_records,open_index.work_identifiers to service_role;
    grant update(title) on open_index.works to service_role;
    grant update(identity) on open_index.work_records to service_role;
    grant execute on function open_index.normalized_doi(text),open_index.source_doi(text,jsonb),open_index.guard_work_membership(),open_index.place_work_source(text,text,jsonb),open_index.resolve_work_source(text,text,jsonb),open_index.bind_work_source(),open_index.check_work_graph() to service_role;
  end if;
end $$;

-- Extend fixed usage categories without altering retained history.
ALTER TABLE open_index.api_usage
 DROP CONSTRAINT api_usage_endpoint_category,
 ADD CONSTRAINT api_usage_endpoint_category CHECK (endpoint IN ('GET /api/v1/works', 'GET /api/v1/search', 'GET /api/v1/records/{prefix}/{suffix}', 'GET /api/v1/records/{prefix}/{suffix}/comments', 'POST /api/v1/records/{prefix}/{suffix}/comments', 'GET /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/records/{prefix}/{suffix}/vote', 'DELETE /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/submit', 'GET /api/v1/forum', 'POST /api/v1/forum', 'GET /api/v1/forum/{id}', 'POST /api/v1/forum/{id}', 'POST /api/v1/forum/{id}/vote', 'POST /api/v1/forum/{id}/accept', 'GET /api/v1/prefixes', 'GET /api/v1/stats', 'POST /api/v1/keys/device', 'POST /api/v1/keys/token', 'GET /api/v1', 'GET /api/v1/openapi.json', 'GET /llms.txt', 'POST /mcp', 'GET /id/{prefix}/{suffix}', 'GET /sitemap.xml', 'GET /sitemap/{file}', 'GET /api/v1/users/{login}', 'GET /api/v1/profile', 'PATCH /api/v1/profile', 'GET /api/v1/keys', 'DELETE /api/v1/keys/{hash}')) NOT VALID;
