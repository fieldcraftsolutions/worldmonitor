import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, A, entityByName, PASSWORD, raw } from './helpers.js';

let t; before(async () => { t = await boot(); }); after(() => t.close());

test('unauthenticated requests are rejected; static shell is public but data is not', async () => {
  const c = t.client();
  for (const p of ['/api/entities', '/api/cases', '/api/sources', '/api/audit', '/api/dashboard', '/api/me']) {
    assert.equal((await c.get(p)).status, 401, p);
  }
  assert.equal((await c.post('/api/entities', { legal_name: 'x' })).status, 401);
});

test('tenant isolation: org A users cannot read or touch org B records, and vice versa', async () => {
  const a = await t.as(A.analyst);
  const b = await t.as(A.outsider);
  const bEntities = (await b.get('/api/entities')).body;
  assert.deepEqual(bEntities.map((e) => e.legal_name), ['Outsider Holdings (FICTIONAL)']);
  const outsiderId = bEntities[0].id;
  const aEntity = await entityByName(a, 'Northstar Maritime Group');

  // direct object reference attempts
  assert.equal((await a.get(`/api/entities/${outsiderId}`)).status, 404);
  assert.equal((await a.post(`/api/entities/${outsiderId}/screen`)).status, 404);
  assert.equal((await a.post(`/api/entities/${outsiderId}/aliases`, { alias_text: 'x' })).status, 404);
  assert.equal((await b.get(`/api/entities/${aEntity.id}`)).status, 404);
  assert.equal((await a.get('/api/entities?q=Outsider')).body.length, 0, 'search never leaks across orgs');

  // cross-tenant REFERENCES (the starter schema's child-owner divergence bug)
  const bSrc = (await b.post('/api/sources', { publisher: 'B', title: 'B source', source_type: 'other' })).body;
  const attach = await a.post('/api/findings', { entity_id: aEntity.id, source_id: bSrc.id, finding_type: 'source_fact', claim: 'borrowed source', verification_status: 'verified' });
  assert.equal(attach.status, 400, 'cannot cite another tenant\'s source');
  const rel = await a.post('/api/relationships', { source_entity_id: aEntity.id, target_entity_id: outsiderId, relationship_type: 'x' });
  assert.equal(rel.status, 400, 'cannot link to another tenant\'s entity');
  const cs = await a.post('/api/cases', { title: 'sneaky', entity_ids: [outsiderId] });
  assert.equal(cs.status, 400);

  // caller-supplied org_id is ignored
  const spoof = await a.post('/api/entities', { legal_name: 'Spoof Co', org_id: (await b.get('/api/me')).body.user.org_id });
  assert.equal(spoof.status, 201);
  assert.equal((await b.get('/api/entities?q=Spoof')).body.length, 0);

  // audit logs are per-org
  const bAudit = (await b.get('/api/audit?limit=500')).body;
  assert.ok(bAudit.every((e) => e.org_id === (b.user.org_id)));
  assert.equal(bAudit.some((e) => e.metadata?.legal_name === 'Spoof Co'), false);
});

test('roles: viewer is read-only; analyst cannot disposition; reviewer can', async () => {
  const viewer = await t.as(A.viewer);
  const analyst = await t.as(A.analyst);
  assert.equal((await viewer.get('/api/entities')).status, 200);
  for (const [m, p, b] of [['post', '/api/entities', { legal_name: 'Nope' }], ['post', '/api/sources', { publisher: 'p', title: 't' }], ['post', '/api/cases', { title: 'c' }]]) {
    assert.equal((await viewer[m](p, b)).status, 403, `${p} forbidden for viewer`);
  }
  const ent = await entityByName(viewer, 'Bluehaven Logistics SA');
  assert.equal((await viewer.post(`/api/entities/${ent.id}/screen`)).status, 403);
  const cs = (await analyst.post('/api/cases', { title: 'Role test', case_type: 'screening_review', entity_ids: [ent.id] })).body;
  assert.equal((await analyst.post(`/api/cases/${cs.id}/disposition`, { disposition: 'inconclusive', rationale: 'a sufficiently long rationale here' })).status, 403);
});

test('CSRF: mutating requests need the token and a same-origin Origin', async () => {
  const a = await t.as(A.analyst);
  assert.equal((await a.post('/api/entities', { legal_name: 'No Token Co' }, { csrf: false })).status, 403);
  assert.equal((await a.post('/api/entities', { legal_name: 'Bad Token Co' }, { headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  const evil = await raw(t.base, 'POST', '/api/entities', { headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ legal_name: 'Evil Origin Co' }) });
  assert.equal(evil.status, 403, 'cross-origin request rejected even with a valid token');
  assert.equal((await a.get('/api/entities?q=Evil Origin')).body.length, 0);
  assert.equal((await a.post('/api/entities', { legal_name: 'Good Co' })).status, 201);
  // non-JSON content type (form posts) rejected
  const res = await raw(t.base, 'POST', '/api/entities', { headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, 'content-type': 'application/x-www-form-urlencoded' }, body: 'legal_name=x' });
  assert.equal(res.status, 415);
  // another session's CSRF token is not valid for this one
  const a2 = await t.as(A.reviewer);
  assert.equal((await a.post('/api/entities', { legal_name: 'Cross Token' }, { headers: { 'x-csrf-token': a2.csrf } })).status, 403);
});

test('login: generic failure message, throttling, hashed storage, cookie flags', async () => {
  const c = t.client();
  const nouser = await c.login('nobody@nowhere.test', 'x');
  const badpw = await c.login(A.viewer, 'wrong-password');
  assert.equal(nouser.status, 401);
  assert.equal(badpw.status, 401);
  assert.deepEqual(nouser.body.error.message, badpw.body.error.message, 'no account enumeration');
  for (let i = 0; i < 6; i++) await c.login('lockme@harbor-demo.test', 'bad');
  assert.equal((await c.login('lockme@harbor-demo.test', 'bad')).status, 429);
  const ok = await t.client().login(A.analyst);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  // stored secrets are hashed
  const user = t.store.data.users.find((u) => u.email === A.analyst);
  assert.match(user.password_hash, /^scrypt\$/); assert.ok(!user.password_hash.includes(PASSWORD));
  const rawToken = cookie.split(';')[0].split('=')[1];
  assert.ok(!JSON.stringify(t.store.data.sessions).includes(rawToken), 'raw session token is never stored');
});

test('sessions expire and logout invalidates', async () => {
  const clock = { now: Date.now() };
  const t2 = await boot({ clock: () => new Date(clock.now) });
  const a = await t2.as(A.analyst);
  assert.equal((await a.get('/api/me')).status, 200);
  clock.now += 9 * 3600 * 1000;
  assert.equal((await a.get('/api/me')).status, 401, 'expired after 8h');
  clock.now = Date.now();
  const b = await t2.as(A.analyst);
  assert.equal((await b.post('/api/auth/logout')).status, 200);
  assert.equal((await b.get('/api/me')).status, 401);
  await t2.close();
});

test('responses: security headers, no CORS, no stack traces, malformed input handled', async () => {
  const a = await t.as(A.analyst);
  const r = await a.get('/api/entities');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const bad = await fetch(`${t.base}/api/entities`, { method: 'POST', headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400);
  const huge = await a.post('/api/entities', { legal_name: 'x'.repeat(150000) });
  assert.equal(huge.status, 413, 'oversize body rejected up front');
  assert.equal((await a.post('/api/entities', { legal_name: 'ok\u0000null' })).status, 400, 'control chars rejected');
  assert.equal((await a.post('/api/sources', { publisher: 'p', title: 't', url: 'javascript:alert(1)' })).status, 400, 'non-http URLs rejected');
  assert.equal((await a.get('/api/entities/not-a-real-id')).status, 404);
  for (const p of ['/../server/store.js', '/..%2f..%2fserver%2fstore.js', '/%2e%2e/package.json', '/....//server/store.js', '/..\\server\\store.js']) {
    const r = await raw(t.base, 'GET', p);
    assert.equal(r.status, 404, `static serving blocks traversal: ${p}`);
    assert.ok(!r.body.includes('export class Store'));
  }
  const data = await raw(t.base, 'GET', '/data/db.json');
  assert.equal(data.status, 404, 'database file is not under the web root');
});

test('stored markup is returned as inert JSON text (UI renders via textContent)', async () => {
  const a = await t.as(A.analyst);
  const name = '<img src=x onerror=alert(1)>Acme';
  const e = await a.post('/api/entities', { legal_name: name });
  assert.equal(e.body.legal_name, name);
  assert.match(e.headers.get('content-type'), /application\/json/);
});

test('client cannot create system-only finding types or unsupported claims', async () => {
  const a = await t.as(A.analyst);
  const ent = await entityByName(a, 'Bluehaven Logistics SA');
  const mk = (o) => a.post('/api/findings', { entity_id: ent.id, claim: 'c', ...o });
  assert.equal((await mk({ finding_type: 'ai_synthesis' })).status, 400, 'ai_synthesis is system-only');
  assert.equal((await mk({ finding_type: 'potential_match' })).status, 400);
  assert.equal((await mk({ finding_type: 'source_fact' })).status, 400, 'source_fact needs a source');
  assert.equal((await mk({ finding_type: 'analyst_assessment', verification_status: 'verified' })).status, 400, 'verified needs a source');
  assert.equal((await mk({ finding_type: 'analyst_assessment', verification_status: 'unverified' })).status, 201);
});

test('default demo password is detected in stored accounts (blocks network exposure)', async () => {
  const { Store } = await import('../server/store.js');
  const { seedDemo } = await import('../server/seed.js');
  const { defaultPasswordInUse, DEFAULT_DEMO_PASSWORD } = await import('../server/index.js');
  const weak = new Store(); await seedDemo(weak, { password: DEFAULT_DEMO_PASSWORD });
  const strong = new Store(); await seedDemo(strong, { password: 'a-different-password-7' });
  assert.equal(await defaultPasswordInUse(weak), true);
  assert.equal(await defaultPasswordInUse(strong), false);
});
