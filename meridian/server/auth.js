// Authentication, sessions, CSRF and role permissions.
// Passwords: scrypt with per-user salt. Session tokens: 256-bit random, only the
// SHA-256 digest is stored, so a leaked store cannot be replayed as cookies.

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, forbidden } from './validate.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const COOKIE = 'mid_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Role -> allowed actions. Roles are per organization membership.
const PERMISSIONS = {
  viewer: new Set(['read']),
  analyst: new Set(['read', 'write', 'screen', 'escalate', 'briefing']),
  reviewer: new Set(['read', 'write', 'screen', 'escalate', 'briefing', 'disposition']),
};
export function can(role, action) { return PERMISSIONS[role]?.has(action) ?? false; }
export function requireCan(user, action) {
  if (!can(user.role, action)) throw forbidden(`Role "${user.role}" cannot perform "${action}"`);
}

export class Auth {
  constructor(store, { dummyHash, csrfSecret }) {
    this.store = store;
    this.csrfSecret = csrfSecret;
    this.dummyHash = dummyHash; // verified when the email is unknown so timing doesn't reveal accounts
    this.failures = new Map(); // key -> [timestamps]
  }

  throttled(key) {
    const now = this.store.clock().getTime();
    const recent = (this.failures.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
    this.failures.set(key, recent);
    return recent.length >= 5;
  }
  noteFailure(key) { this.failures.get(key).push(this.store.clock().getTime()); }

  async login(email, password, ip) {
    const key = `${ip}|${String(email).toLowerCase()}`;
    if (this.throttled(key)) throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in 15 minutes.');
    const user = this.store.globalFind('users', (u) => u.email === String(email).toLowerCase());
    const ok = await verifyPassword(String(password), user ? user.password_hash : this.dummyHash);
    if (!user || !ok || user.disabled) {
      this.noteFailure(key);
      return { ok: false, user };
    }
    this.failures.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    this.store.globalInsert('sessions', {
      token_hash: sha256(token), user_id: user.id,
      expires_at: new Date(this.store.clock().getTime() + SESSION_TTL_MS).toISOString(),
    });
    return { ok: true, user, token, csrf: this.csrfFor(token) };
  }

  // Returns {user, session} or null. `user.role`/`org_id` come from the server-side
  // user record, never from anything the client sends.
  authenticate(cookieHeader) {
    const token = parseCookies(cookieHeader)[COOKIE];
    if (!token) return null;
    const session = this.store.globalFind('sessions', (s) => s.token_hash === sha256(token));
    if (!session) return null;
    if (Date.parse(session.expires_at) <= this.store.clock().getTime()) {
      this.store.globalDelete('sessions', (s) => s.id === session.id);
      return null;
    }
    const user = this.store.globalFind('users', (u) => u.id === session.user_id);
    if (!user || user.disabled) return null;
    return { user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role, org_id: user.org_id }, token, csrf: this.csrfFor(token) };
  }

  // CSRF token = HMAC(server secret, session token). Stateless, so the SPA can
  // re-read it from GET /api/me after a reload; other origins cannot read that
  // response (no CORS headers are ever sent).
  csrfFor(token) { return crypto.createHmac('sha256', this.csrfSecret).update(token).digest('base64url'); }

  checkCsrf(auth, headerValue) {
    if (!headerValue) return false;
    const a = Buffer.from(String(headerValue));
    const b = Buffer.from(auth.csrf);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  logout(cookieHeader) {
    const token = parseCookies(cookieHeader)[COOKIE];
    if (token) this.store.globalDelete('sessions', (s) => s.token_hash === sha256(token));
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure }) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
export function clearCookie({ secure }) {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
