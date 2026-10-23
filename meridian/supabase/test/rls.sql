-- Adversarial tests for supabase/schema.sql. Each expect_* helper raises (and
-- psql aborts with ON_ERROR_STOP) if behaviour differs from what is asserted.
create schema t;
grant usage on schema t to authenticated, anon;

create function t.become(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); set role authenticated; end $$;
create function t.admin() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', '', false); end $$;

create function t.expect_fail(label text, q text, pat text default '.') returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    if sqlerrm ~* pat then raise notice 'ok   % [rejected: %]', label, left(sqlerrm, 70); return;
    else raise exception 'FAIL % — rejected for the wrong reason: %', label, sqlerrm; end if;
  end;
  raise exception 'FAIL % — succeeded but must be rejected', label;
end $$;
create function t.expect_ok(label text, q text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise exception 'FAIL % — unexpectedly rejected: %', label, sqlerrm; end;
  raise notice 'ok   %', label;
end $$;
create function t.expect_count(label text, q text, want bigint) returns void language plpgsql as $$
declare got bigint;
begin
  execute q into got;
  if got is distinct from want then raise exception 'FAIL % — expected %, got %', label, want, got; end if;
  raise notice 'ok   % [= %]', label, got;
end $$;
grant execute on all functions in schema t to authenticated, anon;

-- ------------------------------------------------------------ fixtures (as superuser)
insert into auth.users(id) values
  ('a0000000-0000-0000-0000-000000000001'), ('a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003'), ('b0000000-0000-0000-0000-000000000001');
insert into public.organizations(id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Org A (test)'), ('bbbbbbbb-0000-0000-0000-000000000000', 'Org B (test)');
insert into public.organization_members(org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'analyst'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'reviewer'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'viewer'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'analyst');
insert into public.entities(id, org_id, entity_type, legal_name) values
  ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'organization', 'Entity A'),
  ('e0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'organization', 'Entity B');
insert into public.sources(id, org_id, publisher, title) values
  ('50000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'P', 'Source A'),
  ('50000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'P', 'Source B');
insert into public.watchlist_lists(id, name, publisher, origin) values ('11000000-0000-0000-0000-000000000001', 'Fictional list', 'fixture', 'simulated_fixture');

\warn '--- tenant isolation (analyst of org A)'
select t.become('a0000000-0000-0000-0000-000000000001');
select t.expect_count('analyst sees only org A entities', 'select count(*) from public.entities', 1);
select t.expect_count('org B entity is invisible by id', $$select count(*) from public.entities where id = 'e0000000-0000-0000-0000-00000000000b'$$, 0);
select t.expect_count('org B source is invisible', 'select count(*) from public.sources where title = ''Source B''', 0);
select t.expect_fail('cannot insert an entity into org B', $$insert into public.entities(org_id, entity_type, legal_name) values ('bbbbbbbb-0000-0000-0000-000000000000','organization','Planted')$$, 'row-level security');
select t.expect_fail('cannot move an entity to org B', $$update public.entities set org_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'e0000000-0000-0000-0000-00000000000a'$$, 'row-level security|immutable');
select t.expect_ok('can insert into own org', $$insert into public.entities(org_id, entity_type, legal_name) values ('aaaaaaaa-0000-0000-0000-000000000000','organization','Own entity')$$);

\warn '--- cross-tenant references (the starter schema child-owner divergence)'
select t.expect_fail('alias in org A pointing at org B entity', $$insert into public.aliases(org_id, entity_id, alias_text) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000b','x')$$, 'foreign key');
select t.expect_fail('finding citing org B source', $$insert into public.findings(org_id, entity_id, source_id, claim, finding_type) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','50000000-0000-0000-0000-00000000000b','c','source_fact')$$, 'foreign key');
select t.expect_fail('relationship to org B entity', $$insert into public.relationships(org_id, source_entity_id, target_entity_id, relationship_type) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-00000000000b','x')$$, 'foreign key');
select t.expect_ok('same-org alias is fine', $$insert into public.aliases(org_id, entity_id, alias_text) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','Alias A')$$);

\warn '--- evidence rules'
select t.expect_fail('verified requires a source', $$insert into public.findings(org_id, entity_id, claim, finding_type, verification_status) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','c','analyst_assessment','verified')$$, 'verified_needs_source');
select t.expect_fail('source_fact requires a source', $$insert into public.findings(org_id, entity_id, claim, finding_type) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','c','source_fact')$$, 'fact_needs_source');
select t.expect_fail('client cannot create ai_synthesis findings', $$insert into public.findings(org_id, entity_id, claim, finding_type, source_id) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','c','ai_synthesis','50000000-0000-0000-0000-00000000000a')$$, 'row-level security');
select t.expect_fail('client cannot create potential_match findings', $$insert into public.findings(org_id, entity_id, claim, finding_type) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','c','potential_match')$$, 'row-level security');
select t.expect_fail('verified relationship requires a source', $$insert into public.relationships(org_id, source_entity_id, target_entity_id, relationship_type, verification_status) select 'aaaaaaaa-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-00000000000a', id, 'x', 'verified' from public.entities where legal_name = 'Own entity'$$, 'rel_verified_needs_source');
select t.expect_ok('sourced finding is accepted', $$insert into public.findings(org_id, entity_id, claim, finding_type, source_id, verification_status) values ('aaaaaaaa-0000-0000-0000-000000000000','e0000000-0000-0000-0000-00000000000a','Sourced claim','source_fact','50000000-0000-0000-0000-00000000000a','verified')$$);
select t.expect_count('finding insert was audited automatically', $$select count(*) from public.audit_events where action = 'finding.created'$$, 1);

\warn '--- roles and dispositions'
select t.expect_ok('analyst opens a case', $$insert into public.cases(org_id, case_type, title, created_by) values ('aaaaaaaa-0000-0000-0000-000000000000','screening_review','Case 1','a0000000-0000-0000-0000-000000000001')$$);
select t.expect_count('case creation was audited automatically', $$select count(*) from public.audit_events where action = 'case.created'$$, 1);
select t.expect_fail('analyst cannot set a disposition', $$update public.cases set disposition = 'inconclusive', disposition_rationale = 'trying to bypass the reviewer role' where title = 'Case 1'$$, 'only a reviewer');
select t.expect_fail('analyst cannot close a case', $$update public.cases set status = 'closed' where title = 'Case 1'$$, 'only a reviewer|closed_needs_rationale');
select t.expect_fail('analyst cannot grant themself admin', $$insert into public.organization_members(org_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000','a0000000-0000-0000-0000-000000000001','admin')$$, 'row-level security');
select t.expect_fail('analyst cannot join org B', $$insert into public.organization_members(org_id, user_id, role) values ('bbbbbbbb-0000-0000-0000-000000000000','a0000000-0000-0000-0000-000000000001','admin')$$, 'row-level security');
select t.expect_fail('no client can delete entities', $$delete from public.entities where legal_name = 'Own entity'$$, 'permission denied');

select t.become('a0000000-0000-0000-0000-000000000002');   -- reviewer
select t.expect_fail('closing needs a written rationale', $$update public.cases set status = 'closed', disposition = 'not_a_match' where title = 'Case 1'$$, 'closed_needs_rationale');
select t.expect_fail('"confirmed" is not a valid disposition', $$update public.cases set disposition = 'confirmed_match', disposition_rationale = 'a long enough rationale here' where title = 'Case 1'$$, 'check constraint');
select t.expect_ok('reviewer records an inconclusive disposition', $$update public.cases set status = 'inconclusive', disposition = 'inconclusive', disposition_rationale = 'Identifiers differ; ownership unresolved; keep open.' where title = 'Case 1'$$);
select t.expect_ok('reviewer closes with rationale', $$update public.cases set status = 'closed', disposition = 'not_a_match', disposition_rationale = 'Registry shows a different legal form and address.', closed_at = now() where title = 'Case 1'$$);
select t.expect_fail('a closed case cannot be reopened', $$update public.cases set status = 'open' where title = 'Case 1'$$, 'cannot be reopened');
select t.expect_count('accepted disposition changes were audited automatically (rejected attempts leave none)', $$select count(*) from public.audit_events where action = 'case.updated'$$, 2);

\warn '--- read-only viewer'
select t.become('a0000000-0000-0000-0000-000000000003');
select t.expect_count('viewer can read', 'select count(*) from public.entities', 2);
select t.expect_fail('viewer cannot insert', $$insert into public.entities(org_id, entity_type, legal_name) values ('aaaaaaaa-0000-0000-0000-000000000000','organization','Nope')$$, 'row-level security');
select t.expect_count('viewer update affects 0 rows', $$with u as (update public.entities set legal_name = 'Hacked' returning 1) select count(*) from u$$, 0);
select t.expect_fail('viewer cannot write audit events', $$select meridian.log_audit('aaaaaaaa-0000-0000-0000-000000000000','x','x',null)$$, 'not permitted');

\warn '--- audit integrity'
select t.become('a0000000-0000-0000-0000-000000000001');
select t.expect_fail('client cannot insert audit rows', $$insert into public.audit_events(org_id, seq, action, object_type, prev_hash, hash) values ('aaaaaaaa-0000-0000-0000-000000000000', 999, 'forged', 'x', 'p', 'h')$$, 'permission denied');
select t.expect_fail('client cannot update audit rows', $$update public.audit_events set action = 'x'$$, 'permission denied');
select t.expect_fail('client cannot delete audit rows', $$delete from public.audit_events$$, 'permission denied');
select t.expect_fail('client cannot truncate audit rows', $$truncate public.audit_events$$, 'permission denied');
select t.expect_fail('cannot log audit events into another org', $$select meridian.log_audit('bbbbbbbb-0000-0000-0000-000000000000','x','x',null)$$, 'not permitted');
select t.expect_ok('can log an application event in own org', $$select meridian.log_audit('aaaaaaaa-0000-0000-0000-000000000000','report.generated','report',null,'{"claims":3}')$$);
select t.expect_count('audit rows of org B are invisible', $$select count(*) from public.audit_events where org_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select t.expect_count('chain verifies', $$select count(*) from meridian.verify_audit_chain('aaaaaaaa-0000-0000-0000-000000000000') where ok$$, 1);
select t.expect_fail('cannot verify another org''s chain', $$select * from meridian.verify_audit_chain('bbbbbbbb-0000-0000-0000-000000000000')$$, 'not a member');

\warn '--- organizations'
select t.become('a0000000-0000-0000-0000-000000000003');
select t.expect_ok('any user can create an organization (becomes admin)', $$select meridian.create_organization('Viewer''s own org')$$);
select t.expect_ok('...and write into it', $$insert into public.entities(org_id, entity_type, legal_name) select id, 'organization', 'Mine' from public.organizations where name = 'Viewer''s own org'$$);
select t.expect_count('...but still sees org A read-only and own org', 'select count(*) from public.organizations', 2);

\warn '--- reference lists and anonymous access'
select t.expect_count('signed-in users can read reference lists', 'select count(*) from public.watchlist_lists', 1);
select t.expect_fail('clients cannot modify reference lists', $$insert into public.watchlist_lists(name, publisher, origin) values ('x','x','official_live')$$, 'permission denied');
select t.admin();
set role anon;
select t.expect_fail('anonymous role has no table access', 'select count(*) from public.entities', 'permission denied');
reset role;

\warn '--- tampering by a privileged actor is blocked, or detected if triggers are bypassed'
select t.expect_fail('owner UPDATE blocked by append-only trigger', $$update public.audit_events set action = 'rewritten'$$, 'append-only');
set session_replication_role = replica;      -- superuser bypasses triggers (the residual risk)
update public.audit_events set metadata = '{"tampered":true}' where seq = 2 and org_id = 'aaaaaaaa-0000-0000-0000-000000000000';
set session_replication_role = origin;
select t.become('a0000000-0000-0000-0000-000000000001');
select t.expect_count('verify_audit_chain DETECTS the tampering', $$select count(*) from meridian.verify_audit_chain('aaaaaaaa-0000-0000-0000-000000000000') where not ok and reason = 'event content altered'$$, 1);
select t.admin();

\warn 'ALL RLS / INTEGRITY TESTS PASSED'
