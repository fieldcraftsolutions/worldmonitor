import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';
import { Store } from '../server/store.js';
import { parseCsv, parseSdn, extractIdentifiers, loadList, importFromUrls } from '../server/ingest/ofac-sdn.js';
import { screenEntity } from '../server/matching.js';

const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'fixtures', 'sdn-synthetic');
const sdn = fs.readFileSync(path.join(dir, 'sdn.csv'), 'utf8');
const alt = fs.readFileSync(path.join(dir, 'alt.csv'), 'utf8');

test('csv parser handles quotes, embedded commas, CRLF and rejects unterminated fields', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n'), [['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
  assert.throws(() => parseCsv('a,"oops'), /unterminated/);
});

test('SDN fixture parses: names, aliases, identifiers, vessel flag, nulls', () => {
  const e = parseSdn(sdn, alt);
  assert.equal(e.length, 4);
  const trading = e.find((x) => x.name === 'DEMO TRADING FZE, LLC');
  assert.deepEqual(trading.aliases.sort(), ['DEMO TRADE FZE', 'DEMO TRADING CO']);
  assert.deepEqual(trading.identifiers, [{ type: 'registration_id', value: 'DEMO-AE-0001' }, { type: 'tax_id', value: '77-DEMO' }]);
  assert.equal(trading.entry_type, 'entity', '"-0-" type becomes the default');
  assert.equal(e.find((x) => x.name === 'MV DEMO VOYAGER').jurisdiction, 'Panama');
  assert.deepEqual(e.find((x) => x.name === 'MV DEMO VOYAGER').identifiers, [{ type: 'imo', value: '9999999' }]);
  assert.deepEqual(extractIdentifiers('nothing here'), []);
});

test('parser fails closed on malformed or empty input', () => {
  assert.throws(() => parseSdn('1,"X","-0- "\n'), /column count/);
  assert.throws(() => parseSdn(''), /no entries/);
});

test('imported entries drive the same explainable matcher', () => {
  const store = new Store();
  const list = loadList(store, parseSdn(sdn, alt), { name: 'fixture', publisher: 'p', origin: 'test_fixture', version: 'f', retrievedAt: new Date().toISOString() });
  assert.equal(list.origin, 'test_fixture');
  const entries = store.globalAll('watchlist_entries').map((x) => ({ ...x, list_id: list.id }));
  const hit = screenEntity({ name: 'Demo Trading FZE', aliases: [], identifiers: [{ type: 'registration_id', value: 'DEMO-AE-0001' }], jurisdiction: null }, entries);
  assert.equal(hit[0].band, 'strong_candidate');
  assert.ok(hit[0].features.some((f) => f.code === 'identifier_exact'));
  assert.throws(() => loadList(store, [], { name: 'x', publisher: 'p', origin: 'official_live_fake' }), /origin/);
});

test('fetch path (local server): success is labelled official_live; every failure writes nothing', async () => {
  let mode = 'ok';
  const srv = http.createServer((req, res) => {
    if (mode === 'down') { res.writeHead(503); return res.end('no'); }
    if (mode === 'empty') { res.writeHead(200); return res.end(''); }
    if (mode === 'garbage') { res.writeHead(200); return res.end('<html>maintenance</html>'); }
    res.writeHead(200, { 'content-type': 'text/csv' }); res.end(req.url.includes('alt') ? alt : sdn);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const store = new Store();
  const l = await importFromUrls(store, { sdnUrl: `${base}/sdn.csv`, altUrl: `${base}/alt.csv`, now: () => new Date('2026-10-01T00:00:00Z') });
  assert.equal(l.origin, 'official_live'); assert.equal(l.retrieved_at, '2026-10-01T00:00:00.000Z'); assert.equal(l.license_status, 'not_reviewed');
  assert.equal(store.globalAll('watchlist_lists').length, 1);
  for (const m of ['down', 'empty', 'garbage']) {
    mode = m;
    await assert.rejects(importFromUrls(store, { sdnUrl: `${base}/sdn.csv`, altUrl: `${base}/alt.csv` }), Error, m);
    assert.equal(store.globalAll('watchlist_lists').length, 1, `${m}: no partial/empty list was written`);
  }
  await new Promise((r) => srv.close(r));
});

test('screening can target a chosen list and records its origin', async () => {
  const { boot, A, entityByName } = await import('./helpers.js');
  const t = await boot();
  const list = loadList(t.store, parseSdn(sdn, alt), { name: 'fixture', publisher: 'p', origin: 'test_fixture', version: 'f', retrievedAt: new Date().toISOString() });
  const a = await t.as(A.analyst);
  const e = (await a.post('/api/entities', { legal_name: 'Demo Trading FZE', registration_id: 'DEMO-AE-0001' })).body;
  const s = await a.post(`/api/entities/${e.id}/screen`, { list_id: list.id });
  assert.equal(s.body.list_snapshot.origin, 'test_fixture');
  assert.equal(s.body.candidates[0].band, 'strong_candidate');
  assert.equal((await a.post(`/api/entities/${e.id}/screen`, { list_id: 'not-a-list-id' })).status, 400);
  const dflt = await a.post(`/api/entities/${e.id}/screen`);
  assert.equal(dflt.body.list_snapshot.origin, 'simulated_fixture', 'default stays the simulated list');
  await t.close();
});
