// Org-scoped JSON-file store. This is the demo persistence layer; the Postgres
// schema in supabase/schema.sql is the intended production equivalent.
//
// Authorization invariant: tenant collections are only reachable through methods
// that require an org id, and a record from another org is indistinguishable
// from a missing one. Handlers never see raw collections.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { badRequest } from './validate.js';

export const TENANT = [
  'entities', 'aliases', 'identifiers', 'sources', 'relationships', 'findings',
  'cases', 'case_entities', 'case_notes', 'screenings', 'reports', 'audit_events',
];
const GLOBAL = ['organizations', 'users', 'sessions', 'watchlist_lists', 'watchlist_entries'];

const PREFIX = { entities: 'ENT', cases: 'CASE', screenings: 'SCR', reports: 'RPT', sources: 'SRC' };

export class Store {
  constructor({ file = null, clock = () => new Date() } = {}) {
    this.file = file;
    this.clock = clock;
    this.data = { counters: {} };
    for (const c of [...TENANT, ...GLOBAL]) this.data[c] = [];
    if (file && fs.existsSync(file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  now() { return this.clock().toISOString(); }
  newId() { return crypto.randomUUID(); }

  // ---- global (non-tenant) collections: orgs, users, sessions, reference lists
  globalAll(coll) { return structuredClone(this.data[coll]); }
  globalFind(coll, pred) { const r = this.data[coll].find(pred); return r && structuredClone(r); }
  globalInsert(coll, rec) {
    const row = { id: this.newId(), created_at: this.now(), ...rec };
    this.data[coll].push(row);
    this.persist();
    return structuredClone(row);
  }
  globalUpdate(coll, id, patch) {
    const row = this.data[coll].find((r) => r.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    this.persist();
    return structuredClone(row);
  }
  globalDelete(coll, pred) {
    const before = this.data[coll].length;
    this.data[coll] = this.data[coll].filter((r) => !pred(r));
    if (this.data[coll].length !== before) this.persist();
  }

  // ---- tenant collections
  assertTenant(coll) {
    if (!TENANT.includes(coll)) throw new Error(`${coll} is not a tenant collection`);
  }
  list(orgId, coll, pred = () => true) {
    this.assertTenant(coll);
    if (!orgId) throw new Error('org id required');
    return this.data[coll].filter((r) => r.org_id === orgId && pred(r)).map((r) => structuredClone(r));
  }
  get(orgId, coll, id) {
    this.assertTenant(coll);
    if (!orgId) throw new Error('org id required');
    const r = this.data[coll].find((x) => x.org_id === orgId && x.id === id);
    return r && structuredClone(r);
  }
  nextRef(orgId, coll) {
    const key = `${orgId}:${coll}`;
    this.data.counters[key] = (this.data.counters[key] || 0) + 1;
    return `${PREFIX[coll]}-${String(this.data.counters[key]).padStart(4, '0')}`;
  }
  insert(orgId, coll, rec) {
    this.assertTenant(coll);
    if (!orgId) throw new Error('org id required');
    const row = { id: this.newId(), created_at: this.now(), ...rec, org_id: orgId };
    if (PREFIX[coll] && !row.ref) row.ref = this.nextRef(orgId, coll);
    this.data[coll].push(row);
    this.persist();
    return structuredClone(row);
  }
  update(orgId, coll, id, patch) {
    this.assertTenant(coll);
    if (coll === 'audit_events') throw new Error('audit_events are append-only');
    const row = this.data[coll].find((x) => x.org_id === orgId && x.id === id);
    if (!row) return undefined;
    const { id: _i, org_id: _o, created_at: _c, ...safe } = patch; // identity fields are immutable
    Object.assign(row, safe, { updated_at: this.now() });
    this.persist();
    return structuredClone(row);
  }

  // Referenced records must live in the same org. This is the application-level
  // twin of the composite foreign keys in the Postgres schema: it stops a client
  // from attaching its rows to another tenant's parent record.
  assertRefs(orgId, refs) {
    for (const [field, [coll, value]] of Object.entries(refs)) {
      if (value === undefined || value === null) continue;
      if (!this.get(orgId, coll, value)) throw badRequest(`${field} does not reference a record in your organization`);
    }
  }
}
