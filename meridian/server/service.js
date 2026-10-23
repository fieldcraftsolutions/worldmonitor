// Business logic. Handlers receive an `ac` (actor context): { store, user }.
// Every read and write is scoped to ac.user.org_id, and every state change
// appends an audit event.

import { requireCan } from './auth.js';
import { appendAudit, verifyChain } from './audit.js';
import { screenEntity, MATCH_CONFIG } from './matching.js';
import { generateBriefing, BriefingValidationError } from './briefing.js';
import * as v from './validate.js';

const org = (ac) => ac.user.org_id;
const audit = (ac, action, objectType, objectId, metadata) =>
  appendAudit(ac.store, org(ac), { actor: ac.user, action, objectType, objectId, metadata });

export const LIST_STALE_DAYS = 7;
const VERIFICATION = ['verified', 'corroborated', 'unverified', 'disputed', 'rejected', 'unknown'];
const SOURCE_REQUIRED = new Set(['verified', 'corroborated']);
const USER_FINDING_TYPES = ['source_fact', 'analyst_assessment', 'unknown', 'contradictory_evidence'];

function must(rec, what) { if (!rec) throw v.notFound(what); return rec; }

export function listFreshness(list, nowMs) {
  if (!list.retrieved_at) return { state: 'not_retrieved', age_days: null };
  const age = Math.floor((nowMs - Date.parse(list.retrieved_at)) / 86400000);
  return { state: age > LIST_STALE_DAYS ? 'stale' : 'current', age_days: age };
}

// ---------------------------------------------------------------- session / me
export function me(ac) {
  const o = ac.store.globalFind('organizations', (x) => x.id === org(ac));
  return { ...ac.user, organization: o?.name };
}

// ---------------------------------------------------------------- entities
function entityView(ac, e) {
  const aliases = ac.store.list(org(ac), 'aliases', (a) => a.entity_id === e.id);
  const identifiers = ac.store.list(org(ac), 'identifiers', (i) => i.entity_id === e.id);
  const screenings = ac.store.list(org(ac), 'screenings', (s) => s.entity_id === e.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const cases = ac.store.list(org(ac), 'case_entities', (l) => l.entity_id === e.id).map((l) => ac.store.get(org(ac), 'cases', l.case_id)).filter(Boolean);
  const latest = screenings[0];
  return { ...e, aliases, identifiers, latest_screening: latest ? { id: latest.id, ref: latest.ref, status: latest.status, created_at: latest.created_at, candidate_count: latest.candidates.length } : null, open_cases: cases.filter((c) => c.status !== 'closed').length };
}

export function listEntities(ac, { q, type, status }) {
  requireCan(ac.user, 'read');
  const needle = (q ?? '').trim().toLowerCase();
  const out = ac.store.list(org(ac), 'entities', (e) => (!type || e.entity_type === type) && (!status || e.record_status === status))
    .map((e) => entityView(ac, e))
    .filter((e) => !needle || [e.legal_name, e.ref, e.jurisdiction, e.registration_id, ...e.aliases.map((a) => a.alias_text), ...e.identifiers.map((i) => i.identifier_value)]
      .filter(Boolean).some((f) => f.toLowerCase().includes(needle)));
  return out.sort((a, b) => a.legal_name.localeCompare(b.legal_name));
}

export function getEntity(ac, id) {
  requireCan(ac.user, 'read');
  const e = must(ac.store.get(org(ac), 'entities', id), 'Entity');
  const o = org(ac);
  const s = ac.store;
  const rels = s.list(o, 'relationships', (r) => r.source_entity_id === id || r.target_entity_id === id);
  const name = (eid) => s.get(o, 'entities', eid)?.legal_name;
  const caseIds = s.list(o, 'case_entities', (l) => l.entity_id === id).map((l) => l.case_id);
  return {
    ...entityView(ac, e),
    relationships: rels.map((r) => ({ ...r, source_name: name(r.source_entity_id), target_name: name(r.target_entity_id) })),
    findings: s.list(o, 'findings', (f) => f.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    sources: [...new Set([
      ...s.list(o, 'findings', (f) => f.entity_id === id).map((f) => f.source_id),
      ...rels.map((r) => r.source_id),
      ...s.list(o, 'identifiers', (i) => i.entity_id === id).map((i) => i.source_id),
      ...s.list(o, 'aliases', (i) => i.entity_id === id).map((i) => i.source_id),
    ].filter(Boolean))].map((sid) => s.get(o, 'sources', sid)).filter(Boolean),
    screenings: s.list(o, 'screenings', (x) => x.entity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    cases: caseIds.map((cid) => s.get(o, 'cases', cid)).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

const ENTITY_TYPES = ['organization', 'person', 'vessel', 'other'];
export function createEntity(ac, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const rec = {
    entity_type: v.str(body.entity_type ?? 'organization', 'entity_type', { oneOf: ENTITY_TYPES }),
    legal_name: v.str(body.legal_name, 'legal_name', { max: 300 }),
    jurisdiction: v.str(body.jurisdiction, 'jurisdiction', { required: false, max: 100 }) ?? null,
    registration_id: v.str(body.registration_id, 'registration_id', { required: false, max: 100 }) ?? null,
    description: v.str(body.description, 'description', { required: false, max: 2000 }) ?? null,
    record_status: 'active', data_origin: 'analyst_entered', created_by: ac.user.id,
  };
  const e = ac.store.insert(org(ac), 'entities', rec);
  audit(ac, 'entity.created', 'entity', e.id, { ref: e.ref, legal_name: e.legal_name });
  return e;
}

export function addAlias(ac, entityId, body) {
  requireCan(ac.user, 'write');
  must(ac.store.get(org(ac), 'entities', entityId), 'Entity');
  const source_id = body.source_id ? v.id(body.source_id, 'source_id') : null;
  ac.store.assertRefs(org(ac), { source_id: ['sources', source_id] });
  const a = ac.store.insert(org(ac), 'aliases', { entity_id: entityId, alias_text: v.str(body.alias_text, 'alias_text', { max: 300 }), alias_type: v.str(body.alias_type ?? 'other', 'alias_type', { max: 40 }), source_id });
  audit(ac, 'alias.added', 'entity', entityId, { alias: a.alias_text });
  return a;
}

export function addIdentifier(ac, entityId, body) {
  requireCan(ac.user, 'write');
  must(ac.store.get(org(ac), 'entities', entityId), 'Entity');
  const source_id = body.source_id ? v.id(body.source_id, 'source_id') : null;
  ac.store.assertRefs(org(ac), { source_id: ['sources', source_id] });
  const i = ac.store.insert(org(ac), 'identifiers', {
    entity_id: entityId, identifier_type: v.str(body.identifier_type, 'identifier_type', { max: 40 }),
    identifier_value: v.str(body.identifier_value, 'identifier_value', { max: 100 }),
    issuing_jurisdiction: v.str(body.issuing_jurisdiction, 'issuing_jurisdiction', { required: false, max: 100 }) ?? null, source_id,
  });
  audit(ac, 'identifier.added', 'entity', entityId, { identifier_type: i.identifier_type });
  return i;
}

// ---------------------------------------------------------------- sources
const SOURCE_TYPES = ['official_list', 'government', 'registry', 'filing', 'news', 'company_site', 'analyst_note', 'other'];
const LICENSE = ['permitted', 'restricted', 'not_reviewed', 'unknown'];

export function listSources(ac) {
  requireCan(ac.user, 'read');
  return ac.store.list(org(ac), 'sources').sort((a, b) => a.title.localeCompare(b.title));
}

export function createSource(ac, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const retrieved = body.retrieved_at ? v.str(body.retrieved_at, 'retrieved_at', { max: 40 }) : undefined;
  if (retrieved !== undefined && Number.isNaN(Date.parse(retrieved))) throw v.badRequest('retrieved_at must be an ISO timestamp');
  if (retrieved !== undefined && Date.parse(retrieved) > ac.store.clock().getTime() + 60000) throw v.badRequest('retrieved_at cannot be in the future');
  const s = ac.store.insert(org(ac), 'sources', {
    publisher: v.str(body.publisher, 'publisher', { max: 300 }),
    title: v.str(body.title, 'title', { max: 500 }),
    url: v.url(body.url, 'url') ?? null,
    source_type: v.str(body.source_type ?? 'other', 'source_type', { oneOf: SOURCE_TYPES }),
    publication_date: v.date(body.publication_date, 'publication_date') ?? null,
    retrieved_at: retrieved ? new Date(retrieved).toISOString() : null,
    license_status: v.str(body.license_status ?? 'not_reviewed', 'license_status', { oneOf: LICENSE }),
    notes: v.str(body.notes, 'notes', { required: false, max: 2000 }) ?? null,
    data_origin: 'analyst_supplied',
  });
  audit(ac, 'source.registered', 'source', s.id, { ref: s.ref, title: s.title, retrieved: !!s.retrieved_at });
  return s;
}

export function listLists(ac) {
  requireCan(ac.user, 'read');
  const now = ac.store.clock().getTime();
  return ac.store.globalAll('watchlist_lists').map((l) => ({ ...l, freshness: listFreshness(l, now) }));
}

// ---------------------------------------------------------------- screening
export function runScreening(ac, entityId, body = {}) {
  requireCan(ac.user, 'screen');
  const e = must(ac.store.get(org(ac), 'entities', entityId), 'Entity');
  const now = ac.store.clock().getTime();
  const lists = ac.store.globalAll('watchlist_lists');
  const base = { entity_id: e.id, matcher: MATCH_CONFIG.version, thresholds: { surface: MATCH_CONFIG.surfaceThreshold, strong: MATCH_CONFIG.strongThreshold }, created_by: ac.user.id };

  if (!lists.length) {
    const s = ac.store.insert(org(ac), 'screenings', { ...base, list_id: null, list_snapshot: null, status: 'source_unavailable', candidates: [] });
    audit(ac, 'screening.failed', 'screening', s.id, { entity_id: e.id, reason: 'no reference list available' });
    return s;
  }
  const wanted = body.list_id ? v.id(body.list_id, 'list_id') : null;
  const list = wanted ? lists.find((l) => l.id === wanted) : lists.find((l) => l.origin === 'simulated_fixture') ?? lists[0];
  if (!list) throw v.badRequest('Unknown reference list.');
  const entries = ac.store.globalAll('watchlist_entries').filter((x) => x.list_id === list.id);
  const input = {
    name: e.legal_name, jurisdiction: e.jurisdiction,
    aliases: ac.store.list(org(ac), 'aliases', (a) => a.entity_id === e.id).map((a) => a.alias_text),
    identifiers: [
      ...ac.store.list(org(ac), 'identifiers', (i) => i.entity_id === e.id).map((i) => ({ type: i.identifier_type, value: i.identifier_value })),
      ...(e.registration_id ? [{ type: 'registration_id', value: e.registration_id }] : []),
    ],
  };
  const candidates = screenEntity(input, entries.map((x) => ({ ...x, list_id: list.id }))).map((c) => ({ ...c, id: ac.store.newId() }));
  const fresh = listFreshness(list, now);
  const s = ac.store.insert(org(ac), 'screenings', {
    ...base, list_id: list.id,
    list_snapshot: { name: list.name, origin: list.origin, version: list.version, retrieved_at: list.retrieved_at, freshness: fresh },
    status: candidates.length ? 'pending_review' : 'no_candidates', candidates,
  });
  audit(ac, 'screening.run', 'screening', s.id, { entity_id: e.id, ref: s.ref, list: list.name, list_origin: list.origin, list_freshness: fresh.state, candidates: candidates.length });
  return s;
}

export function listScreenings(ac, { status }) {
  requireCan(ac.user, 'read');
  return ac.store.list(org(ac), 'screenings', (s) => !status || s.status === status)
    .map((s) => ({ ...s, entity: ac.store.get(org(ac), 'entities', s.entity_id) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getScreening(ac, id) {
  requireCan(ac.user, 'read');
  const s = must(ac.store.get(org(ac), 'screenings', id), 'Screening');
  const e = ac.store.get(org(ac), 'entities', s.entity_id);
  return { ...s, entity: e && getEntity(ac, e.id) };
}

const CANDIDATE_STATUSES = ['inconclusive', 'escalated', 'not_a_match', 'retained_potential_match'];
// `confirmed` is deliberately not representable anywhere in the system.

function recomputeScreeningStatus(s) {
  if (!s.candidates.length) return s.status;
  if (s.candidates.some((c) => c.review_status === 'pending_review')) return 'pending_review';
  return s.candidates.some((c) => c.review_status === 'escalated') ? 'escalated' : 'reviewed';
}

function evidenceRefs(ac, body) {
  const finding_ids = v.idList(body.finding_ids, 'finding_ids');
  const source_ids = v.idList(body.source_ids, 'source_ids');
  for (const f of finding_ids) ac.store.assertRefs(org(ac), { finding_ids: ['findings', f] });
  for (const sId of source_ids) ac.store.assertRefs(org(ac), { source_ids: ['sources', sId] });
  return { finding_ids, source_ids };
}

function applyCandidateStatus(ac, screening, candidate, status, rationale, refs, extra = {}) {
  const prev = candidate.review_status;
  candidate.review_status = status;
  candidate.review = { by: ac.user.email, at: ac.store.now(), rationale: rationale ?? null, evidence: refs ?? null, ...extra };
  const updated = ac.store.update(org(ac), 'screenings', screening.id, { candidates: screening.candidates });
  const status2 = recomputeScreeningStatus(updated);
  if (status2 !== updated.status) ac.store.update(org(ac), 'screenings', screening.id, { status: status2 });
  audit(ac, 'screening.candidate_reviewed', 'screening', screening.id, {
    candidate_id: candidate.id, listed_name: candidate.listed_name, from: prev, to: status,
    list_freshness: screening.list_snapshot?.freshness?.state, list_origin: screening.list_snapshot?.origin, ...extra,
  });
}

export function reviewCandidate(ac, screeningId, candidateId, body) {
  requireCan(ac.user, 'screen');
  v.obj(body);
  const s = must(ac.store.get(org(ac), 'screenings', screeningId), 'Screening');
  const c = must(s.candidates.find((x) => x.id === candidateId), 'Candidate');
  const status = v.str(body.status, 'status', { oneOf: CANDIDATE_STATUSES });
  if (status === 'escalated') throw v.badRequest('Use the escalate action to escalate a candidate (it creates the case).');
  const rationale = v.str(body.rationale, 'rationale', { min: status === 'inconclusive' ? 10 : 20, max: 4000 });
  let refs = null;
  if (status === 'not_a_match') {
    requireCan(ac.user, 'disposition'); // closing a candidate as not-a-match needs a reviewer
    refs = evidenceRefs(ac, body);
    if (!refs.finding_ids.length && !refs.source_ids.length) throw v.badRequest('Closing a candidate as "not a match" requires at least one linked finding or source as the basis.');
    if (c.features.some((f) => f.code === 'identifier_exact') && body.acknowledge_identifier_agreement !== true) {
      throw v.badRequest('This candidate agrees on an identifier. Set acknowledge_identifier_agreement=true and explain in the rationale why it is nonetheless not the same entity.');
    }
  }
  applyCandidateStatus(ac, s, c, status, rationale, refs);
  return getScreening(ac, s.id);
}

export function escalateCandidate(ac, screeningId, candidateId, body = {}) {
  requireCan(ac.user, 'escalate');
  const s = must(ac.store.get(org(ac), 'screenings', screeningId), 'Screening');
  const c = must(s.candidates.find((x) => x.id === candidateId), 'Candidate');
  const e = must(ac.store.get(org(ac), 'entities', s.entity_id), 'Entity');
  const rationale = v.str(body.rationale, 'rationale', { min: 10, max: 4000, required: false }) ?? 'Escalated for compliance case review.';
  let cs = ac.store.list(org(ac), 'cases', (x) => x.screening_id === s.id && x.case_type === 'screening_review')[0];
  const created = !cs;
  if (!cs) {
    cs = ac.store.insert(org(ac), 'cases', {
      case_type: 'screening_review', title: `Screening review — ${e.legal_name}`, status: 'in_review', priority: c.band === 'strong_candidate' ? 'high' : 'normal',
      summary: `Candidate "${c.listed_name}" surfaced for ${e.legal_name} (score ${c.score.toFixed(2)}). Name or identifier resemblance only; not a confirmed match.`,
      screening_id: s.id, disposition: null, disposition_rationale: null, dispositions: [], created_by: ac.user.id, assigned_to: null, closed_at: null,
    });
    ac.store.insert(org(ac), 'case_entities', { case_id: cs.id, entity_id: e.id, role: 'subject' });
    audit(ac, 'case.created', 'case', cs.id, { ref: cs.ref, case_type: cs.case_type, from_screening: s.ref, case_id: cs.id });
  }
  c.case_id = cs.id;
  applyCandidateStatus(ac, s, c, 'escalated', rationale, null, { case_id: cs.id });
  return { case: ac.store.get(org(ac), 'cases', cs.id), created };
}

// ---------------------------------------------------------------- cases
const CASE_TYPES = ['screening_review', 'compliance', 'investigation', 'trade_risk', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const OPEN_STATUSES = ['open', 'in_review', 'escalated'];

function caseView(ac, c) {
  const o = org(ac);
  const entities = ac.store.list(o, 'case_entities', (l) => l.case_id === c.id).map((l) => ({ ...ac.store.get(o, 'entities', l.entity_id), role: l.role })).filter((e) => e.id);
  return { ...c, entities };
}

export function listCases(ac, { type, status }) {
  requireCan(ac.user, 'read');
  const types = type ? type.split(',') : null;
  return ac.store.list(org(ac), 'cases', (c) => (!types || types.includes(c.case_type)) && (!status || c.status === status))
    .map((c) => caseView(ac, c)).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createCase(ac, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const entityIds = v.idList(body.entity_ids, 'entity_ids');
  for (const eid of entityIds) ac.store.assertRefs(org(ac), { entity_ids: ['entities', eid] });
  const c = ac.store.insert(org(ac), 'cases', {
    case_type: v.str(body.case_type ?? 'investigation', 'case_type', { oneOf: CASE_TYPES }),
    title: v.str(body.title, 'title', { max: 300 }),
    status: 'open', priority: v.str(body.priority ?? 'normal', 'priority', { oneOf: PRIORITIES }),
    summary: v.str(body.summary, 'summary', { required: false, max: 4000 }) ?? null,
    research_question: v.str(body.research_question, 'research_question', { required: false, max: 1000 }) ?? null,
    disposition: null, disposition_rationale: null, dispositions: [], created_by: ac.user.id, assigned_to: null, closed_at: null,
  });
  for (const eid of entityIds) ac.store.insert(org(ac), 'case_entities', { case_id: c.id, entity_id: eid, role: 'subject' });
  audit(ac, 'case.created', 'case', c.id, { ref: c.ref, case_type: c.case_type, entity_ids: entityIds, case_id: c.id });
  return caseView(ac, c);
}

export function getCase(ac, id) {
  requireCan(ac.user, 'read');
  const o = org(ac);
  const c = must(ac.store.get(o, 'cases', id), 'Case');
  const view = caseView(ac, c);
  const eids = new Set(view.entities.map((e) => e.id));
  const findings = ac.store.list(o, 'findings', (f) => f.case_id === id || eids.has(f.entity_id));
  const sourceIds = new Set(findings.map((f) => f.source_id).filter(Boolean));
  const screening = c.screening_id ? ac.store.get(o, 'screenings', c.screening_id) : null;
  const origin = c.origin_case_id ? ac.store.get(o, 'cases', c.origin_case_id) : null;
  return {
    ...view,
    findings,
    sources: [...sourceIds].map((sid) => ac.store.get(o, 'sources', sid)).filter(Boolean),
    notes: ac.store.list(o, 'case_notes', (n) => n.case_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    reports: ac.store.list(o, 'reports', (r) => r.case_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => ({ id: r.id, ref: r.ref, title: r.title, generated_at: r.generated_at, status: r.status })),
    screening, origin_case: origin && { id: origin.id, ref: origin.ref, title: origin.title },
    child_cases: ac.store.list(o, 'cases', (x) => x.origin_case_id === id).map((x) => ({ id: x.id, ref: x.ref, title: x.title, status: x.status, case_type: x.case_type })),
    timeline: ac.store.list(o, 'audit_events', (e) => e.object_id === id || e.metadata?.case_id === id).sort((a, b) => a.seq - b.seq),
  };
}

export function updateCase(ac, id, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const c = must(ac.store.get(org(ac), 'cases', id), 'Case');
  const patch = {};
  if (body.status !== undefined) {
    patch.status = v.str(body.status, 'status', { oneOf: OPEN_STATUSES });
    if (c.status === 'closed') throw v.conflict('A closed case cannot be reopened through this endpoint.');
  }
  if (body.priority !== undefined) patch.priority = v.str(body.priority, 'priority', { oneOf: PRIORITIES });
  if (body.summary !== undefined) patch.summary = v.str(body.summary, 'summary', { max: 4000, required: false }) ?? null;
  if (body.research_question !== undefined) patch.research_question = v.str(body.research_question, 'research_question', { max: 1000, required: false }) ?? null;
  if (body.assigned_to !== undefined) {
    const uid = body.assigned_to ? v.id(body.assigned_to, 'assigned_to') : null;
    if (uid && !ac.store.globalFind('users', (u) => u.id === uid && u.org_id === org(ac))) throw v.badRequest('assigned_to must be a member of your organization');
    patch.assigned_to = uid;
  }
  const u = ac.store.update(org(ac), 'cases', id, patch);
  audit(ac, 'case.updated', 'case', id, { case_id: id, changes: Object.fromEntries(Object.keys(patch).map((k) => [k, { from: c[k] ?? null, to: patch[k] }])) });
  return caseView(ac, u);
}

export function addNote(ac, caseId, body) {
  requireCan(ac.user, 'write');
  must(ac.store.get(org(ac), 'cases', caseId), 'Case');
  const n = ac.store.insert(org(ac), 'case_notes', { case_id: caseId, body: v.str(body.body, 'body', { max: 4000 }), author: ac.user.email, author_id: ac.user.id });
  audit(ac, 'case.note_added', 'case', caseId, { case_id: caseId, note_id: n.id });
  return n;
}

export function linkEntity(ac, caseId, body) {
  requireCan(ac.user, 'write');
  must(ac.store.get(org(ac), 'cases', caseId), 'Case');
  const eid = v.id(body.entity_id, 'entity_id');
  ac.store.assertRefs(org(ac), { entity_id: ['entities', eid] });
  const role = v.str(body.role ?? 'subject', 'role', { max: 40 });
  if (ac.store.list(org(ac), 'case_entities', (l) => l.case_id === caseId && l.entity_id === eid && l.role === role).length) throw v.conflict('Entity is already linked with that role.');
  const l = ac.store.insert(org(ac), 'case_entities', { case_id: caseId, entity_id: eid, role });
  audit(ac, 'case.entity_linked', 'case', caseId, { case_id: caseId, entity_id: eid, role });
  return l;
}

// Hand a compliance case to the Intelligence workspace. The investigation links
// the SAME entity records; nothing is copied.
export function openInvestigation(ac, caseId, body = {}) {
  requireCan(ac.user, 'write');
  const o = org(ac);
  const origin = must(ac.store.get(o, 'cases', caseId), 'Case');
  const existing = ac.store.list(o, 'cases', (c) => c.origin_case_id === caseId && c.case_type === 'investigation' && c.status !== 'closed')[0];
  if (existing) return { case: caseView(ac, existing), reused: true };
  const links = ac.store.list(o, 'case_entities', (l) => l.case_id === caseId);
  const subject = links[0] && ac.store.get(o, 'entities', links[0].entity_id);
  const inv = ac.store.insert(o, 'cases', {
    case_type: 'investigation', title: `Investigation — ${subject?.legal_name ?? origin.title}`, status: 'open', priority: origin.priority,
    summary: null, research_question: v.str(body.research_question, 'research_question', { required: false, max: 1000 }) ?? `What can be established, from stored and cited sources, about ${subject?.legal_name ?? 'the subject'} to help resolve ${origin.ref}?`,
    origin_case_id: caseId, disposition: null, disposition_rationale: null, dispositions: [], created_by: ac.user.id, assigned_to: null, closed_at: null,
  });
  for (const l of links) ac.store.insert(o, 'case_entities', { case_id: inv.id, entity_id: l.entity_id, role: l.role });
  audit(ac, 'case.investigation_opened', 'case', inv.id, { case_id: inv.id, origin_case_id: caseId, origin_ref: origin.ref, entity_ids: links.map((l) => l.entity_id) });
  audit(ac, 'case.handoff_to_investigation', 'case', caseId, { case_id: caseId, investigation_id: inv.id });
  return { case: caseView(ac, inv), reused: false };
}

const DISPOSITIONS = ['not_a_match', 'potential_match', 'escalated', 'inconclusive', 'other'];
const DISPOSITION_EFFECT = {
  not_a_match: { status: 'closed', candidate: 'not_a_match' },
  potential_match: { status: 'in_review', candidate: 'retained_potential_match' },
  escalated: { status: 'escalated', candidate: 'escalated' },
  inconclusive: { status: 'inconclusive', candidate: 'inconclusive' },
  other: { status: 'in_review', candidate: null },
};

export function recordDisposition(ac, caseId, body) {
  requireCan(ac.user, 'disposition');
  v.obj(body);
  const c = must(ac.store.get(org(ac), 'cases', caseId), 'Case');
  if (c.status === 'closed') throw v.conflict('This case is closed; its disposition cannot be changed.');
  const disposition = v.str(body.disposition, 'disposition', { oneOf: DISPOSITIONS }); // no "confirmed" option exists
  const rationale = v.str(body.rationale, 'rationale', { min: 20, max: 4000 });
  const refs = evidenceRefs(ac, body);
  const screening = c.screening_id ? ac.store.get(org(ac), 'screenings', c.screening_id) : null;
  if (disposition === 'not_a_match') {
    if (!refs.finding_ids.length && !refs.source_ids.length) throw v.badRequest('"Not a match" requires at least one linked finding or source as its basis.');
    const exact = screening?.candidates.some((x) => x.features.some((f) => f.code === 'identifier_exact'));
    if (exact && body.acknowledge_identifier_agreement !== true) throw v.badRequest('A candidate agrees on an identifier. Set acknowledge_identifier_agreement=true and address it in the rationale.');
  }
  const effect = DISPOSITION_EFFECT[disposition];
  const listState = screening?.list_snapshot;
  const entry = {
    disposition, rationale, evidence: refs, by: ac.user.email, at: ac.store.now(),
    basis_list: listState ? { name: listState.name, origin: listState.origin, freshness: listState.freshness.state } : null,
  };
  const updated = ac.store.update(org(ac), 'cases', caseId, {
    status: effect.status, disposition, disposition_rationale: rationale, dispositions: [...(c.dispositions ?? []), entry],
    closed_at: effect.status === 'closed' ? ac.store.now() : null,
  });
  if (screening && effect.candidate) {
    const fresh = ac.store.get(org(ac), 'screenings', screening.id);
    for (const cand of fresh.candidates.filter((x) => x.case_id === caseId)) {
      applyCandidateStatus(ac, fresh, cand, effect.candidate, rationale, refs, { via_case: caseId });
    }
  }
  audit(ac, 'case.disposition_recorded', 'case', caseId, {
    case_id: caseId, disposition, from_status: c.status, to_status: effect.status, evidence: refs,
    list_origin: listState?.origin ?? null, list_freshness: listState?.freshness?.state ?? null, rationale_chars: rationale.length,
  });
  return caseView(ac, updated);
}

// ---------------------------------------------------------------- findings
export function createFinding(ac, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const entity_id = body.entity_id ? v.id(body.entity_id, 'entity_id') : null;
  const case_id = body.case_id ? v.id(body.case_id, 'case_id') : null;
  const source_id = body.source_id ? v.id(body.source_id, 'source_id') : null;
  if (!entity_id && !case_id) throw v.badRequest('A finding must reference an entity or a case.');
  ac.store.assertRefs(org(ac), { entity_id: ['entities', entity_id], case_id: ['cases', case_id], source_id: ['sources', source_id] });
  const finding_type = v.str(body.finding_type, 'finding_type', { oneOf: USER_FINDING_TYPES });
  const verification_status = v.str(body.verification_status ?? 'unverified', 'verification_status', { oneOf: VERIFICATION });
  if (finding_type === 'source_fact' && !source_id) throw v.badRequest('A source-backed fact must cite a source. Use "analyst_assessment" for unsourced judgement.');
  if (SOURCE_REQUIRED.has(verification_status) && !source_id) throw v.badRequest(`Status "${verification_status}" requires a cited source.`);
  const f = ac.store.insert(org(ac), 'findings', {
    entity_id, case_id, source_id, finding_type, verification_status,
    claim: v.str(body.claim, 'claim', { max: 2000 }), confidence: v.num(body.confidence, 'confidence') ?? null,
    analyst_notes: v.str(body.analyst_notes, 'analyst_notes', { required: false, max: 2000 }) ?? null, created_by: ac.user.id,
  });
  audit(ac, 'finding.created', 'finding', f.id, { case_id, entity_id, finding_type, verification_status, has_source: !!source_id });
  return f;
}

export function updateFinding(ac, id, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const f = must(ac.store.get(org(ac), 'findings', id), 'Finding');
  const verification_status = v.str(body.verification_status, 'verification_status', { oneOf: VERIFICATION });
  if (SOURCE_REQUIRED.has(verification_status) && !f.source_id) throw v.badRequest(`Status "${verification_status}" requires a cited source.`);
  const note = v.str(body.analyst_notes, 'analyst_notes', { required: false, max: 2000 });
  const u = ac.store.update(org(ac), 'findings', id, { verification_status, ...(note ? { analyst_notes: note } : {}) });
  audit(ac, 'finding.verification_changed', 'finding', id, { case_id: f.case_id, from: f.verification_status, to: verification_status });
  return u;
}

// ---------------------------------------------------------------- relationships / graph
export function createRelationship(ac, body) {
  requireCan(ac.user, 'write');
  v.obj(body);
  const s = v.id(body.source_entity_id, 'source_entity_id');
  const t = v.id(body.target_entity_id, 'target_entity_id');
  if (s === t) throw v.badRequest('A relationship needs two different entities.');
  const source_id = body.source_id ? v.id(body.source_id, 'source_id') : null;
  ac.store.assertRefs(org(ac), { source_entity_id: ['entities', s], target_entity_id: ['entities', t], source_id: ['sources', source_id] });
  const verification_status = v.str(body.verification_status ?? 'unverified', 'verification_status', { oneOf: VERIFICATION });
  if (SOURCE_REQUIRED.has(verification_status) && !source_id) throw v.badRequest(`Status "${verification_status}" requires a cited source.`);
  const r = ac.store.insert(org(ac), 'relationships', {
    source_entity_id: s, target_entity_id: t, relationship_type: v.str(body.relationship_type, 'relationship_type', { max: 60 }),
    source_id, verification_status, confidence: v.num(body.confidence, 'confidence') ?? null,
    analyst_notes: v.str(body.analyst_notes, 'analyst_notes', { required: false, max: 2000 }) ?? null, created_by: ac.user.id,
  });
  audit(ac, 'relationship.created', 'relationship', r.id, { source_entity_id: s, target_entity_id: t, verification_status, has_source: !!source_id });
  return r;
}

export function updateRelationship(ac, id, body) {
  requireCan(ac.user, 'write');
  const r = must(ac.store.get(org(ac), 'relationships', id), 'Relationship');
  const verification_status = v.str(body.verification_status, 'verification_status', { oneOf: VERIFICATION });
  if (SOURCE_REQUIRED.has(verification_status) && !r.source_id) throw v.badRequest(`Status "${verification_status}" requires a cited source.`);
  const u = ac.store.update(org(ac), 'relationships', id, { verification_status });
  audit(ac, 'relationship.verification_changed', 'relationship', id, { from: r.verification_status, to: verification_status });
  return u;
}

export function graph(ac, entityId, depth = 1) {
  requireCan(ac.user, 'read');
  const o = org(ac);
  must(ac.store.get(o, 'entities', entityId), 'Entity');
  const nodeIds = new Set([entityId]);
  const edges = new Map();
  let frontier = [entityId];
  for (let d = 0; d < Math.min(Math.max(depth, 1), 3); d++) {
    const next = [];
    for (const rel of ac.store.list(o, 'relationships', (r) => frontier.includes(r.source_entity_id) || frontier.includes(r.target_entity_id))) {
      edges.set(rel.id, rel);
      for (const id of [rel.source_entity_id, rel.target_entity_id]) if (!nodeIds.has(id)) { nodeIds.add(id); next.push(id); }
    }
    frontier = next;
  }
  return {
    center: entityId,
    nodes: [...nodeIds].map((id) => { const e = ac.store.get(o, 'entities', id); return { id, ref: e.ref, name: e.legal_name, jurisdiction: e.jurisdiction }; }),
    edges: [...edges.values()].map((r) => ({ id: r.id, source: r.source_entity_id, target: r.target_entity_id, type: r.relationship_type, verification_status: r.verification_status, confidence: r.confidence, has_source: !!r.source_id, source_id: r.source_id })),
  };
}

// ---------------------------------------------------------------- briefings
export function createBriefing(ac, caseId, deps = {}) {
  requireCan(ac.user, 'briefing');
  const c = must(ac.store.get(org(ac), 'cases', caseId), 'Case');
  let report;
  try {
    report = generateBriefing(ac.store, org(ac), c, { actor: ac.user, provider: deps.provider });
  } catch (err) {
    if (err instanceof BriefingValidationError) {
      audit(ac, 'report.generation_rejected', 'case', caseId, { case_id: caseId, problems: err.details.map((p) => p.code) });
    }
    throw err;
  }
  const saved = ac.store.insert(org(ac), 'reports', report);
  audit(ac, 'report.generated', 'report', saved.id, { case_id: caseId, ref: saved.ref, generator: report.generator.name, claims: report.citation_check.claims_total, warnings: report.warnings.length });
  return saved;
}

export function listReports(ac) {
  requireCan(ac.user, 'read');
  return ac.store.list(org(ac), 'reports').sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => ({
    id: r.id, ref: r.ref, title: r.title, case_id: r.case_id, generated_at: r.generated_at, generated_by: r.generated_by,
    status: r.status, generator: r.generator, claims: r.citation_check.claims_total, warnings: r.warnings.length,
  }));
}

export function getReport(ac, id) {
  requireCan(ac.user, 'read');
  return must(ac.store.get(org(ac), 'reports', id), 'Report');
}

// ---------------------------------------------------------------- audit / dashboard
export function listAudit(ac, { object_id, limit }) {
  requireCan(ac.user, 'read');
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return ac.store.list(org(ac), 'audit_events', (e) => !object_id || e.object_id === object_id || e.metadata?.case_id === object_id)
    .sort((a, b) => b.seq - a.seq).slice(0, n);
}

export function auditVerify(ac) {
  requireCan(ac.user, 'read');
  return verifyChain(ac.store, org(ac));
}

export function dashboard(ac) {
  requireCan(ac.user, 'read');
  const o = org(ac);
  const s = ac.store;
  const screenings = s.list(o, 'screenings');
  const cases = s.list(o, 'cases');
  const findings = s.list(o, 'findings');
  const rels = s.list(o, 'relationships');
  const pending = screenings.flatMap((x) => x.candidates.filter((c) => c.review_status === 'pending_review'));
  const claimFindings = findings.filter((f) => ['source_fact', 'contradictory_evidence'].includes(f.finding_type));
  const now = s.clock().getTime();
  return {
    entities: s.list(o, 'entities').length,
    screenings_run: screenings.length,
    candidates_pending_review: pending.length,
    open_screening_cases: cases.filter((c) => c.case_type === 'screening_review' && c.status !== 'closed').length,
    open_investigations: cases.filter((c) => c.case_type === 'investigation' && c.status !== 'closed').length,
    sources: s.list(o, 'sources').length,
    sources_not_retrieved: s.list(o, 'sources', (x) => !x.retrieved_at).length,
    findings: findings.length,
    sourced_claim_pct: claimFindings.length ? Math.round((100 * claimFindings.filter((f) => f.source_id).length) / claimFindings.length) : null,
    relationships: rels.length,
    relationships_with_source_pct: rels.length ? Math.round((100 * rels.filter((r) => r.source_id).length) / rels.length) : null,
    reports: s.list(o, 'reports').length,
    lists: s.globalAll('watchlist_lists').map((l) => ({ id: l.id, name: l.name, origin: l.origin, freshness: listFreshness(l, now) })),
  };
}

// Single source of truth for what is real, simulated, or absent. The UI renders
// this verbatim; tests pin it so the claims cannot drift from the code.
export const INTEGRATIONS = [
  { id: 'auth', name: 'Authentication, roles and sessions', status: 'implemented', detail: 'scrypt passwords, hashed session tokens, CSRF, login throttling, 3 roles. Local accounts only: no SSO/MFA.' },
  { id: 'tenancy', name: 'Organization isolation', status: 'implemented', detail: 'Every query is org-scoped; cross-tenant references are rejected. Covered by automated tests.' },
  { id: 'audit', name: 'Hash-chained audit log', status: 'implemented', detail: 'Append-only per organization; tampering is detectable. Not externally anchored.' },
  { id: 'persistence', name: 'Persistence', status: 'demo', detail: 'Local JSON file. A hardened Postgres/Supabase schema is provided and RLS-tested separately; the app is not wired to it yet.' },
  { id: 'screening_list', name: 'Screening reference list', status: 'simulated', detail: 'Invented fictional parties. Says nothing about any real person or company. NOT a sanctions list.' },
  { id: 'matching', name: 'Candidate matching', status: 'implemented', detail: 'Real, explainable heuristic matcher (untuned; not evaluated against a labelled test set).' },
  { id: 'ofac', name: 'OFAC SDN / Consolidated Screening List', status: 'not_connected', detail: 'No official data has been fetched. An experimental SDN CSV parser exists and is tested on a synthetic fixture only; live format, terms and licence are unverified.' },
  { id: 'ai', name: 'AI briefing generation', status: 'simulated', detail: 'Deterministic template over stored records. No language model is connected. Output is validated for citations and verdict language, ready for a model provider later.' },
  { id: 'monitoring', name: 'Scheduled refresh / change monitoring', status: 'not_connected', detail: 'Not built.' },
];
export const system = (ac) => { requireCan(ac.user, 'read'); return { integrations: INTEGRATIONS, match_config: MATCH_CONFIG, list_stale_days: LIST_STALE_DAYS }; };
