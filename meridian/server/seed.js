// Fictional demo dataset. Every organization, person, company, registry, URL and
// identifier below is invented. URLs use the reserved ".invalid" TLD so they can
// never resolve. The only real URL is an official-reference page that is
// explicitly recorded as "not retrieved".

import path from 'node:path';
import url from 'node:url';
import { Store } from './store.js';
import { hashPassword } from './auth.js';
import { appendAudit } from './audit.js';

export const DEMO_LIST = {
  name: 'Meridian Demo Restricted-Party List (FICTIONAL)',
  publisher: 'Meridian demo fixture — not a government source',
  url: null,
  origin: 'simulated_fixture',
  version: 'demo-fixture-1',
  license_status: 'permitted',
  notes: 'Invented records used to exercise the matching workflow. It says nothing about any real person or company.',
};

const L = (name, o = {}) => ({ name, aliases: [], identifiers: [], jurisdiction: null, program: 'DEMO-PROGRAM', ...o });
export const DEMO_LIST_ENTRIES = [
  L('Volga-Meridian Trade Co.', { aliases: ['Volga Meridian Trading LLC'], jurisdiction: 'Türkiye', program: 'DEMO-PROG-A', identifiers: [{ type: 'registration_id', value: 'DEMO-TR-7781' }] }),
  L('Northstar Maritime Group Holdings', { jurisdiction: 'Marshall Islands', program: 'DEMO-PROG-B', identifiers: [{ type: 'registration_id', value: 'DEMO-MH-5521' }] }),
  L('Alta Vista Metal Trading FZE', { aliases: ['Altavista Metals'], jurisdiction: 'United Arab Emirates', program: 'DEMO-PROG-A', identifiers: [{ type: 'registration_id', value: 'DEMO-AE-3302' }] }),
  L('Kestrel Freight Svcs', { jurisdiction: 'United Kingdom', program: 'DEMO-PROG-C', identifiers: [{ type: 'registration_id', value: 'DEMO-GB-1100' }] }),
  L('Crimson Ledger Partners', { jurisdiction: 'Cyprus' }),
  L('Baltic Anchor Shipping', { jurisdiction: 'Estonia' }),
  L('Orion Bay Chemicals', { jurisdiction: 'Singapore' }),
  L('Sable River Mining Corp', { jurisdiction: 'Canada' }),
  L('Tidewater Aviation Parts', { jurisdiction: 'Malta' }),
];

const DAY = 86400000;

export async function seedDemo(store, { password }) {
  const now = store.clock().getTime();
  const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
  const day = (daysAgo) => iso(daysAgo).slice(0, 10);

  // --- reference list (global, not tenant-owned)
  const list = store.globalInsert('watchlist_lists', { ...DEMO_LIST, retrieved_at: iso(0), entry_count: DEMO_LIST_ENTRIES.length });
  for (const e of DEMO_LIST_ENTRIES) store.globalInsert('watchlist_entries', { ...e, list_id: list.id });

  // --- orgs and users
  const orgA = store.globalInsert('organizations', { name: 'Harbor Demo Compliance Ltd (FICTIONAL)' });
  const orgB = store.globalInsert('organizations', { name: 'Second Demo Org (FICTIONAL)' });
  const mk = async (email, display_name, role, org) => store.globalInsert('users', {
    email, display_name, role, org_id: org.id, password_hash: await hashPassword(password),
  });
  const analyst = await mk('analyst@harbor-demo.test', 'Avery Analyst', 'analyst', orgA);
  await mk('reviewer@harbor-demo.test', 'Riley Reviewer', 'reviewer', orgA);
  await mk('viewer@harbor-demo.test', 'Val Viewer', 'viewer', orgA);
  const outsider = await mk('outsider@other-demo.test', 'Olive Outsider', 'reviewer', orgB);

  const sys = { id: null, email: 'system (seed)' };
  const A = orgA.id;
  const ins = (coll, rec) => store.insert(A, coll, rec);
  const entity = (legal_name, jurisdiction, description, extra = {}) => ins('entities', {
    entity_type: 'organization', legal_name, jurisdiction, description, registration_id: null,
    record_status: 'active', data_origin: 'demo_fictional', created_by: analyst.id, ...extra,
  });

  // --- sources
  const registry = ins('sources', { publisher: 'Demo Registry Office (fictional)', title: 'Company registry extract: Northstar Maritime Group (FICTIONAL)', url: 'https://registry.demo.invalid/pa/northstar-maritime', source_type: 'registry', publication_date: day(40), retrieved_at: iso(6), license_status: 'permitted', notes: 'Invented document.', data_origin: 'demo_fictional' });
  const press = ins('sources', { publisher: 'Demo Shipping Gazette (fictional)', title: 'Trade press: routing changes among regional operators (FICTIONAL)', url: 'https://gazette.demo.invalid/2026/routing-changes', source_type: 'news', publication_date: day(21), retrieved_at: iso(5), license_status: 'not_reviewed', notes: 'Invented article.', data_origin: 'demo_fictional' });
  const site = ins('sources', { publisher: 'Volga Meridian Trading (fictional company site)', title: 'About us page (FICTIONAL)', url: 'https://volga-meridian.demo.invalid/about', source_type: 'company_site', publication_date: null, retrieved_at: iso(3), license_status: 'not_reviewed', notes: 'Invented page.', data_origin: 'demo_fictional' });
  ins('sources', { publisher: 'U.S. Department of the Treasury, OFAC', title: 'OFAC Sanctions List Service (reference page — NOT retrieved, NOT integrated)', url: 'https://ofac.treasury.gov/sanctions-list-service', source_type: 'official_list', publication_date: null, retrieved_at: null, license_status: 'not_reviewed', notes: 'Real official reference recorded for future ingestion. No data has been fetched from it.', data_origin: 'official_reference_only' });

  // --- entities
  const northstar = entity('Northstar Maritime Group', 'Panama', 'Regional shipping and logistics operator (fictional).', { registration_id: 'DEMO-PA-0418' });
  const asterion = entity('Asterion Components Ltd.', 'Germany', 'Industrial electronics distributor (fictional).');
  const volga = entity('Volga Meridian Trading', 'Türkiye', 'Commodities trading company (fictional).');
  const bluehaven = entity('Bluehaven Logistics SA', 'Uruguay', 'Freight forwarder (fictional).');
  const altavista = entity('Altavista Metals FZE', 'United Arab Emirates', 'Metals trading free-zone company (fictional).');
  const kestrel = entity('Kestrel Freight Services Ltd', 'United Kingdom', 'Freight services company (fictional).');
  const harbour = entity('Harbour Point Holdings', 'Cyprus', 'Holding company (fictional).');
  const seagate = entity('Seagate Terminals LLC', 'Panama', 'Port terminal operator (fictional).');
  const marlow = entity('Marlow & Finch Shipping Agency', 'Greece', 'Shipping agency (fictional).');

  const alias = (e, alias_text, alias_type = 'trading_name', source_id = null) => ins('aliases', { entity_id: e.id, alias_text, alias_type, source_id });
  alias(northstar, 'Northstar Maritime', 'short_name', registry.id);
  alias(volga, 'Volga Meridian Trading LLC', 'former_name', site.id);
  alias(altavista, 'Alta Vista Metals', 'trading_name');
  const ident = (e, identifier_type, identifier_value, issuing_jurisdiction, source_id = null) => ins('identifiers', { entity_id: e.id, identifier_type, identifier_value, issuing_jurisdiction, source_id });
  ident(northstar, 'registration_id', 'DEMO-PA-0418', 'Panama', registry.id);
  ident(altavista, 'registration_id', 'DEMO-AE-3302', 'United Arab Emirates');
  ident(kestrel, 'registration_id', 'DEMO-GB-9999', 'United Kingdom');

  // --- relationships (note the deliberate mix of verification states)
  const rel = (s, t, relationship_type, verification_status, source_id, confidence, analyst_notes) => ins('relationships', { source_entity_id: s.id, target_entity_id: t.id, relationship_type, verification_status, source_id, confidence, analyst_notes, created_by: analyst.id });
  rel(harbour, northstar, 'owner_of', 'corroborated', registry.id, 0.8, 'Shown as shareholder in the registry extract; second source still wanted.');
  rel(northstar, seagate, 'operates_at', 'unverified', null, 0.3, 'Mentioned in conversation only; no document yet.');
  rel(northstar, marlow, 'affiliate_of', 'disputed', press.id, 0.4, 'Article implies an affiliation; the registry extract does not support it.');

  // --- starter findings
  const finding = (e, claim, finding_type, verification_status, source_id, confidence, analyst_notes = null) => ins('findings', { entity_id: e.id, case_id: null, claim, finding_type, verification_status, source_id, confidence, analyst_notes, created_by: analyst.id });
  finding(northstar, 'Registered office is in Panama City (per registry extract).', 'source_fact', 'verified', registry.id, 0.9);
  finding(northstar, 'Ultimate beneficial ownership is not established by any stored source.', 'unknown', 'unknown', null, null, 'Needs authoritative beneficial-ownership data.');
  finding(volga, 'Company site states it trades grain and fertiliser.', 'source_fact', 'unverified', site.id, 0.5);

  // --- org B (isolation fixture)
  store.insert(orgB.id, 'entities', { entity_type: 'organization', legal_name: 'Outsider Holdings (FICTIONAL)', jurisdiction: 'Ireland', description: 'Belongs to a different organization; must never be visible to Harbor Demo users.', record_status: 'active', data_origin: 'demo_fictional', created_by: outsider.id });

  appendAudit(store, A, { actor: sys, action: 'seed.demo_data_loaded', objectType: 'organization', objectId: A, metadata: { note: 'Fictional demo dataset loaded' } });
  appendAudit(store, orgB.id, { actor: sys, action: 'seed.demo_data_loaded', objectType: 'organization', objectId: orgB.id, metadata: { note: 'Fictional demo dataset loaded' } });
  return { orgA, orgB, list };
}

// CLI: node server/seed.js --reset
if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const file = path.resolve(process.env.MERIDIAN_DB ?? path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'data', 'db.json'));
  if (process.argv.includes('--reset')) {
    const s = new Store({ file });
    s.data = new Store().data;
    await seedDemo(s, { password: process.env.MERIDIAN_DEMO_PASSWORD || 'meridian-demo-only' });
    console.log(`Seeded fictional demo data into ${file}`);
  } else {
    console.log('Pass --reset to (re)create the demo database.');
  }
}
