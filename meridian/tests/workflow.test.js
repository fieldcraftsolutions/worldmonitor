// The vertical slice from LLM_HANDOFF.md, driven over real HTTP:
// search entity -> screen -> escalate -> investigation (same entity) -> source +
// finding -> cited briefing -> reviewer disposition -> audit trail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, A, entityByName } from './helpers.js';

let t; before(async () => { t = await boot(); }); after(() => t.close());

test('end-to-end: screening to cited briefing to human disposition', async () => {
  const analyst = await t.as(A.analyst);
  const reviewer = await t.as(A.reviewer);

  // 1. search / select a fictional entity
  const volga = await entityByName(analyst, 'Volga Meridian Trading');
  assert.ok(volga, 'seeded entity is searchable');
  assert.equal(volga.data_origin, 'demo_fictional');

  // 2. screening surfaces a candidate, with reasons, conflicts and gaps
  const scr = await analyst.post(`/api/entities/${volga.id}/screen`);
  assert.equal(scr.status, 200);
  assert.equal(scr.body.status, 'pending_review');
  assert.equal(scr.body.list_snapshot.origin, 'simulated_fixture', 'screening is labelled simulated');
  const cand = scr.body.candidates[0];
  assert.match(cand.listed_name, /Volga/);
  assert.ok(cand.features.some((f) => f.code === 'name_similarity'));
  assert.ok(cand.gaps.some((g) => g.code === 'entity_no_identifiers'), 'missing identifiers are called out');
  assert.equal(cand.review_status, 'pending_review');

  // 3. escalate -> compliance case
  const esc = await analyst.post(`/api/screenings/${scr.body.id}/candidates/${cand.id}/escalate`, { rationale: 'Name resembles a listed party; identifiers not on file.' });
  assert.equal(esc.status, 200);
  const caseId = esc.body.case.id;
  assert.equal(esc.body.case.case_type, 'screening_review');

  // 4. hand off to Intelligence: the SAME entity record, no duplicate
  const inv = await analyst.post(`/api/cases/${caseId}/open-investigation`, {});
  assert.equal(inv.body.reused, false);
  const invCase = await analyst.get(`/api/cases/${inv.body.case.id}`);
  assert.equal(invCase.body.entities[0].id, volga.id, 'investigation references the same entity id');
  assert.equal(invCase.body.origin_case.id, caseId);
  const again = await analyst.post(`/api/cases/${caseId}/open-investigation`, {});
  assert.equal(again.body.reused, true, 'handoff is idempotent');
  const entityCount = (await analyst.get('/api/entities')).body.length;
  assert.equal(entityCount, 9, 'no entity was duplicated by the handoff');

  // 5. attach a source and a sourced finding
  const src = await analyst.post('/api/sources', {
    publisher: 'Demo Registry Office (fictional)', title: 'Registry extract for Volga Meridian (FICTIONAL)', url: 'https://registry.demo.invalid/tr/volga',
    source_type: 'registry', publication_date: '2026-09-01', retrieved_at: new Date().toISOString(), license_status: 'permitted',
  });
  assert.equal(src.status, 201);
  const fnd = await analyst.post('/api/findings', {
    entity_id: volga.id, case_id: inv.body.case.id, source_id: src.body.id, finding_type: 'source_fact',
    claim: 'Registry extract lists registration number DEMO-TR-0000, which differs from the listed party DEMO-TR-7781.', verification_status: 'verified',
  });
  assert.equal(fnd.status, 201);

  // 6. cited briefing from stored records only
  const rpt = await analyst.post(`/api/cases/${inv.body.case.id}/briefing`);
  assert.equal(rpt.status, 200);
  const r = rpt.body;
  assert.equal(r.generator.kind, 'simulated_ai');
  assert.equal(r.citation_check.passed, true);
  assert.equal(r.citation_check.claims_total, r.citation_check.claims_cited);
  const cited = r.sections.flatMap((s) => s.items).find((i) => i.text.includes('DEMO-TR-0000'));
  assert.ok(cited.citations.length === 1);
  assert.ok(r.source_register.some((s) => s.source_id === src.body.id && s.url === 'https://registry.demo.invalid/tr/volga'));
  assert.ok(r.source_register.some((s) => s.origin === 'simulated_fixture'), 'simulated list is in the register');
  assert.ok(r.warnings.some((w) => /SIMULATED/.test(w)));
  assert.match(r.disclaimer, /Not a legal or compliance determination/);
  assert.ok(r.sections.some((s) => s.heading === 'Unknowns and open questions'));
  assert.ok(r.generated_at);

  // 7. a reviewer records the disposition; analysts cannot
  const body = { disposition: 'inconclusive', rationale: 'Identifiers differ but ownership is still unresolved; keep open.', finding_ids: [fnd.body.id] };
  assert.equal((await analyst.post(`/api/cases/${caseId}/disposition`, body)).status, 403);
  const disp = await reviewer.post(`/api/cases/${caseId}/disposition`, body);
  assert.equal(disp.status, 200);
  assert.equal(disp.body.status, 'inconclusive');
  const scrAfter = await reviewer.get(`/api/screenings/${scr.body.id}`);
  assert.equal(scrAfter.body.candidates[0].review_status, 'inconclusive');

  // 8. audit trail captured every step, and the chain verifies
  const audit = (await reviewer.get('/api/audit?limit=500')).body.map((e) => e.action);
  for (const a of ['screening.run', 'screening.candidate_reviewed', 'case.created', 'case.investigation_opened', 'source.registered', 'finding.created', 'report.generated', 'case.disposition_recorded']) {
    assert.ok(audit.includes(a), `audit has ${a}`);
  }
  const verify = (await reviewer.get('/api/audit/verify')).body;
  assert.equal(verify.ok, true);
});

test('"not a match" needs reviewer role, rationale, evidence and identifier acknowledgement; "confirmed" cannot exist', async () => {
  const analyst = await t.as(A.analyst);
  const reviewer = await t.as(A.reviewer);
  const alta = await entityByName(analyst, 'Altavista Metals FZE');
  const scr = (await analyst.post(`/api/entities/${alta.id}/screen`)).body;
  const cand = scr.candidates[0];
  assert.equal(cand.band, 'strong_candidate');
  assert.ok(cand.features.some((f) => f.code === 'identifier_exact'));

  const base = `/api/screenings/${scr.id}/candidates/${cand.id}/review`;
  const rationale = 'Reviewed the registry details and found a different legal form and address.';
  assert.equal((await analyst.post(base, { status: 'not_a_match', rationale })).status, 403, 'analyst cannot close as not-a-match');
  assert.equal((await reviewer.post(base, { status: 'not_a_match', rationale })).status, 400, 'needs evidence');
  const src = (await analyst.get('/api/sources')).body[0];
  assert.equal((await reviewer.post(base, { status: 'not_a_match', rationale, source_ids: [src.id] })).status, 400, 'identifier agreement must be acknowledged');
  assert.equal((await reviewer.post(base, { status: 'not_a_match', rationale: 'too short', source_ids: [src.id], acknowledge_identifier_agreement: true })).status, 400, 'rationale too short');
  const ok = await reviewer.post(base, { status: 'not_a_match', rationale, source_ids: [src.id], acknowledge_identifier_agreement: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.candidates[0].review_status, 'not_a_match');

  for (const bad of ['confirmed', 'confirmed_match', 'sanctioned', 'clear']) {
    assert.equal((await reviewer.post(base, { status: bad, rationale })).status, 400, `${bad} is not a valid status`);
  }
});

test('a no-candidate screening is never presented as a clearance', async () => {
  const analyst = await t.as(A.analyst);
  const ast = await entityByName(analyst, 'Asterion Components Ltd.');
  const scr = (await analyst.post(`/api/entities/${ast.id}/screen`)).body;
  assert.equal(scr.status, 'no_candidates');
  assert.equal(scr.list_snapshot.origin, 'simulated_fixture');
  assert.ok(!JSON.stringify(scr).match(/\bclear(ed)?\b/i), 'screening payload never says clear');
});

test('weak name-only and conflicting-identifier candidates are explained, not hidden', async () => {
  const analyst = await t.as(A.analyst);
  const ns = await entityByName(analyst, 'Northstar Maritime Group');
  const s1 = (await analyst.post(`/api/entities/${ns.id}/screen`)).body;
  const c1 = s1.candidates.find((c) => /Northstar/.test(c.listed_name));
  assert.ok(c1, 'name resemblance surfaces for review');
  assert.ok(c1.conflicts.some((c) => c.code === 'jurisdiction_conflict'));

  const ke = await entityByName(analyst, 'Kestrel Freight Services Ltd');
  const s2 = (await analyst.post(`/api/entities/${ke.id}/screen`)).body;
  const c2 = s2.candidates.find((c) => /Kestrel/.test(c.listed_name));
  assert.ok(c2, 'Kestrel surfaces');
  assert.ok(c2.conflicts.some((c) => c.code === 'identifier_conflict'));
});
