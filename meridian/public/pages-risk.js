import { h, toast, btn, pill, verifPill, originBadge, freshPill, panel, pageHead, notice, table, form, kv, timeline, icon, fmt, label } from './ui.js';
import { api } from './api.js';
import { canWrite } from './pages-shared.js';

const REVIEW_CLS = { pending_review: 'amber', inconclusive: 'blue', escalated: 'red', not_a_match: 'green', retained_potential_match: 'red' };
const BAND = { strong_candidate: ['Strong candidate', 'red'], possible_candidate: ['Possible candidate', 'amber'] };

// ------------------------------------------------------------------ screening queue
async function screening(ctx, route) {
  if (route.id) return screeningDetail(ctx, route);
  const [rows, ents, lists] = await Promise.all([api.get('/api/screenings'), api.get('/api/entities'), api.get('/api/lists')]);
  const write = canWrite(ctx);
  const pick = h('select', { class: 'inline-input', style: 'width:260px;margin:0', 'aria-label': 'Entity to screen' }, ents.map((e) => h('option', { value: e.id, selected: ctx.state.selected?.id === e.id }, `${e.legal_name} (${e.ref})`)));
  const listPick = h('select', { class: 'inline-input', style: 'width:320px;margin:0', 'aria-label': 'Reference list' }, lists.map((l) => h('option', { value: l.id }, `${l.origin === 'simulated_fixture' ? '[SIMULATED] ' : l.origin === 'test_fixture' ? '[TEST FIXTURE] ' : '[' + l.origin + '] '}${l.name}`)));
  const run = btn('Run screening', async () => { const s = await api.post(`/api/entities/${pick.value}/screen`, { list_id: listPick.value }); toast(`${s.ref}: ${label(s.status)}`); ctx.go(`risk/screening/${s.id}`); }, { primary: true, disabled: !write, title: write ? null : 'Your role is read-only' });
  const pending = rows.filter((s) => s.status === 'pending_review');
  return h('div', { class: 'stack' },
    pageHead('Risk & compliance', 'Screening queue', 'Candidates for human review. Nothing here is a determination.'),
    notice('warn', h('b', null, 'Simulated list. '), 'Screenings run against a fictional fixture list. A result of "no candidates" means only that nothing resembled the fictional entries; it is never a clearance.'),
    panel('Run a screening', 'Uses the entity’s name, aliases, identifiers and jurisdiction', h('div', { class: 'row pad' }, pick, listPick, run)),
    panel(`Awaiting review (${pending.length})`, 'Newest first', screeningTable(ctx, pending, 'Nothing is waiting for review.')),
    panel('All screenings', null, screeningTable(ctx, rows, 'No screenings have been run yet.')));
}

function screeningTable(ctx, rows, empty) {
  return table([
    { label: 'Entity', render: (s) => h('div', { class: 'entity' }, icon(s.entity?.legal_name), h('div', null, h('strong', null, s.entity?.legal_name ?? '(deleted)'), h('small', null, `${s.ref}`))) },
    { label: 'List', render: (s) => s.list_snapshot ? h('span', null, originBadge(s.list_snapshot.origin), ' ', freshPill(s.list_snapshot.freshness)) : pill('unavailable', 'red') },
    { label: 'Result', render: (s) => pill(s.status, s.status === 'pending_review' ? 'amber' : s.status === 'source_unavailable' ? 'red' : s.status === 'no_candidates' ? 'blue' : 'grey') },
    { label: 'Candidates', render: (s) => s.candidates.length },
    { label: 'Run', render: (s) => fmt(s.created_at) },
  ], rows, { empty, onRow: (s) => ctx.go(`risk/screening/${s.id}`) });
}

// ------------------------------------------------------------------ screening detail / candidate review
async function screeningDetail(ctx, route) {
  const s = await api.get(`/api/screenings/${route.id}`);
  const e = s.entity;
  ctx.selectEntity(e);
  const snap = s.list_snapshot;
  const head = pageHead('Risk & compliance · screening review', `${e.legal_name}`, `${s.ref} · run ${fmt(s.created_at)} · matcher ${s.matcher}`, btn('← Queue', () => ctx.go('risk/screening')), btn('Entity profile', () => ctx.go(`risk/entity/${e.id}`)));
  const listInfo = snap
    ? panel('Reference list used', 'The result is only as good as this list and its date', kv([['List', snap.name], ['Origin', originBadge(snap.origin)], ['Version', snap.version], ['Retrieved', `${fmt(snap.retrieved_at)}`], ['Freshness', freshPill(snap.freshness)]]))
    : notice('bad', h('b', null, 'Source unavailable. '), 'No reference list could be used. This is NOT a clear result.');
  const body = [head, listInfo];

  if (s.status === 'source_unavailable') return h('div', { class: 'stack' }, body);
  if (!s.candidates.length) {
    body.push(notice('info', h('b', null, 'No candidates surfaced '), `against "${snap.name}" (${snap.origin === 'simulated_fixture' ? 'SIMULATED fictional list' : snap.origin}) as retrieved ${fmt(snap.retrieved_at)}. `, h('b', null, 'This is not a clearance: '), 'other lists, other spellings and missing identifiers are not covered. Record any further checks as findings.'));
  }
  s.candidates.forEach((c, i) => body.push(candidateCard(ctx, s, e, c, i)));
  return h('div', { class: 'stack' }, body);
}

function compareTable(e, c) {
  const names = [e.legal_name, ...e.aliases.map((a) => a.alias_text)];
  const row = (k, a, b) => h('tr', null, h('th', null, k), h('td', null, a), h('td', null, b));
  const ids = (list) => list.length ? list.map((i) => `${label(i.type ?? i.identifier_type)}: ${i.value ?? i.identifier_value}`).join('; ') : h('span', { class: 'muted' }, 'none on record');
  return h('table', { class: 'cmp' }, h('tr', null, h('th', null, ''), h('td', null, h('b', null, 'Your record')), h('td', null, h('b', null, 'Listed record'))),
    row('Name', e.legal_name, c.listed_name),
    row('Aliases', names.slice(1).join('; ') || h('span', { class: 'muted' }, 'none'), c.listed_aliases.join('; ') || h('span', { class: 'muted' }, 'none')),
    row('Jurisdiction', e.jurisdiction ?? h('span', { class: 'muted' }, 'not recorded'), c.listed_jurisdiction ?? h('span', { class: 'muted' }, 'not recorded')),
    row('Identifiers', ids(e.identifiers), ids(c.listed_identifiers)),
    row('Program', '—', c.listed_program ?? '—'));
}

function candidateCard(ctx, s, e, c, i) {
  const [bandText, bandCls] = BAND[c.band];
  const write = canWrite(ctx);
  const reviewer = ctx.state.user.role === 'reviewer';
  const li = (items, empty) => items.length ? h('ul', null, items.map((x) => h('li', null, h('b', null, x.label + ': '), x.detail))) : h('p', { class: 'small muted', style: 'margin:0' }, empty);
  const actionHost = h('div');
  const evidence = [...e.findings.map((f) => [`f:${f.id}`, `Finding · ${f.claim.slice(0, 70)}`]), ...e.sources.map((x) => [`s:${x.id}`, `Source · ${x.ref} ${x.title.slice(0, 60)}`])];
  const hasExact = c.features.some((f) => f.code === 'identifier_exact');

  const reviewForm = (status, title) => () => actionHost.replaceChildren(panel(title, null, form([
    { name: 'rationale', label: 'Rationale (recorded in the audit log)', type: 'textarea', required: true, hint: status === 'inconclusive' ? 'At least 10 characters.' : 'At least 20 characters. State what was compared and why.' },
    ...(status === 'not_a_match' ? [
      { name: 'evidence', label: 'Basis: select at least one finding or source', type: 'multiselect', options: evidence, hint: 'Hold Ctrl/Cmd to select several. Register new sources on the Sources page first.' },
      ...(hasExact ? [{ name: 'ack', label: 'I acknowledge this candidate AGREES on an identifier and I have addressed it in the rationale', type: 'checkbox' }] : []),
    ] : []),
  ], { submit: 'Record decision', cancel: () => actionHost.replaceChildren(), onSubmit: async (d) => {
    const ev = d.evidence ?? [];
    await api.post(`/api/screenings/${s.id}/candidates/${c.id}/review`, { status, rationale: d.rationale, finding_ids: ev.filter((x) => x.startsWith('f:')).map((x) => x.slice(2)), source_ids: ev.filter((x) => x.startsWith('s:')).map((x) => x.slice(2)), acknowledge_identifier_agreement: d.ack === true });
    toast('Decision recorded and audited'); ctx.render();
  } })));

  const escalate = () => actionHost.replaceChildren(panel('Escalate to a compliance case', 'Creates (or reuses) a case and keeps this candidate linked', form([{ name: 'rationale', label: 'Why escalate?', type: 'textarea', required: true, hint: 'At least 10 characters.' }], { submit: 'Escalate', cancel: () => actionHost.replaceChildren(), onSubmit: async (d) => { const r = await api.post(`/api/screenings/${s.id}/candidates/${c.id}/escalate`, d); toast(`${r.created ? 'Created' : 'Reused'} ${r.case.ref}`); ctx.go(`risk/cases/${r.case.id}`); } })));

  return h('section', { class: 'panel cand', 'data-candidate': c.id },
    h('div', { class: 'cand-head' }, icon(c.listed_name), h('div', { class: 'grow' }, h('b', null, `Candidate ${i + 1}: ${c.listed_name}`), h('div', { class: 'small muted' }, `Resembles "${c.matched_entity_name}" · program ${c.listed_program ?? '—'}`)),
      h('div', null, h('div', { class: 'score' }, c.score.toFixed(2)), h('div', { class: 'small muted' }, `name only ${c.name_score.toFixed(2)}`)), pill(bandText, bandCls), pill(c.review_status, REVIEW_CLS[c.review_status])),
    h('div', { class: 'pad' }, notice('warn', h('b', null, 'Candidate for review, not a determination. '), 'Name or identifier resemblance does not establish that these are the same entity. The score is an untuned heuristic.')),
    h('div', { class: 'cand-body' },
      h('div', { style: 'grid-column:1/-1' }, h('h4', null, 'Side-by-side'), compareTable(e, c)),
      h('div', null, h('h4', null, 'Why it surfaced'), li(c.features, 'No supporting features.')),
      h('div', null, h('h4', null, 'Conflicting signals'), li(c.conflicts, 'None found. (Absence of conflict is not confirmation.)')),
      h('div', { style: 'grid-column:1/-1' }, h('h4', null, 'Data gaps limiting this comparison'), li(c.gaps, 'No gaps detected.'))),
    c.review ? h('div', { class: 'pad small' }, h('b', null, 'Last decision: '), `${label(c.review_status)} by ${c.review.by} on ${fmt(c.review.at)}. `, c.review.rationale ? `“${c.review.rationale}”` : '', c.case_id ? h('span', null, ' ', h('a', { onclick: () => ctx.go(`risk/cases/${c.case_id}`) }, 'Open case →')) : null) : null,
    h('div', { class: 'row pad noprint' },
      btn('Mark inconclusive', reviewForm('inconclusive', 'Mark inconclusive'), { disabled: !write }),
      btn('Escalate to case', escalate, { primary: true, disabled: !write || c.review_status === 'escalated' }),
      btn('Retain as potential match', reviewForm('retained_potential_match', 'Retain as potential match'), { disabled: !write }),
      btn('Close as not a match', reviewForm('not_a_match', 'Close as NOT a match'), { danger: true, disabled: !reviewer, title: reviewer ? 'Requires rationale and evidence' : 'Reviewer role required' }),
      !write ? h('span', { class: 'small muted' }, 'Your role is read-only.') : null),
    actionHost);
}

// ------------------------------------------------------------------ cases
async function cases(ctx, route) {
  if (route.id) return caseDetail(ctx, route);
  const rows = await api.get('/api/cases?type=screening_review,compliance,trade_risk,other');
  return h('div', { class: 'stack' }, pageHead('Risk & compliance', 'Compliance cases', 'Rationale, evidence, disposition and history, with every change audited.'),
    panel('Cases', `${rows.length} total`, table([
      { label: 'Case', render: (c) => h('div', null, h('b', null, c.title), h('div', { class: 'small muted' }, c.ref)) },
      { label: 'Subject', render: (c) => c.entities.map((e) => e.legal_name).join(', ') },
      { label: 'Status', render: (c) => pill(c.status, c.status === 'closed' ? 'green' : c.status === 'escalated' ? 'red' : 'amber') },
      { label: 'Priority', render: (c) => pill(c.priority, c.priority === 'high' || c.priority === 'urgent' ? 'red' : 'grey') },
      { label: 'Disposition', render: (c) => c.disposition ? label(c.disposition) : h('span', { class: 'muted' }, 'none yet') },
      { label: 'Opened', render: (c) => fmt(c.created_at) },
    ], rows, { empty: 'No cases yet. Escalate a screening candidate to create one.', onRow: (c) => ctx.go(`risk/cases/${c.id}`) })));
}

async function caseDetail(ctx, route) {
  const c = await api.get(`/api/cases/${route.id}`);
  const subject = c.entities[0];
  if (subject) ctx.selectEntity(subject);
  const write = canWrite(ctx);
  const reviewer = ctx.state.user.role === 'reviewer';
  const closed = c.status === 'closed';

  const openInv = btn('Open investigation →', async () => { const r = await api.post(`/api/cases/${c.id}/open-investigation`, {}); toast(r.reused ? 'Reopened existing investigation' : 'Investigation opened with the same entity'); ctx.go(`intel/investigations/${r.case.id}`); }, { primary: true, disabled: !write });

  const noteHost = h('div');
  const notes = panel('Analyst notes', null, h('div', null, c.notes.length ? c.notes.map((n) => h('div', { class: 'item' }, h('div', null, h('p', null, n.body), h('div', { class: 'small muted' }, `${n.author} · ${fmt(n.created_at)}`)))) : h('div', { class: 'empty-state' }, 'No notes.'),
    write ? form([{ name: 'body', label: 'Add note', type: 'textarea', required: true }], { submit: 'Add note', onSubmit: async (d) => { await api.post(`/api/cases/${c.id}/notes`, d); ctx.render(); } }) : null));

  const evidence = [...c.findings.map((f) => [`f:${f.id}`, `Finding · ${f.claim.slice(0, 70)}`]), ...c.sources.map((x) => [`s:${x.id}`, `Source · ${x.ref} ${x.title.slice(0, 60)}`])];
  const exact = c.screening?.candidates.some((x) => x.features.some((f) => f.code === 'identifier_exact'));
  const dispo = closed
    ? notice('ok', h('b', null, 'Closed. '), `Disposition: ${label(c.disposition)}.`)
    : reviewer
      ? form([
        { name: 'disposition', label: 'Disposition', type: 'select', options: [['inconclusive', 'Inconclusive: more information needed'], ['escalated', 'Escalated further'], ['potential_match', 'Retain as potential match'], ['not_a_match', 'Not a match: close'], ['other', 'Other / still in review']] },
        { name: 'rationale', label: 'Rationale', type: 'textarea', required: true, hint: 'At least 20 characters.' },
        { name: 'evidence', label: 'Basis: findings / sources (required for "not a match")', type: 'multiselect', options: evidence },
        ...(exact ? [{ name: 'ack', label: 'I acknowledge a candidate agrees on an identifier and I have addressed it', type: 'checkbox' }] : []),
      ], { submit: 'Record disposition', onSubmit: async (d) => {
        const ev = d.evidence ?? [];
        await api.post(`/api/cases/${c.id}/disposition`, { disposition: d.disposition, rationale: d.rationale, finding_ids: ev.filter((x) => x.startsWith('f:')).map((x) => x.slice(2)), source_ids: ev.filter((x) => x.startsWith('s:')).map((x) => x.slice(2)), acknowledge_identifier_agreement: d.ack === true });
        toast('Disposition recorded and audited'); ctx.render();
      } })
      : notice('info', 'Dispositions are recorded by a ', h('b', null, 'reviewer'), '. Your role is ', h('b', null, ctx.state.user.role), '. Add notes and evidence, then ask a reviewer to decide.');

  return h('div', { class: 'stack' },
    pageHead('Risk & compliance · case', c.title, `${c.ref} · ${label(c.case_type)} · opened ${fmt(c.created_at)}`, btn('← Cases', () => ctx.go('risk/cases')), openInv),
    h('div', { class: 'entity-view' },
      h('div', { class: 'stack' },
        panel('Summary', null, kv([['Status', pill(c.status, closed ? 'green' : 'amber')], ['Priority', c.priority], ['Subject', c.entities.map((e) => h('a', { onclick: () => ctx.go(`risk/entity/${e.id}`) }, `${e.legal_name} `))], ['Summary', c.summary], ['Disposition', c.disposition ? label(c.disposition) : 'none yet'], ['Origin screening', c.screening ? h('a', { onclick: () => ctx.go(`risk/screening/${c.screening.id}`) }, c.screening.ref) : '—'], ['Linked investigations', c.child_cases.length ? c.child_cases.map((x) => h('a', { onclick: () => ctx.go(`intel/investigations/${x.id}`) }, `${x.ref} `)) : 'none']])),
        panel('Record disposition', 'Human decision with rationale; the system never auto-confirms a match', dispo),
        c.dispositions.length ? panel('Disposition history', null, c.dispositions.map((d) => h('div', { class: 'item' }, h('div', null, h('p', null, h('b', null, label(d.disposition)), ` — ${d.rationale}`), h('div', { class: 'small muted' }, `${d.by} · ${fmt(d.at)}${d.basis_list ? ` · list: ${d.basis_list.origin === 'simulated_fixture' ? 'SIMULATED' : d.basis_list.origin}, ${d.basis_list.freshness}` : ''}`))))) : null,
        notes),
      h('div', { class: 'stack' },
        panel('Evidence', 'Findings and sources attached to this subject', h('div', null, c.findings.length ? c.findings.map((f) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('p', null, f.claim), h('div', { class: 'small muted' }, label(f.finding_type))), verifPill(f.verification_status))) : h('div', { class: 'empty-state' }, 'No evidence yet. Continue in Intelligence to build it.'))),
        panel('Timeline (audit)', null, timeline(c.timeline)))));
}

export const pages = { screening, cases };
