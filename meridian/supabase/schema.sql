-- Meridian Intelligence — schema v2 (development scaffold).
--
-- STATUS: tested against PostgreSQL 16 with a local `auth` shim (see
-- supabase/test/run-rls-tests.sh). NOT yet applied to or tested on a real
-- Supabase project, and NOT security-reviewed or production-certified. The demo
-- app in ../server does not use this database yet; it enforces the same
-- invariants in application code (tests/security.test.js).
--
-- What changed from the starter schema (starter_pack/supabase/schema.sql):
--   1. Multi-tenancy is organization-based (organizations + organization_members
--      with roles), not a single owner_id per row.
--   2. Child rows can no longer diverge from their parent's tenant: every
--      reference is a COMPOSITE foreign key (id, org_id), so an alias, finding,
--      relationship, case link etc. can only point at a row in the SAME org.
--   3. audit_events is not writable by clients at all. Events are written by
--      SECURITY DEFINER functions/triggers, are hash-chained per org, and are
--      protected from UPDATE/DELETE by a trigger. (A superuser/table owner can
--      still disable triggers; verify_audit_chain() detects that tampering and
--      the head hash should be anchored outside the database.)
--   4. Disposition / case-closing is restricted to the reviewer role by a trigger.
--   5. Evidence rules are CHECK constraints: verified/corroborated and
--      source_fact require a source; there is no "confirmed match" state.
--   6. Clients cannot insert system-generated finding types (ai_synthesis,
--      potential_match).
--
-- Intended for Supabase (auth.uid(), roles `authenticated` / `service_role`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tenancy
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','analyst','reviewer','admin')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members(user_id);

create schema if not exists meridian;

-- Membership helpers. SECURITY DEFINER so policies can read membership without
-- recursing into the members table's own RLS; search_path is pinned.
create or replace function meridian.has_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;
create or replace function meridian.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select meridian.has_role(p_org, array['viewer','analyst','reviewer','admin']);
$$;
create or replace function meridian.can_write(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select meridian.has_role(p_org, array['analyst','reviewer','admin']);
$$;
create or replace function meridian.is_reviewer(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select meridian.has_role(p_org, array['reviewer','admin']);
$$;

-- Creating an organization makes the caller its admin (otherwise nobody could).
create or replace function meridian.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.organizations(name) values (p_name) returning id into v_org;
  insert into public.organization_members(org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  return v_org;
end $$;

-- ---------------------------------------------------------------- core tables
-- Every tenant table has (id, org_id) unique so children can use composite FKs.
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('organization','person','vessel','other')),
  legal_name text not null check (length(legal_name) between 1 and 300),
  jurisdiction text,
  registration_id text,
  description text,
  record_status text not null default 'active' check (record_status in ('active','archived')),
  data_origin text not null default 'analyst_entered',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  publisher text not null,
  title text not null,
  url text,
  source_type text not null default 'other' check (source_type in ('official_list','government','registry','filing','news','company_site','analyst_note','other')),
  publication_date date,
  retrieved_at timestamptz,                         -- null = never retrieved; the UI must say so
  license_status text not null default 'not_reviewed' check (license_status in ('permitted','restricted','not_reviewed','unknown')),
  data_origin text not null default 'analyst_supplied',
  notes text,
  created_at timestamptz not null default now(),
  constraint source_url_http check (url is null or url ~ '^https?://'),
  unique (id, org_id)
);

create table if not exists public.aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_id uuid not null,
  alias_text text not null,
  alias_type text not null default 'other',
  source_id uuid,
  created_at timestamptz not null default now(),
  foreign key (entity_id, org_id) references public.entities(id, org_id) on delete cascade,
  foreign key (source_id, org_id) references public.sources(id, org_id) on delete set null (source_id)
);

create table if not exists public.identifiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_id uuid not null,
  identifier_type text not null,
  identifier_value text not null,
  issuing_jurisdiction text,
  source_id uuid,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  foreign key (entity_id, org_id) references public.entities(id, org_id) on delete cascade,
  foreign key (source_id, org_id) references public.sources(id, org_id) on delete set null (source_id)
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  case_type text not null check (case_type in ('screening_review','compliance','investigation','trade_risk','other')),
  title text not null,
  status text not null default 'open' check (status in ('open','in_review','escalated','closed','inconclusive')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  summary text,
  research_question text,
  -- Deliberately no 'confirmed' value: the system never records a confirmed match.
  disposition text check (disposition is null or disposition in ('potential_match','not_a_match','escalated','inconclusive','other')),
  disposition_rationale text,
  origin_case_id uuid,
  created_by uuid not null references auth.users(id),
  assigned_to uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (origin_case_id, org_id) references public.cases(id, org_id) on delete set null (origin_case_id),
  -- closing as "not a match" needs a written rationale
  constraint closed_needs_rationale check (status <> 'closed' or (disposition_rationale is not null and length(disposition_rationale) >= 20))
);

create table if not exists public.case_entities (
  org_id uuid not null,
  case_id uuid not null,
  entity_id uuid not null,
  role text not null default 'subject',
  created_at timestamptz not null default now(),
  primary key (case_id, entity_id, role),
  foreign key (case_id, org_id) references public.cases(id, org_id) on delete cascade,
  foreign key (entity_id, org_id) references public.entities(id, org_id) on delete cascade
);

create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  case_id uuid not null,
  body text not null check (length(body) between 1 and 4000),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases(id, org_id) on delete cascade
);

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_id uuid,
  case_id uuid,
  source_id uuid,
  claim text not null,
  finding_type text not null check (finding_type in ('source_fact','potential_match','analyst_assessment','ai_synthesis','unknown','contradictory_evidence')),
  verification_status text not null default 'unverified' check (verification_status in ('verified','corroborated','unverified','disputed','rejected','unknown')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  analyst_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (entity_id, org_id) references public.entities(id, org_id) on delete cascade,
  foreign key (case_id, org_id) references public.cases(id, org_id) on delete cascade,
  foreign key (source_id, org_id) references public.sources(id, org_id) on delete set null (source_id),
  constraint finding_has_subject check (entity_id is not null or case_id is not null),
  -- evidence rules: confidence is not verification, and verification needs a source
  constraint fact_needs_source check (finding_type <> 'source_fact' or source_id is not null),
  constraint verified_needs_source check (verification_status not in ('verified','corroborated') or source_id is not null)
);

create table if not exists public.relationships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_entity_id uuid not null,
  target_entity_id uuid not null,
  relationship_type text not null,
  source_id uuid,
  verification_status text not null default 'unverified' check (verification_status in ('verified','corroborated','unverified','disputed','rejected','unknown')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  valid_from date,
  valid_to date,
  analyst_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (source_entity_id, org_id) references public.entities(id, org_id) on delete cascade,
  foreign key (target_entity_id, org_id) references public.entities(id, org_id) on delete cascade,
  foreign key (source_id, org_id) references public.sources(id, org_id) on delete set null (source_id),
  check (source_entity_id <> target_entity_id),
  constraint rel_verified_needs_source check (verification_status not in ('verified','corroborated') or source_id is not null)
);

-- Reference lists (e.g. an official sanctions list snapshot). Global, read-only
-- to clients; loaded by trusted ingestion jobs using the service role.
create table if not exists public.watchlist_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  publisher text not null,
  url text,
  origin text not null check (origin in ('simulated_fixture','official_live','test_fixture')),
  version text,
  retrieved_at timestamptz,
  license_status text not null default 'not_reviewed' check (license_status in ('permitted','restricted','not_reviewed','unknown')),
  notes text
);
create table if not exists public.watchlist_entries (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.watchlist_lists(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  identifiers jsonb not null default '[]'::jsonb,
  jurisdiction text,
  program text
);

-- A screening records WHICH list (and which snapshot of it) was used, so a
-- "no candidates" result can never be mistaken for a clearance.
create table if not exists public.screenings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_id uuid not null,
  list_id uuid references public.watchlist_lists(id),
  list_snapshot jsonb,
  status text not null check (status in ('pending_review','no_candidates','source_unavailable','reviewed','escalated')),
  candidates jsonb not null default '[]'::jsonb,
  matcher text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (entity_id, org_id) references public.entities(id, org_id) on delete cascade
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  case_id uuid not null,
  title text not null,
  content jsonb not null,
  generator jsonb not null,
  status text not null default 'draft_requires_human_review',
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases(id, org_id) on delete cascade
);

-- ---------------------------------------------------------------- audit (append-only, hash-chained)
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  seq bigint not null,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  object_type text not null,
  object_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  hash text not null,
  unique (org_id, seq)
);

create or replace function meridian._audit_hash(p_prev text, p_seq bigint, p_at timestamptz, p_actor uuid, p_action text, p_type text, p_obj uuid, p_meta jsonb)
returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, p_seq::text,
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_actor::text,''), p_action, p_type,
    coalesce(p_obj::text,''), p_meta::text), 'UTF8')), 'hex');
$$;

-- Internal writer. Not granted to clients.
create or replace function meridian._audit(p_org uuid, p_actor uuid, p_action text, p_type text, p_obj uuid, p_meta jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev text; v_seq bigint; v_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 0));   -- serialise per-org chain
  select hash, seq into v_prev, v_seq from public.audit_events where org_id = p_org order by seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into public.audit_events(org_id, seq, at, actor_id, action, object_type, object_id, metadata, prev_hash, hash)
  values (p_org, v_seq, v_at, p_actor, p_action, p_type, p_obj, coalesce(p_meta, '{}'::jsonb), v_prev,
          meridian._audit_hash(v_prev, v_seq, v_at, p_actor, p_action, p_type, p_obj, coalesce(p_meta, '{}'::jsonb)));
end $$;
revoke all on function meridian._audit(uuid, uuid, text, text, uuid, jsonb) from public;

-- Client-callable: members may record application-level events for their own org.
create or replace function meridian.log_audit(p_org uuid, p_action text, p_type text, p_obj uuid, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not meridian.can_write(p_org) then raise exception 'not permitted to write audit events for this organization'; end if;
  perform meridian._audit(p_org, auth.uid(), p_action, p_type, p_obj, p_meta);
end $$;

create or replace function meridian.verify_audit_chain(p_org uuid)
returns table (ok boolean, events bigint, broken_at_seq bigint, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_prev text := repeat('0', 64); v_n bigint := 0;
begin
  if not meridian.is_member(p_org) then raise exception 'not a member of this organization'; end if;
  for r in select * from public.audit_events where org_id = p_org order by seq loop
    v_n := v_n + 1;
    if r.seq <> v_n then return query select false, v_n, r.seq, 'sequence gap'; return; end if;
    if r.prev_hash <> v_prev then return query select false, v_n, r.seq, 'previous-hash mismatch'; return; end if;
    if r.hash <> meridian._audit_hash(r.prev_hash, r.seq, r.at, r.actor_id, r.action, r.object_type, r.object_id, r.metadata) then
      return query select false, v_n, r.seq, 'event content altered'; return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, v_n, null::bigint, null::text;
end $$;

create or replace function meridian.audit_block_mutation() returns trigger language plpgsql as $$
begin raise exception 'audit_events is append-only'; end $$;
drop trigger if exists audit_no_update on public.audit_events;
create trigger audit_no_update before update or delete on public.audit_events
  for each row execute function meridian.audit_block_mutation();
drop trigger if exists audit_no_truncate on public.audit_events;
create trigger audit_no_truncate before truncate on public.audit_events
  for each statement execute function meridian.audit_block_mutation();

-- ---------------------------------------------------------------- integrity triggers
-- The tenant of a row can never change.
create or replace function meridian.freeze_org() returns trigger language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id then raise exception 'org_id is immutable'; end if;
  return new;
end $$;

-- Only reviewers may set a disposition or close a case. Runs for every client path.
create or replace function meridian.guard_case_update() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and (
       new.disposition is distinct from old.disposition
    or new.disposition_rationale is distinct from old.disposition_rationale
    or (new.status = 'closed' and old.status <> 'closed')
  ) and not meridian.is_reviewer(new.org_id) then
    raise exception 'only a reviewer may record a disposition or close a case';
  end if;
  if old.status = 'closed' and new.status <> 'closed' then raise exception 'a closed case cannot be reopened'; end if;
  new.updated_at := now();
  return new;
end $$;

-- Auto-audit sensitive changes so they cannot be skipped by a client that talks
-- to the tables directly.
create or replace function meridian.audit_case_change() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform meridian._audit(new.org_id, auth.uid(), 'case.created', 'case', new.id, jsonb_build_object('case_id', new.id, 'case_type', new.case_type));
  elsif new.status is distinct from old.status or new.disposition is distinct from old.disposition then
    perform meridian._audit(new.org_id, auth.uid(), 'case.updated', 'case', new.id,
      jsonb_build_object('case_id', new.id, 'status', jsonb_build_array(old.status, new.status), 'disposition', jsonb_build_array(old.disposition, new.disposition)));
  end if;
  return new;
end $$;

create or replace function meridian.audit_finding_change() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform meridian._audit(new.org_id, auth.uid(), 'finding.created', 'finding', new.id, jsonb_build_object('finding_type', new.finding_type, 'verification_status', new.verification_status));
  elsif new.verification_status is distinct from old.verification_status then
    perform meridian._audit(new.org_id, auth.uid(), 'finding.verification_changed', 'finding', new.id, jsonb_build_object('from', old.verification_status, 'to', new.verification_status));
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['entities','sources','aliases','identifiers','cases','case_entities','case_notes','findings','relationships','screenings','reports'] loop
    execute format('drop trigger if exists freeze_org on public.%I', t);
    execute format('create trigger freeze_org before update on public.%I for each row execute function meridian.freeze_org()', t);
  end loop;
end $$;
drop trigger if exists guard_case_update on public.cases;
create trigger guard_case_update before update on public.cases for each row execute function meridian.guard_case_update();
drop trigger if exists audit_case_change on public.cases;
create trigger audit_case_change after insert or update on public.cases for each row execute function meridian.audit_case_change();
drop trigger if exists audit_finding_change on public.findings;
create trigger audit_finding_change after insert or update on public.findings for each row execute function meridian.audit_finding_change();

-- ---------------------------------------------------------------- indexes
create index if not exists entities_org_name_idx on public.entities(org_id, lower(legal_name));
create index if not exists aliases_org_alias_idx on public.aliases(org_id, lower(alias_text));
create index if not exists aliases_entity_idx on public.aliases(entity_id);
create index if not exists identifiers_org_value_idx on public.identifiers(org_id, identifier_type, identifier_value);
create index if not exists identifiers_entity_idx on public.identifiers(entity_id);
create index if not exists cases_org_status_idx on public.cases(org_id, status, updated_at desc);
create index if not exists case_entities_entity_idx on public.case_entities(entity_id);
create index if not exists findings_org_entity_idx on public.findings(org_id, entity_id, created_at desc);
create index if not exists findings_case_idx on public.findings(case_id);
create index if not exists relationships_org_source_idx on public.relationships(org_id, source_entity_id);
create index if not exists relationships_org_target_idx on public.relationships(org_id, target_entity_id);
create index if not exists screenings_org_entity_idx on public.screenings(org_id, entity_id, created_at desc);
create index if not exists audit_events_org_seq_idx on public.audit_events(org_id, seq desc);
create index if not exists watchlist_entries_list_idx on public.watchlist_entries(list_id);

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','organization_members','entities','sources','aliases','identifiers','cases','case_entities','case_notes','findings','relationships','screenings','reports','audit_events','watchlist_lists','watchlist_entries'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  -- FORCE applies policies to the table owner too. Only for tenant DATA tables:
  -- the SECURITY DEFINER helpers (membership lookup, audit writer) run as owner
  -- and must be able to read organization_members / write audit_events.
  foreach t in array array['entities','sources','aliases','identifiers','cases','case_entities','case_notes','findings','relationships','screenings','reports'] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- profiles: own row only
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- organizations / membership
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select to authenticated using (meridian.is_member(id));
drop policy if exists members_select on public.organization_members;
create policy members_select on public.organization_members for select to authenticated using (meridian.is_member(org_id));
drop policy if exists members_admin_write on public.organization_members;
create policy members_admin_write on public.organization_members for all to authenticated
  using (meridian.has_role(org_id, array['admin'])) with check (meridian.has_role(org_id, array['admin']));

-- tenant tables: members read; analysts/reviewers/admins write; nobody deletes via the API
-- (no DELETE policy => denied; archive with record_status instead).
do $$
declare t text;
begin
  foreach t in array array['entities','sources','aliases','identifiers','cases','case_entities','case_notes','relationships','screenings','reports'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (meridian.is_member(org_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (meridian.can_write(org_id))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (meridian.can_write(org_id)) with check (meridian.can_write(org_id))', t || '_update', t);
  end loop;
end $$;

-- findings: same, but clients may not create system-generated types.
drop policy if exists findings_select on public.findings;
create policy findings_select on public.findings for select to authenticated using (meridian.is_member(org_id));
drop policy if exists findings_insert on public.findings;
create policy findings_insert on public.findings for insert to authenticated
  with check (meridian.can_write(org_id) and finding_type in ('source_fact','analyst_assessment','unknown','contradictory_evidence'));
drop policy if exists findings_update on public.findings;
create policy findings_update on public.findings for update to authenticated
  using (meridian.can_write(org_id))
  with check (meridian.can_write(org_id) and finding_type in ('source_fact','analyst_assessment','unknown','contradictory_evidence'));

-- audit: members may READ their org's events; nobody can write through the API.
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated using (meridian.is_member(org_id));

-- reference lists: any signed-in user may read; only the service role writes.
drop policy if exists watchlist_lists_select on public.watchlist_lists;
create policy watchlist_lists_select on public.watchlist_lists for select to authenticated using (true);
drop policy if exists watchlist_entries_select on public.watchlist_entries;
create policy watchlist_entries_select on public.watchlist_entries for select to authenticated using (true);

-- ---------------------------------------------------------------- privileges (defence in depth)
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update on public.entities, public.sources, public.aliases, public.identifiers,
  public.cases, public.case_entities, public.case_notes, public.findings, public.relationships,
  public.screenings, public.reports to authenticated;
grant select on public.organizations, public.organization_members, public.audit_events,
  public.watchlist_lists, public.watchlist_entries to authenticated;
grant select, insert, update, delete on public.profiles, public.organization_members to authenticated;  -- governed by RLS
grant usage on schema meridian to authenticated;
revoke all on all functions in schema meridian from public;
grant execute on function meridian.has_role(uuid, text[]), meridian.is_member(uuid), meridian.can_write(uuid),
  meridian.is_reviewer(uuid), meridian.create_organization(text), meridian.log_audit(uuid, text, text, uuid, jsonb),
  meridian.verify_audit_chain(uuid) to authenticated;
