// EXPERIMENTAL: parser/loader for the legacy OFAC SDN CSV layout.
//
//   sdn.csv: ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type,
//            Tonnage, GRT, Vess_flag, Vess_owner, Remarks      ("-0-" means empty)
//   alt.csv: ent_num, alt_num, alt_type, alt_name, alt_remarks
//
// WHAT HAS AND HAS NOT BEEN VERIFIED
//   - Tested ONLY against a synthetic fixture (tests/fixtures/sdn-synthetic) and
//     a local HTTP server. The column layout above is from OFAC's published
//     legacy file description as understood by the author; it has NOT been
//     checked against a live download (the build sandbox cannot reach OFAC).
//   - Terms of use / licensing have NOT been reviewed: lists are loaded with
//     license_status "not_reviewed".
//   - Remarks-based identifier extraction is a heuristic that will miss formats.
//   - Fail closed: any fetch/parse problem aborts WITHOUT writing a list, so a
//     failed refresh can never look like an empty (clean) list.
//
// Origin labelling: a list is marked "official_live" only when it was fetched
// over HTTPS by this script; --fixture loads are marked "test_fixture".

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Store } from '../store.js';

export const OFAC_URLS = {
  sdn: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
  alt: 'https://www.treasury.gov/ofac/downloads/alt.csv',
  page: 'https://ofac.treasury.gov/sanctions-list-service',
};
const MAX_BYTES = 50 * 1024 * 1024;

export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (q) throw new Error('unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const nul = (v) => { const s = String(v ?? '').trim(); return s === '' || s === '-0-' ? null : s; };

const ID_PATTERNS = [
  [/Registration ID\s+([A-Z0-9][A-Z0-9\-./]*)/gi, 'registration_id'],
  [/Business Registration Number\s+([A-Z0-9][A-Z0-9\-./]*)/gi, 'registration_id'],
  [/Tax ID No\.?\s+([A-Z0-9][A-Z0-9\-./]*)/gi, 'tax_id'],
  [/\bIMO\s+(\d{7})\b/gi, 'imo'],
];
export function extractIdentifiers(remarks) {
  const out = [];
  for (const [re, type] of ID_PATTERNS) for (const m of String(remarks ?? '').matchAll(re)) out.push({ type, value: m[1].replace(/[.;,]+$/, '') });
  return out;
}

export function parseSdn(sdnCsv, altCsv = '') {
  const alts = new Map();
  for (const r of parseCsv(altCsv)) {
    if (r.length < 4) continue;
    const name = nul(r[3]); if (!name) continue;
    (alts.get(r[0]) ?? alts.set(r[0], []).get(r[0])).push(name);
  }
  const entries = [];
  for (const r of parseCsv(sdnCsv)) {
    if (r.length < 12) throw new Error(`unexpected column count ${r.length} (expected 12); refusing to guess`);
    const name = nul(r[1]);
    if (!name) throw new Error(`row ${r[0]} has no name`);
    entries.push({
      name, aliases: alts.get(r[0]) ?? [], identifiers: extractIdentifiers(r[11]),
      jurisdiction: nul(r[9]), program: nul(r[3]), entry_type: nul(r[2]) ?? 'entity', source_ref: `SDN:${r[0]}`,
    });
  }
  if (!entries.length) throw new Error('no entries parsed; refusing to create an empty list');
  return entries;
}

export function loadList(store, entries, { name, publisher, origin, version, url: listUrl = null, retrievedAt }) {
  if (!['official_live', 'test_fixture'].includes(origin)) throw new Error('origin must be official_live or test_fixture');
  const list = store.globalInsert('watchlist_lists', {
    name, publisher, url: listUrl, origin, version, retrieved_at: retrievedAt, license_status: 'not_reviewed', entry_count: entries.length,
    notes: origin === 'test_fixture' ? 'Synthetic fixture in the SDN CSV layout. Not real data.' : 'Loaded by the experimental SDN importer; format, terms and licence not independently verified.',
  });
  for (const e of entries) store.globalInsert('watchlist_entries', { ...e, list_id: list.id });
  return list;
}

export async function fetchText(u, { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  const res = await fetchImpl(u, { headers: { 'User-Agent': 'MeridianIntelligence-demo/0.2 (+analyst research tool)' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch ${u} failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error(`fetch ${u}: response too large`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`fetch ${u}: response too large`);
  if (!buf.length) throw new Error(`fetch ${u}: empty response`);
  return buf.toString('utf8');
}

export async function importFromUrls(store, { sdnUrl = OFAC_URLS.sdn, altUrl = OFAC_URLS.alt, fetchImpl, now = () => new Date() } = {}) {
  const [sdn, alt] = await Promise.all([fetchText(sdnUrl, { fetchImpl }), fetchText(altUrl, { fetchImpl })]);
  const entries = parseSdn(sdn, alt);                       // throws before anything is written
  const retrievedAt = now().toISOString();
  return loadList(store, entries, { name: 'OFAC SDN list (experimental import)', publisher: 'U.S. Department of the Treasury, OFAC', origin: 'official_live', version: retrievedAt.slice(0, 10), url: OFAC_URLS.page, retrievedAt });
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const file = path.resolve(process.env.MERIDIAN_DB ?? path.join(here, '..', '..', 'data', 'db.json'));
  const store = new Store({ file });
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--fixture') {
      const dir = path.resolve(args[1] ?? path.join(here, '..', '..', 'tests', 'fixtures', 'sdn-synthetic'));
      const entries = parseSdn(fs.readFileSync(path.join(dir, 'sdn.csv'), 'utf8'), fs.readFileSync(path.join(dir, 'alt.csv'), 'utf8'));
      const l = loadList(store, entries, { name: 'Synthetic SDN-format fixture (TEST)', publisher: 'Meridian test fixture', origin: 'test_fixture', version: 'fixture', retrievedAt: new Date().toISOString() });
      console.log(`Loaded ${entries.length} synthetic entries as "${l.name}" (origin: test_fixture). Restart the server to see it.`);
    } else if (args[0] === '--fetch') {
      const l = await importFromUrls(store);
      console.log(`Imported ${l.entry_count} entries (origin: official_live, retrieved ${l.retrieved_at}). Terms/licence NOT reviewed. Restart the server.`);
    } else {
      console.log('Usage: node server/ingest/ofac-sdn.js --fixture [dir] | --fetch   (stop the server first)');
    }
  } catch (e) {
    console.error(`IMPORT FAILED, nothing was written: ${e.message}`);
    process.exit(1);
  }
}
