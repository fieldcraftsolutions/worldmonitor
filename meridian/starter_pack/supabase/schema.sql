-- Meridian Intelligence starter schema for Supabase/Postgres.
-- Review and test in a development project before using with real data.
-- This baseline uses owner_id per record. For multi-user organizations, replace
-- owner checks with an organization_members membership model before launch.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('organization','person','vessel','other')),
  legal_name text not null,
  jurisdiction text,
  registration_id text,
  description text,
  record_status text not null default 'active' check (record_status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  publisher text not null,
  title text not null,
  url text,
  source_type text not null default 'other' check (source_type in ('official_list','government','registry','filing','news','company_site','analyst_note','other')),
  publication_date date,
  retrieved_at timestamptz,
  license_status text not null default 'not_reviewed' check (license_status in ('permitted','restricted','not_reviewed','unknown')),
  notes text,
  created_at timestamptz not null default now(),
  constraint source_url_http check (url is null or url ~ '^https?://')
);

create table if not exists public.aliases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  alias_text text not null,
  alias_type text not null default 'other',
  source_id uuid references public.sources(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.identifiers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  issuing_jurisdiction text,
  source_id uuid references public.sources(id) on delete set null,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_type text not null check (case_type in ('screening_review','compliance','investigation','trade_risk','other')),
  title text not null,
  status text not null default 'open' check (status in ('open','in_review','escalated','closed','inconclusive')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  summary text,
  disposition text check (disposition is null or disposition in ('potential_match','not_a_match','escalated','inconclusive','other')),
  disposition_rationale text,
  created_by uuid not null references auth.users(id),
  assigned_to uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.case_entities (
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  role text not null default 'subject',
  created_at timestamptz not null default now(),
  primary key (case_id, entity_id, role)
);

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  claim text not null,
  finding_type text not null check (finding_type in ('source_fact','potential_match','analyst_assessment','ai_synthesis','unknown','contradictory_evidence')),
  verification_status text not null default 'unverified' check (verification_status in ('verified','corroborated','unverified','disputed','rejected','unknown')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  analyst_notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_entity_id uuid not null references public.entities(id) on delete cascade,
  target_entity_id uuid not null references public.entities(id) on delete cascade,
  relationship_type text not null,
  source_id uuid references public.sources(id) on delete set null,
  verification_status text not null default 'unverified' check (verification_status in ('verified','corroborated','unverified','disputed','rejected','unknown')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  valid_from date,
  valid_to date,
  analyst_notes text,
  created_at timestamptz not null default now(),
  check (source_entity_id <> target_entity_id)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists entities_owner_name_idx on public.entities(owner_id, lower(legal_name));
create index if not exists aliases_owner_alias_idx on public.aliases(owner_id, lower(alias_text));
create index if not exists identifiers_owner_value_idx on public.identifiers(owner_id, identifier_type, identifier_value);
create index if not exists cases_owner_status_idx on public.cases(owner_id, status, updated_at desc);
create index if not exists findings_owner_entity_idx on public.findings(owner_id, entity_id, created_at desc);
create index if not exists relationships_owner_source_idx on public.relationships(owner_id, source_entity_id);
create index if not exists audit_events_owner_created_idx on public.audit_events(owner_id, created_at desc);

-- Enable RLS on every user-owned table.
do $$
declare t text;
begin
  foreach t in array array['profiles','entities','sources','aliases','identifiers','cases','case_entities','findings','relationships','audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profiles: users can view and update only their own profile.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Owner-scoped CRUD for core tables. A future shared-organization model should
-- replace these with membership-based policies and server-validated tenant IDs.
do $$
declare t text;
begin
  foreach t in array array['entities','sources','aliases','identifiers','cases','case_entities','findings','relationships','audit_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('create policy %I on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_owner_all', t);
  end loop;
end $$;

-- Production note: do not let a client directly insert arbitrary audit events and
-- treat them as tamper-proof. Prefer a server-side function/trigger for sensitive
-- actions, and restrict audit_events INSERT/UPDATE/DELETE to trusted server roles.
