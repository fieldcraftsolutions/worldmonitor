// Minimal input validation. Every API handler validates through these helpers so
// untrusted input never reaches the store unchecked.

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'validation_error', message, details);
export const forbidden = (message = 'Not permitted for your role') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Record') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message) => new HttpError(409, 'conflict', message);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function str(v, name, { min = 1, max = 2000, required = true, oneOf } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`${name} must be a string`);
  const s = v.normalize('NFC').trim();
  if (CONTROL.test(s)) throw badRequest(`${name} contains control characters`);
  if (s.length < min) throw badRequest(`${name} must be at least ${min} characters`);
  if (s.length > max) throw badRequest(`${name} must be at most ${max} characters`);
  if (oneOf && !oneOf.includes(s)) throw badRequest(`${name} must be one of: ${oneOf.join(', ')}`);
  return s;
}

export function num(v, name, { min = 0, max = 1, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${name} must be a number between ${min} and ${max}`);
  return n;
}

export function date(v, name, { required = false } = {}) {
  const s = str(v, name, { required, max: 10 });
  if (s === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw badRequest(`${name} must be YYYY-MM-DD`);
  return s;
}

export function url(v, name, { required = false } = {}) {
  const s = str(v, name, { required, max: 2000 });
  if (s === undefined) return undefined;
  let u;
  try { u = new URL(s); } catch { throw badRequest(`${name} must be a valid URL`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest(`${name} must be an http(s) URL`);
  return u.toString();
}

export function id(v, name) {
  const s = str(v, name, { max: 64 });
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) throw badRequest(`${name} is not a valid id`);
  return s;
}

export function obj(v, name = 'body') {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${name} must be a JSON object`);
  return v;
}

export function idList(v, name, { max = 50 } = {}) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw badRequest(`${name} must be an array of at most ${max} ids`);
  return [...new Set(v.map((x, i) => id(x, `${name}[${i}]`)))];
}
