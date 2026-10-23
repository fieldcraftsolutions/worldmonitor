# Security notes

Scope: the demo application (`server/`, `public/`) and the Postgres schema (`supabase/schema.sql`). **Self-tested only.** No
independent review or penetration test has been done; do not put real or confidential data into it.

## Assets and threats considered

| Threat | Control | Evidence |
|---|---|---|
| Reading another organization's data (IDOR, search, graph, audit) | Every query takes an org id; foreign records are indistinguishable from missing; RLS in Postgres | `tests/security.test.js`, `supabase/test/rls.sql` |
| Writing *references* into another tenant (the starter schema's child-owner divergence) | App-level `assertRefs`; composite `(id, org_id)` foreign keys in SQL | same |
| Privilege escalation (analyst closing a match, self-granting admin) | Role gates in the service layer; SQL trigger `guard_case_update`; admin-only membership policy | same |
| Forged or edited audit history | Hash chain per org; no client write path; append-only trigger; `verify_audit_chain` detects bypass | `tests/integrity.test.js`, `rls.sql` |
| CSRF | HttpOnly `SameSite=Strict` cookie + per-session HMAC token + same-origin `Origin` check + JSON-only content type | `security.test.js` |
| XSS / stored markup | UI builds DOM with `textContent` (no `innerHTML` on data); CSP `script-src 'self'`, `style-src 'self'`; JSON responses | e2e step 12 (payload inert, 0 CSP violations) |
| Credential stuffing / enumeration | scrypt; constant-time dummy hash for unknown users; identical error; 5 failures / 15 min throttle | `security.test.js` |
| Session theft from the store | Only SHA-256 of the session token is stored; 8 h expiry; logout deletes | `security.test.js` |
| Path traversal / source disclosure | Static root is `public/` only; resolved-path prefix check | `security.test.js` |
| Oversized / malformed input | 100 KB body cap (checked on `Content-Length` and while streaming), strict validators, control-character rejection, `http(s)`-only URLs | `security.test.js` |
| Unsupported or overclaimed output | Citation + verdict validator on every briefing; no "confirmed" state; evidence rules as DB constraints | `integrity.test.js`, `rls.sql` |
| Exposing the demo to a network with a known password | Refuses to bind a non-loopback address with the default demo password | `server/index.js` |

## Residual risks and what is **not** covered

- A party who can rewrite the whole datastore (JSON file, or a Postgres superuser who disables triggers) can recompute the audit chain. Mitigation to build: anchor the head hash externally on a schedule.
- No TLS in the app: terminate TLS in front and set `MERIDIAN_SECURE_COOKIES=1`. No HSTS header is sent yet.
- No MFA, SSO, password reset, account lockout beyond throttling, or session listing/revocation.
- Login throttling is per IP+email in memory and resets on restart; no global rate limiting on the API.
- The JSON store has no concurrency control or encryption at rest (file mode `0600` only).
- Dependency posture is excellent by absence (no npm packages) but there is no automated vulnerability scanning for the runtime.
- Supabase specifics (JWT claims, PostgREST exposure of the `meridian` schema, service-role key handling) are **untested**: the schema was tested with a shim.
- The briefing "verdict" filter is a pattern list, not a semantic guarantee: it reduces risk from model output, it does not eliminate it. Human review remains mandatory.

## Before any real data

1. Apply to a real Supabase project and re-run isolation/role/audit checks over the real API with real JWTs.
2. Independent security review of RLS, functions (`SECURITY DEFINER` search_path), and key handling.
3. Decide retention/deletion, backups, incident response, and data-processing terms.
4. Review official-source licensing and legal requirements for screening tools.
