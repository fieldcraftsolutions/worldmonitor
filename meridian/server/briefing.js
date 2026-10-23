// Source-grounded briefing generation.
//
// IMPORTANT: no language model is connected. The default provider is a
// deterministic template that only restates stored records. The architecture is
// built so a real LLM provider can be swapped in *without weakening controls*:
// whatever a provider returns is run through validateBriefing(), which rejects
// uncited claims, citations to unknown sources, and verdict language
// (sanctioned / clear / compliant / guilty / safe).

import { HttpError } from './validate.js';

export const GENERATOR = { name: 'deterministic-template', version: '1', kind: 'simulated_ai', model: null };

export const DISCLAIMER = 'Preliminary analyst aid. Not a legal or compliance determination and not evidence that any person or entity is, or is not, sanctioned or prohibited. Every statement must be independently verified and reviewed by an authorized human analyst before use.';

const CLAIM_KINDS = new Set(['source_fact', 'potential_match', 'contradictory_evidence', 'ai_synthesis']);
const VERDICT_PATTERNS = [
  /\bis\s+(not\s+)?sanctioned\b/i, /\bnot\s+sanctioned\b/i, /\b(is|are)\s+(fully\s+)?(clear|cleared|compliant|safe)\b/i,
  /\bno\s+risk\b/i, /\b(is|are)\s+guilty\b/i, /(?<!\b(?:not|no)\s+(?:a\s+)?)\bconfirmed\s+(?:sanctions\s+)?match\b/i, /\bclean\s+(screening|result)\b/i,
];

export class BriefingValidationError extends HttpError {
  constructor(problems) {
    super(422, 'briefing_rejected', 'Generated briefing failed source-integrity checks and was not saved.', problems);
  }
}

export const STALE_SOURCE_DAYS = 90;

function freshness(source, nowMs) {
  if (!source.retrieved_at) return { state: 'not_retrieved', note: 'No retrieval timestamp recorded' };
  const age = Math.floor((nowMs - Date.parse(source.retrieved_at)) / 86400000);
  return age > STALE_SOURCE_DAYS
    ? { state: 'stale', note: `Retrieved ${age} days ago` }
    : { state: 'current', note: age <= 0 ? 'Retrieved today' : `Retrieved ${age} day(s) ago` };
}

/** Collect only org-scoped stored records into a context for the provider. */
export function buildContext(store, orgId, caseRec, nowMs) {
  const links = store.list(orgId, 'case_entities', (r) => r.case_id === caseRec.id);
  const entities = links.map((l) => store.get(orgId, 'entities', l.entity_id)).filter(Boolean);
  const entityIds = new Set(entities.map((e) => e.id));
  const findings = store.list(orgId, 'findings', (f) => entityIds.has(f.entity_id) || f.case_id === caseRec.id);
  const relationships = store.list(orgId, 'relationships', (r) => entityIds.has(r.source_entity_id) || entityIds.has(r.target_entity_id));
  const screenings = store.list(orgId, 'screenings', (s) => entityIds.has(s.entity_id));
  const nameOf = (id) => store.get(orgId, 'entities', id)?.legal_name ?? '(unknown entity)';

  // source register: stored sources actually referenced + the reference lists screenings ran against
  const sourceIds = new Set([
    ...findings.map((f) => f.source_id), ...relationships.map((r) => r.source_id),
    ...store.list(orgId, 'identifiers', (i) => entityIds.has(i.entity_id)).map((i) => i.source_id),
  ].filter(Boolean));
  const sources = [...sourceIds].map((id) => store.get(orgId, 'sources', id)).filter(Boolean);
  const listIds = new Set(screenings.map((s) => s.list_id).filter(Boolean));
  const lists = [...listIds].map((id) => store.globalFind('watchlist_lists', (l) => l.id === id)).filter(Boolean);

  return {
    case: caseRec, entities, findings, relationships, screenings, sources, lists, nameOf,
    identifiers: store.list(orgId, 'identifiers', (i) => entityIds.has(i.entity_id)),
    aliases: store.list(orgId, 'aliases', (a) => entityIds.has(a.entity_id)),
    nowMs,
  };
}

/** Default provider: restates stored records only. */
export const deterministicProvider = {
  descriptor: GENERATOR,
  compose(ctx) {
    const ref = (srcId) => `S:${srcId}`;
    const sections = [];
    const item = (kind, text, o = {}) => ({ kind, text, authored_by: 'generator', verification_status: o.verification_status ?? null, source_refs: (o.source_ids ?? []).filter(Boolean).map(ref), record: o.record ?? null });

    sections.push({
      heading: 'Subject',
      items: ctx.entities.map((e) => item('record_summary', `${e.legal_name} (${e.ref}) — ${e.entity_type}, jurisdiction: ${e.jurisdiction ?? 'not recorded'}. Aliases on file: ${ctx.aliases.filter((a) => a.entity_id === e.id).map((a) => a.alias_text).join('; ') || 'none'}.`, { record: { entity_id: e.id } })),
    });

    const live = ctx.findings.filter((f) => f.verification_status !== 'rejected' && f.finding_type !== 'unknown');
    const factual = live.filter((f) => f.source_id && f.verification_status !== 'disputed');
    sections.push({
      heading: 'Source-backed statements',
      items: factual.length
        ? factual.map((f) => item(f.finding_type === 'ai_synthesis' ? 'ai_synthesis' : 'source_fact', f.claim, { source_ids: [f.source_id], verification_status: f.verification_status, record: { finding_id: f.id } }))
        : [{ kind: 'unknown', text: 'No source-backed findings are stored for this subject.', authored_by: 'generator', source_refs: [], verification_status: null, record: null }],
    });

    const disputed = live.filter((f) => f.verification_status === 'disputed');
    if (disputed.length) {
      sections.push({
        heading: 'Contradictory or disputed evidence',
        items: disputed.map((f) => item('contradictory_evidence', f.claim, { source_ids: [f.source_id], verification_status: 'disputed', record: { finding_id: f.id } })),
      });
    }

    const assess = live.filter((f) => !f.source_id && f.finding_type !== 'unknown');
    if (assess.length) {
      sections.push({
        heading: 'Analyst assessments without a stored source',
        items: assess.map((f) => ({ kind: 'analyst_assessment', text: f.claim, authored_by: 'analyst', verification_status: f.verification_status, source_refs: [], record: { finding_id: f.id } })),
      });
    }

    sections.push({
      heading: 'Relationships',
      items: ctx.relationships.length
        ? ctx.relationships.filter((r) => r.verification_status !== 'rejected').map((r) => {
          const text = `${ctx.nameOf(r.source_entity_id)} —[${r.relationship_type}]→ ${ctx.nameOf(r.target_entity_id)} (${r.verification_status}${r.source_id ? '' : ', no source attached'}).`;
          return r.source_id && r.verification_status !== 'disputed'
            ? item('source_fact', text, { source_ids: [r.source_id], verification_status: r.verification_status, record: { relationship_id: r.id } })
            : r.source_id
              ? item('contradictory_evidence', text, { source_ids: [r.source_id], verification_status: r.verification_status, record: { relationship_id: r.id } })
              : { kind: 'analyst_assessment', text, authored_by: 'analyst', source_refs: [], verification_status: r.verification_status, record: { relationship_id: r.id } };
        })
        : [{ kind: 'unknown', text: 'No relationships are recorded.', authored_by: 'generator', source_refs: [], verification_status: null, record: null }],
    });

    const scr = [];
    for (const s of ctx.screenings) {
      const list = ctx.lists.find((l) => l.id === s.list_id);
      const origin = list ? (list.origin === 'simulated_fixture' ? 'SIMULATED demo list' : list.origin) : 'unknown list';
      if (s.status === 'source_unavailable') {
        scr.push({ kind: 'unknown', text: `Screening ${s.ref} could not run: the reference list was unavailable. This is not a clear result.`, authored_by: 'generator', source_refs: [], verification_status: null, record: { screening_id: s.id } });
      } else if (!s.candidates.length) {
        scr.push({ kind: 'unknown', text: `Screening ${s.ref} against "${list?.name ?? 'unknown list'}" (${origin}) surfaced no candidates. This is not a clearance and not evidence of absence; coverage is limited to that list and its retrieval date.`, authored_by: 'generator', source_refs: list ? [`L:${list.id}`] : [], verification_status: null, record: { screening_id: s.id } });
      } else {
        for (const c of s.candidates) {
          scr.push({ kind: 'potential_match', text: `Candidate for review: "${c.matched_entity_name}" resembles listed "${c.listed_name}"${c.matched_list_name !== c.listed_name ? ` (matched on listed name/alias "${c.matched_list_name}")` : ''} (score ${c.score.toFixed(2)}, ${c.band.replace('_', ' ')}; analyst status: ${c.review_status.replace('_', ' ')}). Name or identifier resemblance is not a confirmed match. ${c.conflicts.length ? `Conflicts: ${c.conflicts.map((x) => x.label).join('; ')}. ` : ''}${c.gaps.length ? `Data gaps: ${c.gaps.map((x) => x.label).join('; ')}.` : ''}`.trim(), authored_by: 'generator', source_refs: [`L:${s.list_id}`], verification_status: null, record: { screening_id: s.id, list_entry_id: c.list_entry_id } });
        }
      }
    }
    sections.push({ heading: 'Screening context', items: scr.length ? scr : [{ kind: 'unknown', text: 'No screening has been run for this subject.', authored_by: 'generator', source_refs: [], verification_status: null, record: null }] });

    const unknowns = ctx.findings.filter((f) => f.finding_type === 'unknown');
    sections.push({
      heading: 'Unknowns and open questions',
      items: [
        ...unknowns.map((f) => ({ kind: 'unknown', text: f.claim, authored_by: 'analyst', source_refs: [], verification_status: f.verification_status, record: { finding_id: f.id } })),
        ...ctx.entities.filter((e) => !ctx.identifiers.some((i) => i.entity_id === e.id)).map((e) => ({ kind: 'unknown', text: `No identifiers are recorded for ${e.legal_name}; identity cannot be confirmed from names alone.`, authored_by: 'generator', source_refs: [], verification_status: null, record: { entity_id: e.id } })),
        ...ctx.relationships.filter((r) => ['unverified', 'unknown'].includes(r.verification_status)).map((r) => ({ kind: 'unknown', text: `Relationship ${ctx.nameOf(r.source_entity_id)} → ${ctx.nameOf(r.target_entity_id)} (${r.relationship_type}) is ${r.verification_status}.`, authored_by: 'generator', source_refs: [], verification_status: r.verification_status, record: { relationship_id: r.id } })),
      ],
    });
    return { sections };
  },
};

/**
 * Integrity checks applied to ANY provider's output. Returns a list of problems.
 */
export function validateBriefing(draft, ctx) {
  const problems = [];
  const knownSources = new Set(ctx.sources.map((s) => `S:${s.id}`));
  const knownLists = new Set(ctx.lists.map((l) => `L:${l.id}`));
  for (const sec of draft.sections ?? []) {
    for (const it of sec.items ?? []) {
      const where = `${sec.heading}: "${String(it.text).slice(0, 60)}"`;
      if (CLAIM_KINDS.has(it.kind) && !(it.source_refs?.length)) problems.push({ code: 'uncited_claim', where });
      for (const r of it.source_refs ?? []) {
        if (!knownSources.has(r) && !knownLists.has(r)) problems.push({ code: 'unknown_source_ref', where, ref: r });
      }
      if (it.authored_by === 'generator') {
        for (const p of VERDICT_PATTERNS) if (p.test(it.text)) problems.push({ code: 'verdict_language', where, pattern: String(p) });
      }
      if (it.kind === 'ai_synthesis' && it.verification_status === 'verified') problems.push({ code: 'ai_marked_verified', where });
    }
  }
  return problems;
}

export function generateBriefing(store, orgId, caseRec, { provider = deterministicProvider, actor } = {}) {
  const nowMs = store.clock().getTime();
  const ctx = buildContext(store, orgId, caseRec, nowMs);
  if (!ctx.entities.length) throw new HttpError(422, 'no_entities', 'Link at least one entity to the case before generating a briefing.');
  const draft = provider.compose(ctx);
  const problems = validateBriefing(draft, ctx);
  if (problems.length) throw new BriefingValidationError(problems);

  // Resolve refs to short citation labels and build the source register.
  const register = [];
  const label = new Map();
  const labelFor = (refKey) => {
    if (!label.has(refKey)) {
      const [type, id] = refKey.split(':');
      if (type === 'S') {
        const s = ctx.sources.find((x) => x.id === id);
        register.push({ cite: `[${register.length + 1}]`, kind: 'stored_source', source_id: s.id, ref: s.ref, publisher: s.publisher, title: s.title, url: s.url, source_type: s.source_type, publication_date: s.publication_date, retrieved_at: s.retrieved_at, license_status: s.license_status, origin: s.data_origin ?? 'analyst_supplied', freshness: freshness(s, nowMs) });
      } else {
        const l = ctx.lists.find((x) => x.id === id);
        const age = l.retrieved_at ? Math.floor((nowMs - Date.parse(l.retrieved_at)) / 86400000) : null;
        register.push({ cite: `[${register.length + 1}]`, kind: 'reference_list', list_id: l.id, publisher: l.publisher, title: l.name, url: l.url, version: l.version, retrieved_at: l.retrieved_at, license_status: l.license_status, origin: l.origin, freshness: { state: age === null ? 'not_retrieved' : age > 7 ? 'stale' : 'current', note: age === null ? 'No retrieval timestamp' : `Retrieved ${age} day(s) ago` } });
      }
      label.set(refKey, register[register.length - 1].cite);
    }
    return label.get(refKey);
  };
  const sections = draft.sections.map((sec) => ({
    heading: sec.heading,
    items: sec.items.map((it) => ({ ...it, citations: (it.source_refs ?? []).map(labelFor), source_refs: undefined })),
  }));

  const warnings = [];
  for (const r of register) {
    if (r.origin === 'simulated_fixture') warnings.push(`${r.title}: SIMULATED data — not a live sanctions or screening source.`);
    if (r.freshness.state !== 'current') warnings.push(`${r.title}: ${r.freshness.state.replace('_', ' ')} (${r.freshness.note}).`);
    if (r.license_status === 'not_reviewed' || r.license_status === 'unknown') warnings.push(`${r.title}: licence/terms status "${r.license_status}".`);
  }

  const claimItems = sections.flatMap((s) => s.items).filter((i) => CLAIM_KINDS.has(i.kind));
  return {
    case_id: caseRec.id,
    entity_ids: ctx.entities.map((e) => e.id),
    generated_at: store.now(),
    generated_by: actor?.email ?? 'system',
    generator: provider.descriptor,
    title: `Preliminary briefing — ${ctx.entities.map((e) => e.legal_name).join(', ')}`,
    status: 'draft_requires_human_review',
    sections,
    source_register: register,
    warnings,
    limitations: [
      'Built only from records stored in this workspace; nothing was fetched or inferred from outside sources.',
      'No language model produced this text. It is a deterministic restatement of stored records (simulated AI synthesis).',
      'Absence of a candidate is not evidence that a subject is clear.',
    ],
    disclaimer: DISCLAIMER,
    citation_check: { passed: true, claims_total: claimItems.length, claims_cited: claimItems.filter((i) => i.citations.length).length },
  };
}
