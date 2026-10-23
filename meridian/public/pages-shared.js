import { h, toast, btn, pill, verifPill, originBadge, freshPill, panel, pageHead, notice, table, form, kv, timeline, icon, fmt, fmtDay, ago, label } from './ui.js';
import { api } from './api.js';

const stat = (lbl, value, foot, ico) => h('div', { class: 'stat' }, h('div', { class: 'stat-top' }, h('span', null, lbl), h('span', { class: 'stat-icon' }, ico)), h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-foot' }, foot));
const pct = (n) => (n === null || n === undefined ? 'n/a' : `${n}%`);
export const canWrite = (ctx) => ['analyst', 'reviewer'].includes(ctx.state.user.role);

const STATUS_CLS = { implemented: 'green', demo: 'amber', simulated: 'sim', not_connected: 'grey' };
function integrationsPanel(sys) {
  return panel('What is real, what is simulated', 'Single source of truth: served by the API and pinned by tests',
    table([{ label: 'Capability', render: (r) => h('b', null, r.name) }, { label: 'Status', render: (r) => h('span', { class: `pill ${STATUS_CLS[r.status]}` }, label(r.status).toUpperCase()) }, { label: 'Detail', render: (r) => h('span', { style: 'white-space:normal;display:block;min-width:260px' }, r.detail) }], sys.integrations));
}

function listsPanel(lists, mode) {
  return panel('Reference lists & freshness', 'Every screening records which list it ran against',
    table([{ label: 'List', render: (l) => h('div', null, h('b', null, l.name), h('div', { class: 'small muted' }, l.publisher)) }, { label: 'Origin', render: (l) => originBadge(l.origin) }, { label: 'Freshness', render: (l) => freshPill(l.freshness) }], lists, { empty: 'No reference list is loaded. Screening will report "source unavailable", never "clear".' }));
}

async function dashboard(ctx, route) {
  const [d, sys] = await Promise.all([api.get('/api/dashboard'), api.get('/api/system')]);
  const isRisk = route.mode === 'risk';
  const head = isRisk
    ? pageHead('Risk & compliance', `Welcome, ${ctx.state.user.display_name}`, 'Screening review, escalation and dispositions, on the shared entity layer.', btn('Open screening queue', () => ctx.go('risk/screening'), { primary: true }), btn('Entity directory', () => ctx.go('risk/entities')))
    : pageHead('Intelligence & investigations', `Welcome, ${ctx.state.user.display_name}`, 'Evidence-first research with traceable sources and cited briefings.', btn('Open investigations', () => ctx.go('intel/investigations'), { primary: true }), btn('Relationship map', () => ctx.go('intel/graph')));
  const stats = isRisk
    ? [stat('Entities in shared layer', d.entities, 'Visible in both workspaces', '◇'), stat('Candidates awaiting review', d.candidates_pending_review, 'Pending analyst decision', '◎'), stat('Open screening cases', d.open_screening_cases, 'Escalated for review', '▤'), stat('Screenings run', d.screenings_run, 'Against the SIMULATED list', '↗')]
    : [stat('Open investigations', d.open_investigations, 'Opened from cases or directly', '⌕'), stat('Sourced-claim coverage', pct(d.sourced_claim_pct), 'Source facts with a cited source', '↗'), stat('Relationships with provenance', pct(d.relationships_with_source_pct), `${d.relationships} recorded`, '⌘'), stat('Sources not yet retrieved', d.sources_not_retrieved, `of ${d.sources} registered`, '◷')];

  const walk = panel('Guided demo: the end-to-end workflow', 'About 5 minutes · fictional data',
    h('ol', { class: 'pad small', style: 'line-height:1.9;margin:0;padding-left:36px' },
      h('li', null, 'Risk workspace → ', h('a', { onclick: () => ctx.go('risk/screening') }, 'Screening queue'), ': run a screening for ', h('b', null, 'Volga Meridian Trading'), '.'),
      h('li', null, 'Read why the candidate surfaced, its conflicts and data gaps. Escalate it to a case.'),
      h('li', null, 'In the case, click ', h('b', null, 'Open investigation'), ': the mode switches and the same entity carries over.'),
      h('li', null, 'Register a source, add a sourced finding, then ', h('b', null, 'Generate briefing'), '.'),
      h('li', null, 'Switch back to Risk (top-left toggle), sign in as ', h('code', null, 'reviewer@'), ' and record the disposition with a rationale.'),
      h('li', null, h('a', { onclick: () => ctx.go(`${route.mode}/audit`) }, 'Audit & integrity'), ': see every step and verify the hash chain.')));
  return h('div', { class: 'stack' }, head, notice('warn', h('b', null, 'Demo environment. '), 'Records are invented. The screening list is a simulated fixture; no live sanctions data is connected, and no language model writes the briefings.'),
    h('div', { class: 'stats' }, stats), walk, listsPanel(d.lists, route.mode), integrationsPanel(sys));
}

// ------------------------------------------------------------------ entities
async function entities(ctx, route) {
  let q = ''; let type = '';
  try { q = JSON.parse(sessionStorage.getItem('ui:q')) ?? ''; sessionStorage.removeItem('ui:q'); } catch { q = ''; }
  const holder = h('div');
  const search = h('input', { class: 'inline-input', style: 'width:230px;margin:0', placeholder: 'Name, alias, identifier, jurisdiction…', value: q, 'aria-label': 'Filter entities' });
  const typeSel = h('select', { class: 'inline-input', style: 'width:140px;margin:0', 'aria-label': 'Entity type' }, [['', 'All types'], ['organization', 'Organizations'], ['person', 'People'], ['vessel', 'Vessels'], ['other', 'Other']].map(([v, l]) => h('option', { value: v }, l)));
  async function load() {
    const params = new URLSearchParams(); if (search.value.trim()) params.set('q', search.value.trim()); if (typeSel.value) params.set('type', typeSel.value);
    const rows = await api.get(`/api/entities?${params}`);
    holder.replaceChildren(table([
      { label: 'Entity', render: (e) => h('div', { class: 'entity' }, icon(e.legal_name), h('div', null, h('strong', null, e.legal_name), h('small', null, `${e.ref} · ${label(e.entity_type)}`))) },
      { label: 'Jurisdiction', render: (e) => e.jurisdiction ?? '—' },
      { label: 'Identifiers', render: (e) => e.identifiers.length ? e.identifiers.map((i) => i.identifier_value).join(', ') : h('span', { class: 'muted' }, 'none recorded') },
      { label: 'Latest screening', render: (e) => e.latest_screening ? pill(`${label(e.latest_screening.status)}`, e.latest_screening.status === 'pending_review' ? 'amber' : e.latest_screening.status === 'no_candidates' ? 'blue' : 'grey') : h('span', { class: 'muted' }, 'not screened') },
      { label: 'Origin', render: (e) => originBadge(e.data_origin) },
    ], rows, { empty: 'No entities match. Try fewer filters. (A search with no results is not evidence that an entity does not exist.)', onRow: (e) => { ctx.selectEntity(e); ctx.go(`${route.mode}/entity/${e.id}`); } }));
  }
  search.addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(load, 200); });
  typeSel.addEventListener('change', load);
  await load();
  const addPanel = h('div');
  const addBtn = btn('＋ Add entity', () => {
    addPanel.replaceChildren(panel('New entity', 'Created once, visible in both workspaces', form([
      { name: 'legal_name', label: 'Legal name', required: true, max: 300 },
      { name: 'entity_type', label: 'Type', type: 'select', options: [['organization', 'Organization'], ['person', 'Person'], ['vessel', 'Vessel'], ['other', 'Other']] },
      { name: 'jurisdiction', label: 'Jurisdiction' }, { name: 'registration_id', label: 'Registration ID', hint: 'Used as an identifier in screening if provided.' },
      { name: 'description', label: 'Description', type: 'textarea' },
    ], { submit: 'Create entity', cancel: () => addPanel.replaceChildren(), onSubmit: async (d) => { const e = await api.post('/api/entities', d); toast(`Created ${e.ref}`); ctx.selectEntity(e); ctx.go(`${route.mode}/entity/${e.id}`); } })));
  }, { primary: true, disabled: !canWrite(ctx), title: canWrite(ctx) ? null : 'Your role is read-only' });
  return h('div', { class: 'stack' }, pageHead('Shared intelligence engine', route.mode === 'risk' ? 'Entity directory' : 'Entity profiles', 'One record, two workspaces. Search is server-side and scoped to your organization.', addBtn), addPanel,
    panel('Directory', 'Select a record to open its shared profile', h('div', null, h('div', { class: 'row pad' }, search, typeSel), holder)));
}

// ------------------------------------------------------------------ entity profile
function miniGraphLink(ctx, route, id) { return btn('Open relationship map →', () => ctx.go(`intel/graph/${id}`), { small: true }); }

async function entity(ctx, route) {
  const e = await api.get(`/api/entities/${route.id}`);
  ctx.selectEntity(e);
  const isRisk = route.mode === 'risk';
  const write = canWrite(ctx);
  const refresh = () => ctx.render();

  const handoff = btn(isRisk ? 'Continue in Intelligence →' : 'Continue in Risk & Compliance →', async () => {
    if (isRisk) {
      const sc = e.cases.find((c) => c.case_type === 'screening_review' && c.status !== 'closed');
      const inv = sc ? (await api.post(`/api/cases/${sc.id}/open-investigation`, {})).case : e.cases.find((c) => c.case_type === 'investigation' && c.status !== 'closed') ?? await api.post('/api/cases', { case_type: 'investigation', title: `Investigation — ${e.legal_name}`, entity_ids: [e.id], research_question: `What can be established from cited sources about ${e.legal_name}?` });
      ctx.go(`intel/investigations/${inv.id}`);
    } else ctx.go('risk/screening');
  }, { primary: true, disabled: isRisk && !write });

  const screen = btn('Run screening', async () => { const s = await api.post(`/api/entities/${e.id}/screen`); toast(`Screening ${s.ref}: ${label(s.status)}`); ctx.go(`risk/screening/${s.id}`); }, { disabled: !write, title: write ? null : 'Your role is read-only' });

  const left = h('div', { class: 'stack' },
    panel(null, null, h('div', null,
      h('div', { class: 'entity-hero' }, icon(e.legal_name), h('div', null, h('h2', null, e.legal_name), h('p', null, `${label(e.entity_type)} · ${e.jurisdiction ?? 'jurisdiction not recorded'}`), h('div', { style: 'margin-top:9px' }, originBadge(e.data_origin), ' ', pill('shared entity', 'blue')))),
      kv([['Reference', e.ref], ['Registration ID', e.registration_id], ['Description', e.description], ['Updated', fmt(e.updated_at ?? e.created_at)]]))),
    panel('Aliases & identifiers', 'Identifiers are what turn a name resemblance into something checkable',
      h('div', null,
        table([{ label: 'Type', render: (r) => r.t }, { label: 'Value', render: (r) => h('span', { class: 'mono' }, r.v) }, { label: 'Detail', render: (r) => r.d }],
          [...e.aliases.map((a) => ({ t: `alias · ${label(a.alias_type)}`, v: a.alias_text, d: a.source_id ? 'sourced' : 'no source' })), ...e.identifiers.map((i) => ({ t: label(i.identifier_type), v: i.identifier_value, d: i.issuing_jurisdiction ?? '—' }))],
          { empty: 'No aliases or identifiers recorded. Screening results will be limited to name similarity.' }),
        write ? h('div', { class: 'row pad' }, btn('＋ Alias', () => inlineAdd(ctx, e, 'aliases'), { small: true }), btn('＋ Identifier', () => inlineAdd(ctx, e, 'identifiers'), { small: true })) : null)),
    panel('Findings & evidence', 'Source facts are separated from assessments and unknowns',
      e.findings.length ? e.findings.map((f) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('p', null, f.claim), h('div', { class: 'small muted', style: 'margin-top:5px' }, label(f.finding_type), ' · ', f.source_id ? sourceRef(e.sources, f.source_id) : 'no source attached')), verifPill(f.verification_status)))
        : h('div', { class: 'empty-state' }, 'No findings yet.')),
    panel('Relationships', 'Unverified links are shown as such', e.relationships.length ? table([
      { label: 'Link', render: (r) => `${r.source_name} → ${r.target_name}` }, { label: 'Type', render: (r) => label(r.relationship_type) }, { label: 'Status', render: (r) => verifPill(r.verification_status) }, { label: 'Source', render: (r) => r.source_id ? sourceRef(e.sources, r.source_id) : h('span', { class: 'muted' }, 'none') }], e.relationships) : h('div', { class: 'empty-state' }, 'No relationships recorded.'), miniGraphLink(ctx, route, e.id)));

  const latest = e.screenings[0];
  const right = h('div', { class: 'stack' },
    panel('Screening context', 'Candidate review, never a clearance',
      h('div', { class: 'pad' }, latest
        ? h('div', null, h('div', { class: 'row' }, pill(label(latest.status), latest.status === 'pending_review' ? 'amber' : 'blue'), originBadge(latest.list_snapshot?.origin)), h('p', { class: 'small muted' }, `${latest.ref} · ${fmt(latest.created_at)} · ${latest.candidates.length} candidate(s)`), btn('Open screening', () => ctx.go(`risk/screening/${latest.id}`), { small: true }))
        : h('p', { class: 'small muted' }, 'Not screened yet.'), h('div', { style: 'margin-top:10px' }, screen))),
    panel('Cases & investigations', null, e.cases.length ? e.cases.map((c) => h('div', { class: 'case-row' }, h('div', { class: 'case-copy' }, h('strong', null, c.title), h('small', null, `${c.ref} · ${label(c.case_type)}`)), pill(c.status, c.status === 'closed' ? 'green' : 'amber'), btn('Open', () => ctx.go(c.case_type === 'investigation' ? `intel/investigations/${c.id}` : `risk/cases/${c.id}`), { small: true }))) : h('div', { class: 'empty-state' }, 'None yet.')),
    panel('Workspace handoff', 'Same record, other workspace', h('div', { class: 'pad' }, handoff, h('p', { class: 'hint', style: 'margin-top:8px' }, isRisk ? 'Opens (or reuses) an investigation linked to this same entity. Nothing is copied.' : 'Returns to the screening queue with this entity still selected.'))));

  return h('div', { class: 'stack' }, pageHead(isRisk ? 'Risk & compliance · shared entity' : 'Intelligence · shared entity', e.legal_name, `${e.ref} · visible in both workspaces`, btn('← Directory', () => ctx.go(`${route.mode}/entities`))), h('div', { class: 'entity-view' }, left, right));
}

export function sourceRef(sources, id) {
  const s = sources.find((x) => x.id === id);
  return s ? h('span', null, s.ref, ' · ', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noreferrer noopener' }, s.title) : s.title) : 'source (not shown)';
}

function inlineAdd(ctx, e, kind) {
  const host = document.getElementById('content');
  const dlg = h('div', { class: 'stack' });
  const fields = kind === 'aliases'
    ? [{ name: 'alias_text', label: 'Alias', required: true }, { name: 'alias_type', label: 'Type', type: 'select', options: [['trading_name', 'Trading name'], ['former_name', 'Former name'], ['short_name', 'Short name'], ['transliteration', 'Transliteration'], ['other', 'Other']] }]
    : [{ name: 'identifier_type', label: 'Identifier type', required: true, hint: 'e.g. registration_id, tax_id, imo' }, { name: 'identifier_value', label: 'Value', required: true }, { name: 'issuing_jurisdiction', label: 'Issuing jurisdiction' }];
  const wrap = panel(kind === 'aliases' ? 'Add alias' : 'Add identifier', null, form(fields, { submit: 'Add', cancel: () => wrap.remove(), onSubmit: async (d) => { await api.post(`/api/entities/${e.id}/${kind}`, d); toast('Added'); ctx.render(); } }));
  host.prepend(wrap);
  wrap.scrollIntoView({ behavior: 'smooth' });
}

// ------------------------------------------------------------------ sources
async function sources(ctx, route) {
  const [rows, lists] = await Promise.all([api.get('/api/sources'), api.get('/api/lists')]);
  const write = canWrite(ctx);
  const addHost = h('div');
  const add = btn('＋ Register source', () => addHost.replaceChildren(panel('Register a source', 'Record what it is, who published it, and when YOU retrieved it', form([
    { name: 'title', label: 'Title', required: true }, { name: 'publisher', label: 'Publisher', required: true },
    { name: 'url', label: 'URL', type: 'url', hint: 'http(s) only' }, { name: 'source_type', label: 'Type', type: 'select', options: ['registry', 'government', 'filing', 'news', 'company_site', 'official_list', 'analyst_note', 'other'].map((x) => [x, label(x)]), value: 'other' },
    { name: 'publication_date', label: 'Publication date', type: 'date' }, { name: 'retrieved_at', label: 'Retrieved at', type: 'datetime-local', hint: 'Leave blank if you have not retrieved it: it will be flagged "not retrieved".' },
    { name: 'license_status', label: 'Licence / terms', type: 'select', options: [['not_reviewed', 'Not reviewed'], ['permitted', 'Permitted'], ['restricted', 'Restricted'], ['unknown', 'Unknown']], value: 'not_reviewed' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], { submit: 'Register source', cancel: () => addHost.replaceChildren(), onSubmit: async (d) => { if (d.retrieved_at) d.retrieved_at = new Date(d.retrieved_at).toISOString(); const s = await api.post('/api/sources', d); toast(`Registered ${s.ref}`); ctx.render(); } }))), { primary: true, disabled: !write });
  return h('div', { class: 'stack' }, pageHead('Source registry', 'Sources & data freshness', 'Every claim should trace to a source with a retrieval time and licence status.', add), addHost,
    panel('Registered sources', `${rows.length} in your organization`, table([
      { label: 'Source', render: (s) => h('div', null, h('b', null, s.title), h('div', { class: 'small muted' }, `${s.ref} · ${s.publisher}`), s.url ? h('a', { class: 'small', href: s.url, target: '_blank', rel: 'noreferrer noopener' }, s.url) : null) },
      { label: 'Origin', render: (s) => originBadge(s.data_origin) },
      { label: 'Published', render: (s) => fmtDay(s.publication_date) },
      { label: 'Retrieved', render: (s) => s.retrieved_at ? `${fmt(s.retrieved_at)} (${ago(s.retrieved_at)})` : pill('not retrieved', 'amber') },
      { label: 'Licence', render: (s) => pill(s.license_status, s.license_status === 'permitted' ? 'green' : s.license_status === 'restricted' ? 'red' : 'amber') },
    ], rows, { empty: 'No sources yet.' })),
    listsPanel(lists.map((l) => l), route.mode),
    notice('info', 'Official OFAC and Consolidated Screening List pages are recorded as references only. ', h('b', null, 'No data has been fetched from them'), ', and their terms/licensing have not been reviewed.'));
}

// ------------------------------------------------------------------ audit
async function audit(ctx, route) {
  const [events, verify] = await Promise.all([api.get('/api/audit?limit=150'), api.get('/api/audit/verify')]);
  const recheck = btn('Re-verify chain', async () => { const v = await api.get('/api/audit/verify'); toast(v.ok ? `Chain intact · ${v.count} events` : `CHAIN BROKEN at event ${v.broken_at_seq}`); ctx.render(); });
  return h('div', { class: 'stack' }, pageHead('Integrity', 'Audit & integrity', 'Append-only, hash-chained log of every state change in your organization.', recheck),
    verify.ok ? notice('ok', h('b', null, 'Chain verified. '), `${verify.count} events; head hash `, h('span', { class: 'mono' }, verify.head.slice(0, 16) + '…'), '. Editing, deleting or reordering a stored event breaks verification. (Limit: anyone who can rewrite the whole datastore can recompute it. Anchor the head hash externally for real assurance.)')
      : notice('bad', h('b', null, 'Chain verification FAILED '), `at event ${verify.broken_at_seq}: ${verify.reason}.`),
    panel('Recent events', 'Newest first', table([
      { label: '#', render: (e) => e.seq }, { label: 'When', render: (e) => fmt(e.at) }, { label: 'Actor', render: (e) => e.actor_label },
      { label: 'Action', render: (e) => h('b', null, e.action) }, { label: 'Object', render: (e) => `${e.object_type}` },
      { label: 'Detail', render: (e) => h('span', { class: 'mono', style: 'white-space:normal;display:block;max-width:420px' }, JSON.stringify(e.metadata).slice(0, 220)) },
    ], events)));
}

export const pages = { dashboard, entities, entity, sources, audit };
