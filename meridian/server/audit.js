// Append-only, hash-chained audit log, one chain per organization.
// Each event commits to the previous event's hash, so editing, deleting or
// reordering a stored event is detected by verifyChain().
//
// Limits (be honest in demos): anyone who can rewrite the whole store can
// recompute the chain. For real tamper-resistance, periodically anchor
// `head` outside the system (the Postgres schema does this inside the DB with
// a trigger and revoked privileges).

import crypto from 'node:crypto';

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const GENESIS = '0'.repeat(64);

function hashEvent(prev, e) {
  const body = canonical({
    seq: e.seq, at: e.at, actor_id: e.actor_id, actor_label: e.actor_label,
    action: e.action, object_type: e.object_type, object_id: e.object_id, metadata: e.metadata,
  });
  return crypto.createHash('sha256').update(prev).update('\n').update(body).digest('hex');
}

export function appendAudit(store, orgId, { actor, action, objectType, objectId = null, metadata = {} }) {
  const events = store.list(orgId, 'audit_events');
  const last = events.length ? events.reduce((a, b) => (a.seq > b.seq ? a : b)) : null;
  const e = {
    seq: last ? last.seq + 1 : 1,
    at: store.now(),
    actor_id: actor?.id ?? null,
    actor_label: actor?.email ?? 'system',
    action,
    object_type: objectType,
    object_id: objectId,
    metadata,
  };
  e.prev_hash = last ? last.hash : GENESIS;
  e.hash = hashEvent(e.prev_hash, e);
  return store.insert(orgId, 'audit_events', e);
}

export function verifyChain(store, orgId) {
  const events = store.list(orgId, 'audit_events').sort((a, b) => a.seq - b.seq);
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) return { ok: false, count: events.length, broken_at_seq: e.seq, reason: 'sequence gap or reorder' };
    if (e.prev_hash !== prev) return { ok: false, count: events.length, broken_at_seq: e.seq, reason: 'previous-hash mismatch' };
    if (hashEvent(prev, e) !== e.hash) return { ok: false, count: events.length, broken_at_seq: e.seq, reason: 'event content altered' };
    prev = e.hash;
  }
  return { ok: true, count: events.length, head: prev };
}
