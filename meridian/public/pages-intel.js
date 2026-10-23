import { h, toast, btn, pill, verifPill, originBadge, freshPill, panel, pageHead, notice, table, form, kv, timeline, icon, fmt, fmtDay, ago, label } from './ui.js';
import { api } from './api.js';
import { canWrite, sourceRef } from './pages-shared.js';

const TYPE_LABEL = { source_fact: 'Source fact', analyst_assessment: 'Hypothesis / assessment', unknown: 'Unknown', contradictory_evidence: 'Contradictory evidence', ai_synthesis: 'AI synthesis (simulated)', potential_match: 'Potential match' };
const TYPE_CLS = { source_fact: 'green', analyst_assessment: 'blue', unknown: 'grey', contradictory_evidence: 'red', ai_synthesis: 'sim', potential_match: 'amber' };
const VERIFS = ['unverified', 'corroborated', 'verified', 'disputed', 'rejected', 'unknown'];

// ------------------------------------------------------------------ investigations
async function investigations(ctx, route) {
  if (route.id) return investigationDetail(ctx, route);
  const [rows, ents] = await Promise.all([api.get('/api/cases?type=investigation'), api.get('/api/entities')]);
  const write = canWrite(ctx);
  const host = h('div');
  const create = btn('＋ New investigation', () => host.replaceChildren(panel('New investigation', 'Links an existing entity: nothing is duplicated', form([
    { name: 'entity_id', label: 'Subject entity', type: 'select', required: true, options: ents.map((e) => [e.id, `${e.legal_name} (${e.ref})`]), value: ctx.state.selected?.id },
    { name: 'title', label: 'Title', required: true }, { name: 'research_question', label: 'Research question', type: 'textarea' },
    { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map((x) => [x, x]), value: 'normal' },
  ], { submit: 'Open investigation', cancel: () => host.replaceChildren(), onSubmit: async (d) => { const c = await api.post('/api/cases', { case_type: 'investigation', title: d.title, research_question: d.research_question, priority: d.priority, entity_ids: [d.entity_id] }); toast(`Opened ${c.ref}`); ctx.go(`intel/investigations/${c.id}`); } }))), { primary: true, disabled: !write });
  return h('div', { class: 'stack' }, pageHead('Intelligence & investigations', 'Investigations', 'Research questions, an evidence register, hypotheses, unknowns and a cited briefing.', create), host,
    panel('Active investigations', `${rows.length} total`, table([
      { label: 'Investigation', render: (c) => h('div', null, h('b', null, c.title), h('div', { class: 'small muted' }, c.ref)) },
      { label: 'Subject', render: (c) => c.entities.map((e) => e.legal_name).join(', ') },
      { label: 'Status', render: (c) => pill(c.status, c.status === 'closed' ? 'green' : 'amber') },
      { label: 'From case', render: (c) => c.origin_case_id ? 'handed off' : 'direct' },
      { label: 'Opened', render: (c) => fmt(c.created_at) },
    ], rows, { empty: 'No investigations yet. Open one from a compliance case or the form above.', onRow: (c) => ctx.go(`intel/investigations/${c.id}`) })));
}

async function investigationDetail(ctx, route) {
  const c = await api.get(`/api/cases/${route.id}`);
  const subject = c.entities[0];
  const prof = subject ? await api.get(`/api/entities/${subject.id}`) : null;
  if (subject) ctx.selectEntity(subject);
  const write = canWrite(ctx);
  const allSources = await api.get('/api/sources');
  const regen = () => ctx.render();

  const findingsOf = (...types) => c.findings.filter((f) => types.includes(f.finding_type));
  const findingRow = (f) => h('div', { class: 'item' },
    h('div', { class: 'grow' }, h('p', null, f.claim),
      h('div', { class: 'small muted', style: 'margin-top:5px' }, f.source_id ? sourceRef(allSources, f.source_id) : 'no source attached', f.confidence != null ? ` · confidence ${f.confidence} (not the same as verification)` : ''),
      write ? h('select', { class: 'inline-input', style: 'width:170px;margin-top:6px;padding:4px 8px', 'aria-label': 'Verification status', onchange: async (e) => { try { await api.patch(`/api/findings/${f.id}`, { verification_status: e.target.value }); toast('Verification status updated and audited'); regen(); } catch (ex) { toast(ex.message); e.target.value = f.verification_status; } } }, VERIFS.map((v) => h('option', { value: v, selected: v === f.verification_status }, v))) : null),
    h('div', null, h('div', null, pill(TYPE_LABEL[f.finding_type] ?? f.finding_type, TYPE_CLS[f.finding_type] ?? 'grey')), h('div', { style: 'margin-top:5px' }, verifPill(f.verification_status))));

  const addFindingHost = h('div');
  const addFinding = btn('＋ Add finding', () => addFindingHost.replaceChildren(panel('Add a finding', 'Source facts must cite a registered source. “Verified” and “corroborated” require one.', form([
    { name: 'claim', label: 'Claim', type: 'textarea', required: true },
    { name: 'finding_type', label: 'Kind', type: 'select', options: [['source_fact', 'Source fact (requires source)'], ['analyst_assessment', 'Hypothesis / analyst assessment'], ['unknown', 'Unknown / open question'], ['contradictory_evidence', 'Contradictory evidence']] },
    { name: 'source_id', label: 'Source', type: 'select', options: [['', '— none —'], ...allSources.map((s) => [s.id, `${s.ref} · ${s.title}${s.retrieved_at ? '' : ' (NOT RETRIEVED)'}`])] },
    { name: 'verification_status', label: 'Verification status', type: 'select', options: VERIFS.map((v) => [v, v]), value: 'unverified' },
    { name: 'confidence', label: 'Confidence (0–1, optional)', hint: 'Confidence is your estimate; it does not replace verification.' },
    { name: 'analyst_notes', label: 'Analyst notes', type: 'textarea' },
  ], { submit: 'Add finding', cancel: () => addFindingHost.replaceChildren(), onSubmit: async (d) => { await api.post('/api/findings', { ...d, case_id: c.id, entity_id: subject?.id, source_id: d.source_id || undefined, confidence: d.confidence ? Number(d.confidence) : undefined }); toast('Finding added and audited'); regen(); } }))), { primary: true, disabled: !write });

  const srcHost = h('div');
  const addSrc = btn('＋ Register source', () => srcHost.replaceChildren(panel('Register a source', null, form([
    { name: 'title', label: 'Title', required: true }, { name: 'publisher', label: 'Publisher', required: true }, { name: 'url', label: 'URL', type: 'url' },
    { name: 'source_type', label: 'Type', type: 'select', options: ['registry', 'government', 'filing', 'news', 'company_site', 'official_list', 'analyst_note', 'other'].map((x) => [x, label(x)]) },
    { name: 'publication_date', label: 'Publication date', type: 'date' }, { name: 'retrieved_at', label: 'Retrieved at', type: 'datetime-local', hint: 'Blank = not retrieved (flagged in briefings).' },
    { name: 'license_status', label: 'Licence / terms', type: 'select', options: ['not_reviewed', 'permitted', 'restricted', 'unknown'].map((x) => [x, label(x)]) },
  ], { submit: 'Register', cancel: () => srcHost.replaceChildren(), onSubmit: async (d) => { if (d.retrieved_at) d.retrieved_at = new Date(d.retrieved_at).toISOString(); const s = await api.post('/api/sources', d); toast(`Registered ${s.ref}`); regen(); } }))), { disabled: !write });

  const relHost = h('div');
  const ents = await api.get('/api/entities');
  const addRel = btn('＋ Relationship', () => relHost.replaceChildren(panel('Add relationship', '“Verified/corroborated” requires a source; otherwise it stays visibly unverified.', form([
    { name: 'source_entity_id', label: 'From', type: 'select', options: ents.map((e) => [e.id, e.legal_name]), value: subject?.id },
    { name: 'relationship_type', label: 'Relationship', required: true, hint: 'e.g. owner_of, director_of, affiliate_of, supplies' },
    { name: 'target_entity_id', label: 'To', type: 'select', options: ents.map((e) => [e.id, e.legal_name]) },
    { name: 'source_id', label: 'Source', type: 'select', options: [['', '— none —'], ...allSources.map((s) => [s.id, `${s.ref} · ${s.title}`])] },
    { name: 'verification_status', label: 'Status', type: 'select', options: VERIFS.map((v) => [v, v]), value: 'unverified' },
  ], { submit: 'Add', cancel: () => relHost.replaceChildren(), onSubmit: async (d) => { await api.post('/api/relationships', { ...d, source_id: d.source_id || undefined }); toast('Relationship added'); regen(); } }))), { disabled: !write });

  const briefBtn = btn('Generate briefing', async () => { try { const r = await api.post(`/api/cases/${c.id}/briefing`); toast(`Briefing ${r.ref} generated from stored sources only`); ctx.go(`intel/reports/${r.id}`); } catch (ex) { toast(`Rejected: ${ex.message}`); } }, { primary: true, disabled: !write, title: 'Built only from stored records; validated for citations' });

  const originLink = c.origin_case ? btn(`← Back to compliance case ${c.origin_case.ref}`, () => ctx.go(`risk/cases/${c.origin_case.id}`)) : null;
  return h('div', { class: 'stack' },
    pageHead('Intelligence · investigation', c.title, `${c.ref} · opened ${fmt(c.created_at)}`, originLink, btn('← All', () => ctx.go('intel/investigations')), briefBtn),
    panel('Research question', null, kv([['Question', c.research_question ?? 'Not set'], ['Subject', subject ? h('a', { onclick: () => ctx.go(`intel/entity/${subject.id}`) }, subject.legal_name) : '—'], ['Status', pill(c.status, c.status === 'closed' ? 'green' : 'amber')], ['Same entity as screening', c.origin_case ? 'Yes: linked, not copied' : 'n/a']])),
    h('div', { class: 'layout' },
      h('div', { class: 'stack' },
        panel('Evidence register', 'Source-backed facts, disputes and their verification state', h('div', null, findingsOf('source_fact', 'contradictory_evidence', 'ai_synthesis').length ? findingsOf('source_fact', 'contradictory_evidence', 'ai_synthesis').map(findingRow) : h('div', { class: 'empty-state' }, 'No source-backed findings yet.')), addFinding), addFindingHost,
        panel('Hypotheses & assessments', 'Analyst judgement: kept apart from source facts', findingsOf('analyst_assessment').length ? findingsOf('analyst_assessment').map(findingRow) : h('div', { class: 'empty-state' }, 'None recorded.')),
        panel('Unknowns & open questions', 'What the evidence does not establish', findingsOf('unknown').length ? findingsOf('unknown').map(findingRow) : h('div', { class: 'empty-state' }, 'None recorded: unlikely to be true. What is still unknown?')),
        panel('Relationships', 'From the shared entity layer', h('div', null, prof?.relationships.length ? table([{ label: 'Link', render: (r) => `${r.source_name} → ${r.target_name}` }, { label: 'Type', render: (r) => label(r.relationship_type) }, { label: 'Status', render: (r) => verifPill(r.verification_status) }, { label: 'Source', render: (r) => r.source_id ? sourceRef(allSources, r.source_id) : h('span', { class: 'muted' }, 'none') }], prof.relationships) : h('div', { class: 'empty-state' }, 'No relationships.'), h('div', { class: 'row pad' }, addRel, btn('View map →', () => ctx.go(`intel/graph/${subject?.id ?? ''}`), { small: true }))), relHost)),
      h('div', { class: 'stack' },
        panel('Sources used', 'Cited sources and their retrieval status', h('div', null, c.sources.length ? c.sources.map((s) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('p', null, h('b', null, s.ref), ' · ', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noreferrer noopener' }, s.title) : s.title), h('div', { class: 'small muted' }, `${s.publisher} · ${s.retrieved_at ? `retrieved ${ago(s.retrieved_at)}` : 'NOT RETRIEVED'}`)), originBadge(s.data_origin))) : h('div', { class: 'empty-state' }, 'No sources cited yet.'), h('div', { class: 'row pad' }, addSrc)), srcHost),
        panel('Briefings', null, c.reports.length ? c.reports.map((r) => h('div', { class: 'case-row' }, h('div', { class: 'case-copy' }, h('strong', null, r.ref), h('small', null, `generated ${fmt(r.generated_at)}`)), btn('Open', () => ctx.go(`intel/reports/${r.id}`), { small: true }))) : h('div', { class: 'empty-state' }, 'No briefing yet.')),
        panel('Timeline (audit)', null, timeline(c.timeline)))));
}

// ------------------------------------------------------------------ graph
const EDGE = { verified: ['#2f7d68', ''], corroborated: ['#2f7d68', '6 3'], unverified: ['#c58a2c', '3 4'], disputed: ['#b84d54', '2 3'], rejected: ['#9aa6b6', '1 4'], unknown: ['#9aa6b6', '3 4'] };
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs ?? {})) { if (k === 'style') el.style.cssText = v; else el.setAttribute(k, String(v)); } kids.forEach((k) => el.append(k instanceof Node ? k : document.createTextNode(String(k)))); return el; }

async function graph(ctx, route) {
  const ents = await api.get('/api/entities');
  const id = route.id || ctx.state.selected?.id || ents[0]?.id;
  if (!id) return h('div', { class: 'empty-state' }, 'No entities.');
  const depth = Number(sessionStorage.getItem('ui:depth') || 1);
  const g = await api.get(`/api/graph/${id}?depth=${depth}`);
  const centerEnt = ents.find((e) => e.id === id);
  if (centerEnt) ctx.selectEntity(centerEnt);
  const W = 760; const H = 420; const cx = W / 2; const cy = H / 2;
  const others = g.nodes.filter((n) => n.id !== g.center);
  const pos = new Map([[g.center, [cx, cy]]]);
  others.forEach((n, i) => { const a = (2 * Math.PI * i) / Math.max(others.length, 1) - Math.PI / 2; pos.set(n.id, [cx + 270 * Math.cos(a), cy + 150 * Math.sin(a)]); });
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Relationship graph. Dashed lines are not verified.' });
  g.edges.forEach((e) => {
    const [x1, y1] = pos.get(e.source); const [x2, y2] = pos.get(e.target); const [col, dash] = EDGE[e.verification_status] ?? EDGE.unknown;
    root.append(svg('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': e.has_source ? 2.6 : 1.6, 'stroke-dasharray': dash }));
    root.append(svg('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 5, 'text-anchor': 'middle', 'font-size': 10, fill: '#59687d' }, `${label(e.type)}${e.has_source ? '' : ' · no source'}`));
  });
  g.nodes.forEach((n) => {
    const [x, y] = pos.get(n.id); const isC = n.id === g.center;
    const grp = svg('g', { style: 'cursor:pointer', tabindex: 0, role: 'link', 'aria-label': `Open ${n.name}` });
    grp.append(svg('circle', { cx: x, cy: y, r: isC ? 50 : 44, fill: isC ? '#eaf1ff' : '#fff', stroke: isC ? '#6689c7' : '#8ca5cb', 'stroke-width': 1.6 }));
    const words = n.name.split(' ');
    const lines = [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')].filter(Boolean);
    lines.forEach((t, i) => grp.append(svg('text', { x, y: y + (i - (lines.length - 1) / 2) * 11 + 3, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#345783' }, t.slice(0, 20))));
    grp.addEventListener('click', () => ctx.go(`intel/graph/${n.id}`));
    grp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ctx.go(`intel/graph/${n.id}`); });
    root.append(grp);
  });
  const legend = h('div', { class: 'edge-legend' }, ...[['verified', 'Verified (sourced)'], ['corroborated', 'Corroborated'], ['unverified', 'Unverified'], ['disputed', 'Disputed']].map(([k, t]) => h('span', null, (() => { const s = svg('svg', { width: 34, height: 8, style: 'vertical-align:middle;margin-right:6px' }); s.append(svg('line', { x1: 0, y1: 4, x2: 34, y2: 4, stroke: EDGE[k][0], 'stroke-width': 2, 'stroke-dasharray': EDGE[k][1] })); return s; })(), t)), h('span', null, 'Thick line = source attached · Edges without a source are never presented as findings'));
  const pick = h('select', { class: 'inline-input', style: 'width:260px;margin:0', 'aria-label': 'Center entity', onchange: (e) => ctx.go(`intel/graph/${e.target.value}`) }, ents.map((e) => h('option', { value: e.id, selected: e.id === id }, e.legal_name)));
  const depthSel = h('select', { class: 'inline-input', style: 'width:120px;margin:0', 'aria-label': 'Depth', onchange: (e) => { sessionStorage.setItem('ui:depth', e.target.value); ctx.render(); } }, [1, 2, 3].map((d) => h('option', { value: d, selected: d === depth }, `${d} degree${d > 1 ? 's' : ''}`)));
  return h('div', { class: 'stack' }, pageHead('Intelligence & investigations', 'Relationship map', 'Built from stored relationships only. Unverified links are visually distinct.'),
    panel('Network', `${g.nodes.length} entities · ${g.edges.length} relationships`, h('div', null, h('div', { class: 'row pad' }, pick, depthSel), h('div', { class: 'graph', style: 'height:auto' }, root), legend)),
    panel('Relationship evidence', null, table([
      { label: 'Link', render: (e) => `${g.nodes.find((n) => n.id === e.source).name} → ${g.nodes.find((n) => n.id === e.target).name}` },
      { label: 'Type', render: (e) => label(e.type) }, { label: 'Status', render: (e) => verifPill(e.verification_status) },
      { label: 'Source', render: (e) => e.has_source ? 'attached' : pill('no source', 'amber') }, { label: 'Confidence', render: (e) => e.confidence ?? '—' },
    ], g.edges, { empty: 'No relationships recorded for this entity.' })));
}

// ------------------------------------------------------------------ reports
const KIND = { record_summary: ['Record', 'grey'], source_fact: ['Source fact', 'green'], potential_match: ['Potential match', 'amber'], analyst_assessment: ['Analyst assessment', 'blue'], ai_synthesis: ['AI synthesis', 'sim'], unknown: ['Unknown', 'grey'], contradictory_evidence: ['Contradictory', 'red'] };

async function reports(ctx, route) {
  if (route.id) return reportView(ctx, route);
  const rows = await api.get('/api/reports');
  return h('div', { class: 'stack' }, pageHead('Intelligence & investigations', 'Briefings & reports', 'Every briefing is generated from stored records, validated for citations, and marked as requiring human review.'),
    notice('info', 'Generate a briefing from an investigation page. No language model is connected: output is a deterministic restatement of stored records (simulated AI synthesis).'),
    panel('Generated briefings', null, table([
      { label: 'Briefing', render: (r) => h('div', null, h('b', null, r.title), h('div', { class: 'small muted' }, r.ref)) },
      { label: 'Generated', render: (r) => fmt(r.generated_at) }, { label: 'By', render: (r) => r.generated_by },
      { label: 'Claims', render: (r) => r.claims }, { label: 'Warnings', render: (r) => r.warnings ? pill(`${r.warnings}`, 'amber') : '0' },
      { label: 'Generator', render: (r) => pill(`${r.generator.name} (${label(r.generator.kind)})`, 'sim') },
    ], rows, { empty: 'No briefings yet.', onRow: (r) => ctx.go(`intel/reports/${r.id}`) })));
}

function reportText(r) {
  const lines = [r.title, `Generated ${r.generated_at} by ${r.generated_by} · ${r.generator.name} (${r.generator.kind}, model: ${r.generator.model ?? 'none'})`, `STATUS: ${r.status}`, '', `DISCLAIMER: ${r.disclaimer}`, ''];
  r.warnings.forEach((w) => lines.push(`WARNING: ${w}`));
  r.sections.forEach((s) => { lines.push('', s.heading.toUpperCase()); s.items.forEach((i) => lines.push(`- [${(KIND[i.kind] ?? [i.kind])[0]}] ${i.text}${i.citations.length ? ` ${i.citations.join('')}` : ''}${i.verification_status ? ` (${i.verification_status})` : ''}`)); });
  lines.push('', 'SOURCE REGISTER');
  r.source_register.forEach((s) => lines.push(`${s.cite} ${s.title} — ${s.publisher}${s.url ? ` — ${s.url}` : ''} · published ${s.publication_date ?? 'unknown'} · retrieved ${s.retrieved_at ?? 'NOT RETRIEVED'} · licence ${s.license_status} · origin ${s.origin}`));
  lines.push('', 'LIMITATIONS', ...r.limitations.map((l) => `- ${l}`));
  return lines.join('\n');
}

async function reportView(ctx, route) {
  const r = await api.get(`/api/reports/${route.id}`);
  const refs = new Map(r.source_register.map((s) => [s.cite, s]));
  const copy = btn('Copy as text', async () => { try { await navigator.clipboard.writeText(reportText(r)); toast('Copied'); } catch { toast('Copy unavailable in this browser'); } });
  return h('div', { class: 'stack' },
    pageHead('Intelligence · briefing', r.title, `${r.ref} · generated ${fmt(r.generated_at)} by ${r.generated_by}`, btn('← Briefings', () => ctx.go('intel/reports')), btn('Investigation', () => ctx.go(`intel/investigations/${r.case_id}`)), copy, btn('Print', () => window.print())),
    notice('bad', h('b', null, 'DRAFT: human review required. '), r.disclaimer),
    notice('warn', h('b', null, 'Generation method: '), `${r.generator.name} v${r.generator.version} (${label(r.generator.kind)}; language model: ${r.generator.model ?? 'none'}). `, `Citation check: ${r.citation_check.claims_cited}/${r.citation_check.claims_total} claims cited.`),
    r.warnings.length ? notice('warn', h('b', null, 'Source warnings'), h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, r.warnings.map((w) => h('li', null, w)))) : null,
    panel(null, null, h('div', { class: 'report-section' }, r.sections.map((s) => h('div', null, h('h3', null, s.heading), s.items.map((i) => h('div', { class: 'item' },
      pill((KIND[i.kind] ?? [i.kind, 'grey'])[0], (KIND[i.kind] ?? [0, 'grey'])[1]),
      h('div', { class: 'grow' }, h('p', null, i.text, i.citations.map((c) => h('a', { class: 'cite', href: `#cite-${c}`, title: refs.get(c)?.title, onclick: (e) => { e.preventDefault(); document.getElementById(`cite-${c}`)?.scrollIntoView({ behavior: 'smooth' }); } }, c))),
        i.verification_status ? h('div', { class: 'small muted' }, `verification: ${i.verification_status}`) : null))))))),
    panel('Source register', 'Every citation resolves here', table([
      { label: '#', render: (s) => h('span', { id: `cite-${s.cite}`, class: 'cite' }, s.cite) },
      { label: 'Source', render: (s) => h('div', { style: 'white-space:normal;min-width:240px' }, h('b', null, s.title), h('div', { class: 'small muted' }, s.publisher), s.url ? h('a', { class: 'small', href: s.url, target: '_blank', rel: 'noreferrer noopener' }, s.url) : null) },
      { label: 'Origin', render: (s) => originBadge(s.origin) }, { label: 'Published', render: (s) => fmtDay(s.publication_date) },
      { label: 'Retrieved', render: (s) => s.retrieved_at ? fmt(s.retrieved_at) : pill('not retrieved', 'amber') }, { label: 'Freshness', render: (s) => freshPill(s.freshness) },
      { label: 'Licence', render: (s) => pill(s.license_status, s.license_status === 'permitted' ? 'green' : 'amber') },
    ], r.source_register)),
    panel('Limitations', null, h('ul', { class: 'pad', style: 'margin:0;padding-left:36px;font-size:12px;line-height:1.8' }, r.limitations.map((l) => h('li', null, l)))));
}

export const pages = { investigations, graph, reports };
