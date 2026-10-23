// Tiny DOM toolkit. Untrusted strings only ever reach the DOM as text nodes or
// attribute values set through setAttribute/textContent: never innerHTML.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM, allowed by CSP; a style="" attribute would be blocked
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const add = (kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

export const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDay = (d) => d || '—';
export function ago(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
export const label = (s) => String(s ?? '').replace(/_/g, ' ');

export const pill = (text, cls = 'grey') => h('span', { class: `pill ${cls}` }, h('span', { class: 'dot' }), label(text));

const VERIF_CLS = { verified: 'green', corroborated: 'green', unverified: 'amber', disputed: 'red', rejected: 'grey', unknown: 'grey' };
export const verifPill = (s) => pill(s, VERIF_CLS[s] ?? 'grey');

const ORIGIN = {
  simulated_fixture: ['SIMULATED', 'sim'],
  demo_fictional: ['FICTIONAL', 'violet'],
  analyst_supplied: ['ANALYST-SUPPLIED', 'blue'],
  analyst_entered: ['ANALYST-ENTERED', 'blue'],
  official_reference_only: ['REFERENCE ONLY · NOT RETRIEVED', 'amber'],
  official_live: ['LIVE OFFICIAL FEED', 'green'],
};
export function originBadge(origin) {
  const [text, cls] = ORIGIN[origin] ?? [origin ?? 'UNKNOWN ORIGIN', 'grey'];
  return h('span', { class: `pill ${cls}`, title: 'Data origin' }, text);
}

export function freshPill(f) {
  if (!f) return pill('unknown', 'grey');
  const cls = f.state === 'current' ? 'green' : f.state === 'stale' ? 'red' : 'amber';
  return pill(f.state === 'not_retrieved' ? 'not retrieved' : `${f.state}${f.age_days != null ? ` · ${f.age_days}d` : ''}`, cls);
}

export function panel(title, subtitle, body, actions) {
  return h('section', { class: 'panel' },
    title ? h('div', { class: 'panel-head' }, h('div', null, h('h2', null, title), subtitle ? h('p', null, subtitle) : null), actions ? h('div', { class: 'row' }, actions) : null) : null,
    body);
}

export const btn = (text, onclick, { primary, danger, small, disabled, title } = {}) =>
  h('button', { class: `btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}${small ? ' small' : ''}`, type: 'button', onclick, disabled, title }, text);

export function pageHead(eyebrow, title, sub, ...actions) {
  return h('div', { class: 'heading-row' }, h('div', null, h('div', { class: 'eyebrow' }, eyebrow), h('h1', null, title), h('div', { class: 'subhead' }, sub)), h('div', { class: 'actions' }, actions));
}

export function notice(kind, ...kids) { return h('div', { class: `notice ${kind}`, role: kind === 'bad' ? 'alert' : null }, ...kids); }

export function table(cols, rows, { empty = 'Nothing here yet.', onRow } = {}) {
  if (!rows.length) return h('div', { class: 'empty-state' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', { style: onRow ? 'cursor:pointer' : null, onclick: onRow ? () => onRow(r) : null }, cols.map((c) => h('td', null, c.render(r))))))));
}

// fields: [{name,label,type:'text'|'textarea'|'select'|'checkbox'|'date'|'url', options:[[value,label]], required, hint, value}]
export function form(fields, { submit = 'Save', onSubmit, cancel }) {
  const err = h('div', { class: 'err', role: 'alert' });
  const inputs = {};
  const rows = fields.map((f) => {
    let input;
    if (f.type === 'textarea') input = h('textarea', { name: f.name, required: f.required, maxlength: f.max ?? 4000 }, f.value ?? '');
    else if (f.type === 'select') input = h('select', { name: f.name, required: f.required }, (f.options ?? []).map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
    else if (f.type === 'multiselect') input = h('select', { name: f.name, multiple: true, size: Math.min(6, Math.max(3, (f.options ?? []).length)) }, (f.options ?? []).map(([v, l]) => h('option', { value: v }, l)));
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', name: f.name });
    else input = h('input', { type: f.type ?? 'text', name: f.name, required: f.required, value: f.value ?? '', maxlength: f.max ?? 500 });
    inputs[f.name] = input;
    return f.type === 'checkbox'
      ? h('label', { class: 'check' }, input, h('span', null, f.label, f.hint ? h('div', { class: 'hint' }, f.hint) : null))
      : h('label', null, f.label, input, f.hint ? h('span', { class: 'hint' }, f.hint) : null);
  });
  const el = h('form', { class: 'form', novalidate: false }, rows, err,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, submit), cancel ? btn('Cancel', cancel) : null));
  el.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    const data = {};
    for (const f of fields) {
      const i = inputs[f.name];
      data[f.name] = f.type === 'checkbox' ? i.checked : f.type === 'multiselect' ? [...i.selectedOptions].map((o) => o.value) : (i.value === '' ? undefined : i.value);
    }
    const b = el.querySelector('button[type=submit]'); b.disabled = true;
    try { await onSubmit(data, el); } catch (ex) { err.textContent = ex.message; } finally { b.disabled = false; }
  });
  return el;
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]));
}

export function timeline(events) {
  if (!events?.length) return h('div', { class: 'empty-state' }, 'No audit events.');
  return h('div', { class: 'tl' }, events.map((e) => h('div', { class: 'tl-item' },
    h('time', null, fmt(e.at)), h('div', null, h('b', null, e.action), ' ', h('span', { class: 'muted' }, `by ${e.actor_label}`)))));
}

export const icon = (c) => h('div', { class: 'entity-icon' }, (c ?? '?').slice(0, 1).toUpperCase());
