import { Store } from '../server/store.js';
import { seedDemo } from '../server/seed.js';
import { createApp } from '../server/index.js';
import http from 'node:http';

export const PASSWORD = 'test-password-123';

export async function boot({ clock } = {}) {
  const store = new Store({ clock });
  await seedDemo(store, { password: PASSWORD });
  const server = await createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    const c = { cookie: null, csrf: null, user: null };
    async function call(method, path, body, { csrf = true, headers = {} } = {}) {
      const h = { ...headers };
      if (c.cookie) h.cookie = c.cookie;
      if (body !== undefined) h['content-type'] = 'application/json';
      if (csrf && c.csrf && method !== 'GET' && !('x-csrf-token' in h)) h['x-csrf-token'] = c.csrf;
      const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, headers: res.headers };
    }
    c.get = (p, o) => call('GET', p, undefined, o);
    c.post = (p, b = {}, o) => call('POST', p, b, o);
    c.patch = (p, b = {}, o) => call('PATCH', p, b, o);
    c.login = async (email, password = PASSWORD) => {
      const r = await call('POST', '/api/auth/login', { email, password }, { csrf: false });
      if (r.status === 200) {
        c.cookie = r.headers.get('set-cookie').split(';')[0];
        c.csrf = r.body.csrf; c.user = r.body.user;
      }
      return r;
    };
    return c;
  }
  const as = async (email) => { const c = client(); const r = await c.login(email); if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`); return c; };
  const close = () => new Promise((r) => server.close(r));
  return { store, server, base, client, as, close };
}

export const A = { analyst: 'analyst@harbor-demo.test', reviewer: 'reviewer@harbor-demo.test', viewer: 'viewer@harbor-demo.test', outsider: 'outsider@other-demo.test' };

export async function entityByName(c, name) {
  const r = await c.get('/api/entities?q=' + encodeURIComponent(name));
  return r.body.find((e) => e.legal_name === name);
}

// Raw HTTP request that does not normalise the path or drop forbidden headers
// (fetch() rewrites Origin and collapses dot-segments, hiding attacks from tests).
export function raw(base, method, path, { headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
      let data = ''; res.on('data', (d) => (data += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
