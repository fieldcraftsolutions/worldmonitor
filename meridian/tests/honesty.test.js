// Guards against over-claiming: what the app says is live/simulated must match the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, A, entityByName } from './helpers.js';
import { Store } from '../server/store.js';

test('integration registry: nothing claims to be a live official feed or a real LLM', async () => {
  const t = await boot();
  const a = await t.as(A.viewer);
  const { integrations } = (await a.get('/api/system')).body;
  const by = Object.fromEntries(integrations.map((i) => [i.id, i]));
  assert.equal(by.ofac.status, 'not_connected');
  assert.equal(by.ai.status, 'simulated');
  assert.equal(by.screening_list.status, 'simulated');
  assert.equal(by.monitoring.status, 'not_connected');
  assert.notEqual(by.persistence.status, 'implemented', 'JSON-file persistence is a demo store');
  assert.ok(!integrations.some((i) => i.status === 'live'), 'no capability is claimed as live');
  await t.close();
});

test('seed data: everything is labelled fictional/simulated; no live list or retrieved official source', async () => {
  const t = await boot();
  assert.ok(t.store.globalAll('watchlist_lists').every((l) => l.origin === 'simulated_fixture'));
  const a = await t.as(A.analyst);
  const ents = (await a.get('/api/entities')).body;
  assert.ok(ents.every((e) => e.data_origin === 'demo_fictional'));
  const srcs = (await a.get('/api/sources')).body;
  const ofac = srcs.find((s) => /ofac/i.test(s.publisher));
  assert.equal(ofac.retrieved_at, null, 'the OFAC reference is recorded as never retrieved');
  assert.equal(ofac.data_origin, 'official_reference_only');
  assert.ok(srcs.filter((s) => s.url && !/ofac\.treasury\.gov/.test(s.url)).every((s) => new URL(s.url).hostname.endsWith('.invalid')), 'all demo URLs use the reserved .invalid TLD');
  await t.close();
});

test('stale reference list is flagged on the screening, the dashboard and the briefing', async () => {
  const clock = { now: Date.now() };
  const t = await boot({ clock: () => new Date(clock.now) });
  const a = await t.as(A.analyst);
  clock.now += 10 * 86400000;                        // 10 days later (sessions last 8h, so sign in again)
  const a2 = await t.as(A.analyst);
  const volga = await entityByName(a2, 'Volga Meridian Trading');
  const s = (await a2.post(`/api/entities/${volga.id}/screen`)).body;
  assert.equal(s.list_snapshot.freshness.state, 'stale');
  assert.equal((await a2.get('/api/dashboard')).body.lists[0].freshness.state, 'stale');
  const esc = (await a2.post(`/api/screenings/${s.id}/candidates/${s.candidates[0].id}/escalate`, {})).body;
  const rpt = (await a2.post(`/api/cases/${esc.case.id}/briefing`)).body;
  assert.ok(rpt.warnings.some((w) => /stale/.test(w)), 'briefing warns the list is stale');
  const rev = await t.as(A.reviewer);
  const d = (await rev.post(`/api/cases/${esc.case.id}/disposition`, { disposition: 'inconclusive', rationale: 'Decision taken against a stale list; revisit after refresh.' })).body;
  assert.equal(d.dispositions[0].basis_list.freshness, 'stale', 'the disposition records the freshness of the list it relied on');
  await t.close();
});

test('with no reference list, screening reports source_unavailable (never "no candidates")', async () => {
  const t = await boot();
  t.store.data.watchlist_lists = []; t.store.data.watchlist_entries = [];
  const a = await t.as(A.analyst);
  const e = await entityByName(a, 'Asterion Components Ltd.');
  const s = (await a.post(`/api/entities/${e.id}/screen`)).body;
  assert.equal(s.status, 'source_unavailable');
  assert.deepEqual(s.candidates, []);
  const audit = (await a.get('/api/audit')).body.map((x) => x.action);
  assert.ok(audit.includes('screening.failed'));
  await t.close();
});

test('the no-confirmed-match rule: the only reachable candidate states exclude "confirmed"', async () => {
  const t = await boot();
  const a = await t.as(A.reviewer);
  const e = await entityByName(a, 'Volga Meridian Trading');
  const s = (await a.post(`/api/entities/${e.id}/screen`)).body;
  const base = `/api/screenings/${s.id}/candidates/${s.candidates[0].id}`;
  const seen = new Set();
  for (const status of ['inconclusive', 'retained_potential_match']) {
    const r = await a.post(`${base}/review`, { status, rationale: 'Exploring the allowed state transitions for the test.' });
    assert.equal(r.status, 200); seen.add(r.body.candidates[0].review_status);
  }
  await a.post(`${base}/escalate`, {});
  seen.add((await a.get(`/api/screenings/${s.id}`)).body.candidates[0].review_status);
  assert.deepEqual([...seen].sort(), ['escalated', 'inconclusive', 'retained_potential_match']);
  assert.ok(![...seen].some((x) => /confirm/.test(x)));
  await t.close();
});

test('persistence round-trip: restart keeps data and the audit chain verifies', async () => {
  const os = await import('node:os'); const fs = await import('node:fs'); const path = await import('node:path');
  const { seedDemo } = await import('../server/seed.js');
  const { verifyChain } = await import('../server/audit.js');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-')), 'db.json');
  const s1 = new Store({ file }); const { orgA } = await seedDemo(s1, { password: 'x-test-password' });
  const s2 = new Store({ file });
  assert.equal(s2.list(orgA.id, 'entities').length, s1.list(orgA.id, 'entities').length);
  assert.equal(verifyChain(s2, orgA.id).ok, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'database file is owner-only');
  fs.rmSync(path.dirname(file), { recursive: true });
});
