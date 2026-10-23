import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { seedDemo } from '../server/seed.js';
import { appendAudit, verifyChain } from '../server/audit.js';
import { validateBriefing, generateBriefing, buildContext, BriefingValidationError } from '../server/briefing.js';
import { screenEntity, normalizeName, normalizeIdentifier, jaroWinkler } from '../server/matching.js';

async function fixture() {
  const store = new Store();
  const { orgA } = await seedDemo(store, { password: 'x-test-password' });
  return { store, orgA: orgA.id };
}

test('audit chain verifies, and detects edits, deletions, reordering and forged inserts', async () => {
  const { store, orgA } = await fixture();
  for (let i = 0; i < 5; i++) appendAudit(store, orgA, { actor: { id: 'u', email: 'u@x' }, action: `t.${i}`, objectType: 'x', metadata: { i } });
  assert.equal(verifyChain(store, orgA).ok, true);

  const tamper = (fn) => { const copy = structuredClone(store.data.audit_events); fn(store.data.audit_events); const r = verifyChain(store, orgA); store.data.audit_events = copy; return r; };
  assert.equal(tamper((ev) => { ev.find((e) => e.org_id === orgA && e.action === 't.2').metadata.i = 99; }).ok, false, 'edit detected');
  assert.equal(tamper((ev) => { ev.splice(ev.findIndex((e) => e.org_id === orgA && e.action === 't.2'), 1); }).ok, false, 'deletion detected');
  assert.equal(tamper((ev) => { const i = ev.findIndex((e) => e.org_id === orgA && e.action === 't.1'); [ev[i], ev[i + 1]] = [ev[i + 1], ev[i]]; const a = ev[i].seq; ev[i].seq = ev[i + 1].seq; ev[i + 1].seq = a; }).ok, false, 'reorder detected');
  assert.equal(tamper((ev) => { ev.find((e) => e.org_id === orgA && e.action === 't.4').actor_label = 'someone-else'; }).ok, false, 'actor rewrite detected');
  assert.throws(() => store.update(orgA, 'audit_events', store.list(orgA, 'audit_events')[0].id, { action: 'x' }), /append-only/);
});

test('store: records from another org are indistinguishable from missing', async () => {
  const { store, orgA } = await fixture();
  const other = store.globalAll('organizations').find((o) => o.id !== orgA).id;
  const e = store.list(orgA, 'entities')[0];
  assert.equal(store.get(other, 'entities', e.id), undefined);
  assert.equal(store.update(other, 'entities', e.id, { legal_name: 'hijack' }), undefined);
  assert.throws(() => store.list(undefined, 'entities'), /org id required/);
  assert.throws(() => store.list(orgA, 'users'), /not a tenant collection/);
  const copy = store.get(orgA, 'entities', e.id); copy.legal_name = 'mutated copy';
  assert.notEqual(store.get(orgA, 'entities', e.id).legal_name, 'mutated copy', 'reads return clones');
});

test('briefing validator rejects uncited claims, invented sources, verdicts and AI-marked-verified', async () => {
  const { store, orgA } = await fixture();
  const ns = store.list(orgA, 'entities').find((e) => e.legal_name === 'Northstar Maritime Group');
  const cs = store.insert(orgA, 'cases', { case_type: 'investigation', title: 't', status: 'open', priority: 'normal', created_by: 'x' });
  store.insert(orgA, 'case_entities', { case_id: cs.id, entity_id: ns.id, role: 'subject' });
  const ctx = buildContext(store, orgA, cs, Date.now());
  const item = (o) => ({ kind: 'source_fact', text: 'A claim.', authored_by: 'generator', source_refs: [], ...o });
  const check = (items) => validateBriefing({ sections: [{ heading: 'h', items }] }, ctx).map((p) => p.code);

  assert.deepEqual(check([item()]), ['uncited_claim']);
  assert.deepEqual(check([item({ source_refs: ['S:made-up-id'] })]), ['unknown_source_ref']);
  const real = ctx.sources[0];
  assert.deepEqual(check([item({ source_refs: [`S:${real.id}`] })]), []);
  assert.ok(check([item({ text: 'Northstar is sanctioned.', source_refs: [`S:${real.id}`] })]).includes('verdict_language'));
  assert.ok(check([item({ text: 'The company is not sanctioned.', source_refs: [`S:${real.id}`] })]).includes('verdict_language'));
  assert.ok(check([item({ text: 'The subject is cleared and compliant.', source_refs: [`S:${real.id}`] })]).includes('verdict_language'));
  assert.ok(check([item({ text: 'This is a confirmed match.', source_refs: [`S:${real.id}`] })]).includes('verdict_language'));
  assert.deepEqual(check([item({ kind: 'potential_match', text: 'This is not a confirmed match.', source_refs: [`S:${real.id}`] })]), [], 'negated caution is allowed');
  assert.ok(check([item({ kind: 'ai_synthesis', verification_status: 'verified', source_refs: [`S:${real.id}`] })]).includes('ai_marked_verified'));
  // analyst-authored text is quoted, not policed
  assert.deepEqual(check([item({ kind: 'analyst_assessment', authored_by: 'analyst', text: 'Analyst believes it is cleared.' })]), []);
});

test('a hostile/low-quality provider cannot get an unsupported briefing saved', async () => {
  const { store, orgA } = await fixture();
  const ns = store.list(orgA, 'entities').find((e) => e.legal_name === 'Northstar Maritime Group');
  const cs = store.insert(orgA, 'cases', { case_type: 'investigation', title: 't', status: 'open', priority: 'normal', created_by: 'x' });
  store.insert(orgA, 'case_entities', { case_id: cs.id, entity_id: ns.id, role: 'subject' });
  const hostile = { descriptor: { name: 'mock-llm', version: '0', kind: 'test', model: 'none' }, compose: () => ({ sections: [{ heading: 'Summary', items: [{ kind: 'ai_synthesis', text: 'Northstar is not sanctioned and owns three vessels.', authored_by: 'generator', source_refs: ['S:invented'] }] }] }) };
  assert.throws(() => generateBriefing(store, orgA, cs, { provider: hostile }), BriefingValidationError);
  assert.equal(store.list(orgA, 'reports').length, 0);
});

test('briefing flags missing retrieval timestamps, stale and unreviewed-licence sources, and cannot be built from another org\'s data', async () => {
  const { store, orgA } = await fixture();
  const ns = store.list(orgA, 'entities').find((e) => e.legal_name === 'Northstar Maritime Group');
  const old = store.insert(orgA, 'sources', { publisher: 'P', title: 'Old', source_type: 'other', retrieved_at: new Date(Date.now() - 200 * 86400000).toISOString(), license_status: 'unknown' });
  const never = store.insert(orgA, 'sources', { publisher: 'P', title: 'Never fetched', source_type: 'other', retrieved_at: null, license_status: 'not_reviewed' });
  store.insert(orgA, 'findings', { entity_id: ns.id, source_id: old.id, claim: 'Old claim', finding_type: 'source_fact', verification_status: 'unverified', created_by: 'x' });
  store.insert(orgA, 'findings', { entity_id: ns.id, source_id: never.id, claim: 'Unretrieved claim', finding_type: 'source_fact', verification_status: 'unverified', created_by: 'x' });
  const cs = store.insert(orgA, 'cases', { case_type: 'investigation', title: 't', status: 'open', priority: 'normal', created_by: 'x' });
  store.insert(orgA, 'case_entities', { case_id: cs.id, entity_id: ns.id, role: 'subject' });
  const r = generateBriefing(store, orgA, cs, {});
  assert.ok(r.warnings.some((w) => /Old: stale/.test(w)));
  assert.ok(r.warnings.some((w) => /Never fetched: not retrieved/.test(w)));
  assert.ok(r.warnings.some((w) => /licence.*unknown/.test(w)));
  const otherOrg = store.globalAll('organizations').find((o) => o.id !== orgA).id;
  const foreignEntity = store.list(otherOrg, 'entities')[0];
  const mixed = store.insert(orgA, 'cases', { case_type: 'investigation', title: 'mixed', status: 'open', priority: 'normal', created_by: 'x' });
  store.insert(orgA, 'case_entities', { case_id: mixed.id, entity_id: foreignEntity.id, role: 'subject' }); // forged link
  assert.throws(() => generateBriefing(store, orgA, mixed, {}), /Link at least one entity/, 'foreign entity is invisible to org A queries');
});

test('matching: normalization, identifiers, explanations, determinism', () => {
  assert.deepEqual(normalizeName('Müller & Söhne GmbH'), ['muller', 'and', 'sohne']);
  assert.deepEqual(normalizeName('ACME, Inc.'), ['acme']);
  assert.deepEqual(normalizeName('Ltd.'), ['ltd'], 'a name made only of legal-form words is kept');
  assert.equal(normalizeIdentifier(' de-mo 12/3 '), 'DEMO123');
  assert.ok(jaroWinkler('martha', 'marhta') > 0.95);
  const list = [{ id: 'l1', list_id: 'L', name: 'Zed Holdings', aliases: ['Zeta Trading'], identifiers: [{ type: 'registration_id', value: 'AB-123' }], jurisdiction: 'Cyprus' }];
  const mk = (o) => screenEntity({ name: 'Unrelated Name', aliases: [], identifiers: [], jurisdiction: null, ...o }, list);
  assert.equal(mk({}).length, 0);
  const viaId = mk({ identifiers: [{ type: 'registration_id', value: 'ab 123' }] });
  assert.equal(viaId.length, 1, 'an exact identifier agreement surfaces a candidate even when the names differ');
  assert.equal(viaId[0].band, 'strong_candidate');
  assert.ok(viaId[0].name_score < 0.5, 'and the explanation shows the names do not resemble each other');
  const viaAlias = mk({ name: 'Zeta Trading Ltd', jurisdiction: 'Cyprus', identifiers: [{ type: 'registration_id', value: 'AB-123' }] });
  assert.equal(viaAlias[0].band, 'strong_candidate');
  assert.equal(viaAlias[0].matched_list_name, 'Zeta Trading');
  assert.deepEqual(screenEntity({ name: 'Zeta Trading', aliases: [], identifiers: [] }, list), screenEntity({ name: 'Zeta Trading', aliases: [], identifiers: [] }, list), 'deterministic');
  const conflict = screenEntity({ name: 'Zed Holdings', aliases: [], identifiers: [{ type: 'registration_id', value: 'ZZ-999' }], jurisdiction: 'Malta' }, list)[0];
  assert.ok(conflict, 'conflicts never drop a candidate');
  assert.ok(conflict.conflicts.length === 2 && conflict.score < conflict.name_score);
});
