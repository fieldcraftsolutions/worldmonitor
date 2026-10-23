import { h, toast, btn, pill, label } from './ui.js';
import { api, setCsrf } from './api.js';
import * as shared from './pages-shared.js';
import * as risk from './pages-risk.js';
import * as intel from './pages-intel.js';

const MODES = {
  risk: { name: 'Risk & Compliance', icon: '◈', nav: [['dashboard', '▦', 'Overview'], ['screening', '◎', 'Screening queue'], ['cases', '▤', 'Compliance cases'], ['entities', '◇', 'Entity directory'], ['sources', '↗', 'Sources & data freshness'], ['audit', '⛓', 'Audit & integrity']] },
  intel: { name: 'Intelligence & Investigations', icon: '⌘', nav: [['dashboard', '▦', 'Overview'], ['investigations', '⌕', 'Investigations'], ['entities', '◇', 'Entity profiles'], ['graph', '⌘', 'Relationship map'], ['reports', '▤', 'Briefings & reports'], ['sources', '↗', 'Source registry'], ['audit', '⛓', 'Audit & integrity']] },
};
const SHARED_PAGES = new Set(['entities', 'entity', 'sources', 'audit']); // same page in either workspace: the mode switch keeps you here

const store = (() => { try { return window.sessionStorage; } catch { return null; } })();
const load = (k, d) => { try { return JSON.parse(store?.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { store?.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: state is just not remembered */ } };

export const state = { user: null, selected: load('selected', null), last: load('last', {}), integrations: null };

export function parseHash() {
  const [, mode, page, id] = location.hash.split('/');
  return { mode: MODES[mode] ? mode : 'risk', page: page || 'dashboard', id: id || null };
}
export const go = (path) => { location.hash = `#/${path}`; };
// The sidebar box is rendered by the shell, but pages call selectEntity() after the shell is
// already on screen, so update the box in place as well as the saved state.
function selectedBox(mode) {
  const sel = state.selected;
  return [h('small', null, 'Selected entity'),
    sel ? h('a', { onclick: () => go(`${mode}/entity/${sel.id}`) }, `${sel.name} · ${sel.ref}`) : h('span', { class: 'none' }, 'None. Open one from the directory.')];
}
export function selectEntity(e) {
  state.selected = e ? { id: e.id, name: e.legal_name, ref: e.ref } : null;
  save('selected', state.selected);
  document.getElementById('selected-entity')?.replaceChildren(...selectedBox(parseHash().mode));
}

function switchMode(target) {
  const cur = parseHash();
  if (SHARED_PAGES.has(cur.page)) return go(`${target}/${cur.page}${cur.id ? `/${cur.id}` : ''}`);
  go(`${target}/${state.last[target] ?? 'dashboard'}`);
}

const ctx = { state, go, selectEntity, switchMode, parseHash };

function shell(route, content) {
  const m = MODES[route.mode];
  const activeNav = route.page === 'entity' ? 'entities' : route.page;
  return h('div', null,
    h('div', { class: 'demo-banner', role: 'note' }, 'DEMO DATA — NOT FOR REAL-WORLD SCREENING · Fictional records · Screening list and AI briefings are simulated'),
    h('div', { class: 'app' },
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'M'), h('div', null, h('div', { class: 'brand-name' }, 'MERIDIAN'), h('div', { class: 'brand-sub' }, 'Intelligence platform'))),
        h('div', { class: 'mode-label' }, 'Active workspace'),
        h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Workspace' },
          Object.entries(MODES).map(([k, v]) => h('button', { class: `mode-btn${route.mode === k ? ' active' : ''}${k === 'intel' && route.mode === k ? ' invest' : ''}`, id: `mode-${k}`, 'aria-pressed': String(route.mode === k), onclick: () => switchMode(k) }, h('span', { class: 'mi' }, v.icon), k === 'risk' ? 'Risk & Compliance' : 'Intelligence'))),
        h('div', { class: 'sel-entity', id: 'selected-entity' }, selectedBox(route.mode)),
        h('div', { class: 'nav-section' }, m.name),
        h('nav', { class: 'nav' }, m.nav.map(([p, ico, text]) => h('button', { class: activeNav === p ? 'active' : '', 'data-page': p, onclick: () => go(`${route.mode}/${p}`) }, h('span', { class: 'ico' }, ico), text))),
        h('div', { class: 'sidebar-bottom' }, h('div', { class: 'profile' }, h('div', { class: 'avatar' }, state.user.display_name.slice(0, 1)),
          h('div', null, h('strong', null, state.user.display_name), h('small', null, `${label(state.user.role)} · ${state.user.organization}`)),
        ), h('button', { class: 'btn small', style: 'margin-top:12px;width:100%;justify-content:center', onclick: logout }, 'Sign out'))),
      h('main', { class: 'main' },
        h('header', { class: 'topbar' },
          h('div', { class: 'crumb' }, 'Meridian ', h('span', { style: 'padding:0 8px;color:#c4ccd7' }, '/'), h('b', null, m.name)),
          h('div', { class: 'top-actions' }, h('div', { class: 'search' }, h('span', { class: 'glass' }, '⌕'),
            h('input', { id: 'globalSearch', type: 'search', placeholder: 'Search entities, aliases, identifiers…', 'aria-label': 'Search entities', onkeydown: (e) => { if (e.key === 'Enter') { sessionStorageSet('q', e.target.value); go(`${route.mode}/entities`); } } })),
            h('span', { class: 'small muted' }, state.user.email))),
        h('div', { class: 'content', id: 'content' }, content))));
}
function sessionStorageSet(k, v) { save(`ui:${k}`, v); }

async function render() {
  const root = document.getElementById('root');
  if (!state.user) return;
  const route = parseHash();
  if (!SHARED_PAGES.has(route.page)) state.last[route.mode] = route.page + (route.id ? `/${route.id}` : '');
  save('last', state.last);
  const pages = { ...shared.pages, ...(route.mode === 'risk' ? risk.pages : intel.pages) };
  const fn = pages[route.page];
  const content = h('div', null, h('div', { class: 'empty-state' }, 'Loading…'));
  root.replaceChildren(shell(route, content));
  try {
    const body = fn ? await fn(ctx, route) : h('div', { class: 'empty-state' }, 'This page does not exist in this workspace.');
    document.getElementById('content').replaceChildren(body);
  } catch (e) {
    if (e.status === 401) return;
    document.getElementById('content').replaceChildren(h('div', { class: 'notice bad', role: 'alert' }, `Could not load this page: ${e.message}`));
  }
}
ctx.render = render;

function loginView(msg) {
  const root = document.getElementById('root');
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'username', value: 'analyst@harbor-demo.test' });
  const pw = h('input', { id: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('div', { class: 'err', role: 'alert' }, msg ?? '');
  const f = h('form', { class: 'form', onsubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    try {
      const r = await api.post('/api/auth/login', { email: email.value, password: pw.value });
      setCsrf(r.csrf); state.user = r.user; pw.value = '';
      location.hash = location.hash.startsWith('#/') ? location.hash : '#/risk/dashboard';
      render();
    } catch (e) { err.textContent = e.message; }
  } },
  h('label', null, 'Email', email), h('label', null, 'Password', pw), err, h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'));
  root.replaceChildren(
    h('div', { class: 'demo-banner' }, 'DEMO DATA — NOT FOR REAL-WORLD SCREENING'),
    h('div', { class: 'login' }, h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Meridian Intelligence'), h('p', null, 'Local demo · fictional organization and data'))),
      f,
      h('div', { class: 'pad small muted' }, 'Demo accounts (all in the fictional "Harbor Demo Compliance" org): analyst@, reviewer@, viewer@ harbor-demo.test. Password: see README (local demo default). outsider@other-demo.test belongs to a different org, to demonstrate isolation.'))));
}

async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* already signed out */ }
  state.user = null; setCsrf(null); selectEntity(null); loginView();
}

window.addEventListener('hashchange', render);
window.addEventListener('meridian:unauthenticated', () => { if (state.user) { state.user = null; loginView('Your session has ended. Please sign in again.'); } });

(async function boot() {
  try {
    const me = await api.get('/api/me');
    setCsrf(me.csrf); state.user = me.user;
    if (!location.hash) location.hash = '#/risk/dashboard';
    render();
  } catch { loginView(); }
})();
