// HTTP server: JSON API under /api + static SPA from ../public.
// Zero runtime dependencies (node:http only).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { Store } from './store.js';
import { Auth, hashPassword, verifyPassword, sessionCookie, clearCookie } from './auth.js';
import { appendAudit } from './audit.js';
import { seedDemo } from './seed.js';
import { HttpError } from './validate.js';
import * as svc from './service.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, '..', 'public');
const MAX_BODY = 100 * 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// [method, pattern, handler(ac, params, body, query, deps)]
const ROUTES = [
  ['GET', '/api/dashboard', (ac) => svc.dashboard(ac)],
  ['GET', '/api/entities', (ac, p, b, q) => svc.listEntities(ac, q)],
  ['POST', '/api/entities', (ac, p, b) => svc.createEntity(ac, b)],
  ['GET', '/api/entities/:id', (ac, p) => svc.getEntity(ac, p.id)],
  ['POST', '/api/entities/:id/aliases', (ac, p, b) => svc.addAlias(ac, p.id, b)],
  ['POST', '/api/entities/:id/identifiers', (ac, p, b) => svc.addIdentifier(ac, p.id, b)],
  ['POST', '/api/entities/:id/screen', (ac, p, b) => svc.runScreening(ac, p.id, b)],
  ['GET', '/api/graph/:id', (ac, p, b, q) => svc.graph(ac, p.id, Number(q.depth) || 1)],
  ['GET', '/api/sources', (ac) => svc.listSources(ac)],
  ['POST', '/api/sources', (ac, p, b) => svc.createSource(ac, b)],
  ['GET', '/api/lists', (ac) => svc.listLists(ac)],
  ['GET', '/api/screenings', (ac, p, b, q) => svc.listScreenings(ac, q)],
  ['GET', '/api/screenings/:id', (ac, p) => svc.getScreening(ac, p.id)],
  ['POST', '/api/screenings/:id/candidates/:cid/review', (ac, p, b) => svc.reviewCandidate(ac, p.id, p.cid, b)],
  ['POST', '/api/screenings/:id/candidates/:cid/escalate', (ac, p, b) => svc.escalateCandidate(ac, p.id, p.cid, b)],
  ['GET', '/api/cases', (ac, p, b, q) => svc.listCases(ac, q)],
  ['POST', '/api/cases', (ac, p, b) => svc.createCase(ac, b)],
  ['GET', '/api/cases/:id', (ac, p) => svc.getCase(ac, p.id)],
  ['PATCH', '/api/cases/:id', (ac, p, b) => svc.updateCase(ac, p.id, b)],
  ['POST', '/api/cases/:id/notes', (ac, p, b) => svc.addNote(ac, p.id, b)],
  ['POST', '/api/cases/:id/entities', (ac, p, b) => svc.linkEntity(ac, p.id, b)],
  ['POST', '/api/cases/:id/open-investigation', (ac, p, b) => svc.openInvestigation(ac, p.id, b)],
  ['POST', '/api/cases/:id/disposition', (ac, p, b) => svc.recordDisposition(ac, p.id, b)],
  ['POST', '/api/cases/:id/briefing', (ac, p, b, q, deps) => svc.createBriefing(ac, p.id, deps)],
  ['POST', '/api/findings', (ac, p, b) => svc.createFinding(ac, b)],
  ['PATCH', '/api/findings/:id', (ac, p, b) => svc.updateFinding(ac, p.id, b)],
  ['POST', '/api/relationships', (ac, p, b) => svc.createRelationship(ac, b)],
  ['PATCH', '/api/relationships/:id', (ac, p, b) => svc.updateRelationship(ac, p.id, b)],
  ['GET', '/api/system', (ac) => svc.system(ac)],
  ['GET', '/api/reports', (ac) => svc.listReports(ac)],
  ['GET', '/api/reports/:id', (ac, p) => svc.getReport(ac, p.id)],
  ['GET', '/api/audit', (ac, p, b, q) => svc.listAudit(ac, q)],
  ['GET', '/api/audit/verify', (ac) => svc.auditVerify(ac)],
].map(([method, pattern, handler]) => ({
  method, handler,
  re: new RegExp(`^${pattern.replace(/:([a-z]+)/g, '(?<$1>[^/]+)')}$`),
}));

function send(res, status, body, extra = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(payload);
}

async function readJson(req) {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Request body too large');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Request body too large');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid_json', 'Body is not valid JSON'); }
}

export const DEFAULT_DEMO_PASSWORD = 'meridian-demo-only';

// True if any stored account still accepts the published default password.
// Checked against the stored hashes, not just the environment, so an old database
// seeded with the default cannot be exposed by merely changing an env var.
export async function defaultPasswordInUse(store) {
  for (const u of store.globalAll('users')) if (await verifyPassword(DEFAULT_DEMO_PASSWORD, u.password_hash)) return true;
  return false;
}

export async function createApp({ store, secure = false, deps = {} } = {}) {
  if (!store.data.meta) store.data.meta = {};
  if (!store.data.meta.csrf_secret) { store.data.meta.csrf_secret = crypto.randomBytes(32).toString('hex'); store.persist(); }
  const auth = new Auth(store, { dummyHash: await hashPassword(crypto.randomBytes(8).toString('hex')), csrfSecret: store.data.meta.csrf_secret });

  async function handleApi(req, res, pathname, query) {
    const ip = req.socket.remoteAddress ?? 'unknown';

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJson(req);
      if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > 200) throw new HttpError(400, 'validation_error', 'email and password are required');
      const r = await auth.login(body.email, body.password, ip);
      if (!r.ok) {
        if (r.user) appendAudit(store, r.user.org_id, { actor: { id: r.user.id, email: r.user.email }, action: 'auth.login_failed', objectType: 'user', objectId: r.user.id, metadata: {} });
        throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
      }
      appendAudit(store, r.user.org_id, { actor: r.user, action: 'auth.login', objectType: 'user', objectId: r.user.id, metadata: {} });
      const ac = { store, user: { id: r.user.id, email: r.user.email, display_name: r.user.display_name, role: r.user.role, org_id: r.user.org_id } };
      return send(res, 200, { csrf: r.csrf, user: svc.me(ac) }, { 'Set-Cookie': sessionCookie(r.token, { secure }) });
    }
    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });

    const session = auth.authenticate(req.headers.cookie);
    if (!session) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    const ac = { store, user: session.user };

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!auth.checkCsrf(session, req.headers['x-csrf-token'])) throw new HttpError(403, 'csrf', 'Missing or invalid CSRF token');
      appendAudit(store, ac.user.org_id, { actor: ac.user, action: 'auth.logout', objectType: 'user', objectId: ac.user.id, metadata: {} });
      auth.logout(req.headers.cookie);
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie({ secure }) });
    }
    if (req.method === 'GET' && pathname === '/api/me') return send(res, 200, { user: svc.me(ac), csrf: session.csrf });

    const route = ROUTES.find((r) => r.method === req.method && r.re.test(pathname));
    if (!route) {
      if (ROUTES.some((r) => r.re.test(pathname))) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
      throw new HttpError(404, 'not_found', 'Unknown endpoint');
    }
    let body = {};
    if (req.method !== 'GET') {
      // CSRF: SameSite=Strict cookie + same-origin check + per-session token.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'csrf', 'Cross-origin request rejected');
      if (!auth.checkCsrf(session, req.headers['x-csrf-token'])) throw new HttpError(403, 'csrf', 'Missing or invalid CSRF token');
      body = await readJson(req);
    }
    const params = route.re.exec(pathname).groups ?? {};
    const result = route.handler(ac, params, body, query, deps);
    return send(res, req.method === 'POST' && !/(screen|review|escalate|disposition|open-investigation|briefing)$/.test(pathname) ? 201 : 200, result ?? { ok: true });
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://local');
      if (u.pathname.startsWith('/api/')) {
        // Never emit CORS headers: the API is same-origin only.
        if (req.method === 'OPTIONS') return send(res, 405, { error: { code: 'method_not_allowed', message: 'CORS is not enabled' } });
        return await handleApi(req, res, u.pathname, Object.fromEntries(u.searchParams));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
      return serveStatic(req, res, u.pathname);
    } catch (err) {
      if (err instanceof HttpError) {
        return send(res, err.status, { error: { code: err.code, message: err.message, details: err.details } }, err.status === 413 ? { Connection: 'close' } : {});
      }
      console.error('[internal error]', err); // details stay in the server log, never in the response
      return send(res, 500, { error: { code: 'internal_error', message: 'Unexpected server error' } });
    }
  });
}

// ------------------------------------------------------------------ CLI
if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const HOST = process.env.HOST ?? '127.0.0.1';
  const PORT = Number(process.env.PORT ?? 3000);
  const file = path.resolve(process.env.MERIDIAN_DB ?? path.join(here, '..', 'data', 'db.json'));
  const demoPassword = process.env.MERIDIAN_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
  const store = new Store({ file });
  if (!store.data.users.length) {
    if (!loopback && demoPassword === DEFAULT_DEMO_PASSWORD) {
      console.error('Refusing to seed a network-reachable server with the default demo password. Set MERIDIAN_DEMO_PASSWORD.');
      process.exit(1);
    }
    await seedDemo(store, { password: demoPassword });
    console.log('Seeded fictional demo data.');
  }
  if (!loopback && await defaultPasswordInUse(store)) {
    console.error('Refusing to bind to a non-loopback address: stored demo accounts still use the default password. Run `npm run reset` with MERIDIAN_DEMO_PASSWORD set.');
    process.exit(1);
  }
  const server = await createApp({ store, secure: process.env.MERIDIAN_SECURE_COOKIES === '1' });
  server.listen(PORT, HOST, () => {
    console.log(`Meridian Intelligence (DEMO — fictional data, simulated screening) → http://${HOST}:${PORT}`);
    console.log('Demo users: analyst@ / reviewer@ / viewer@harbor-demo.test, outsider@other-demo.test (other org)');
  });
}
