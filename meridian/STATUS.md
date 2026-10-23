# Status report

Last updated by the implementing agent in the same session as the code. Every claim below is either
**verified** (with the command that proves it), **not verified**, or **not built**.

## Delivered since the handoff

The handoff contained a static HTML prototype (all buttons were toasts), a scaffold schema, and prompts. This iteration
adds a working end-to-end application that preserves the two-workspace mode switch and the shared engine.

| Area | Result |
|---|---|
| Vertical slice from the handoff | **Working.** Search → screen → review candidate → escalate → investigation on the *same* entity → source + finding → cited briefing → reviewer disposition → audit trail. |
| Mode switch | Persistent on every screen; preserves the selected entity; remembers last page per mode; shared pages (entities, sources, audit) stay put when you switch. |
| Matching | Explainable: reasons, conflicts, data gaps; conflicts lower the score but never drop a candidate. |
| Briefings | Built only from stored records, citation-checked, verdict language rejected, freshness/licence warnings. |
| Schema | Rewritten around organizations + composite FKs + protected audit; tested on Postgres 16. |
| Security | Auth, roles, tenant isolation, CSRF, CSP, hashed sessions, audit chain; see `docs/SECURITY_NOTES.md`. |

## Verified (and how)

| Claim | Evidence |
|---|---|
| 37 server-side tests pass | `npm test` (workflow, security, integrity, honesty, ingestion) |
| Schema applies cleanly, is idempotent, and 51 RLS/constraint/audit checks hold on real Postgres 16 | `npm run test:rls` |
| Whole workflow works in a real browser (16 steps, no console/CSP errors, XSS payload inert) | `npm run test:e2e` (Chromium via Playwright) |
| Cross-tenant reads, writes **and references** are blocked, in app code and in SQL | `tests/security.test.js`, `supabase/test/rls.sql` |
| Audit tampering is detected (edit/delete/reorder/actor rewrite; privileged bypass in Postgres) | `tests/integrity.test.js`, `supabase/test/rls.sql` |

Bugs the tests caught during this iteration (so they are not theoretical): the briefing validator rejected the generator's own
"is not a confirmed match" caution (made negation-aware); an identifier *conflict* could silently drop a candidate (now it only
lowers the displayed score); the strict CSP silently blocked inline styles (moved to CSSOM).

## Not verified / not built

| Item | State |
|---|---|
| **Live OFAC / CSL data** | **Not connected.** The build sandbox cannot reach OFAC (proxy 403), so the SDN column layout in `server/ingest/ofac-sdn.js` is **unverified against a real file**. Terms/licensing **not reviewed**. |
| **Live AI model** | **Not connected.** No API key, no model call has ever been made. The provider interface and validator are ready; a real model must pass the same validator. |
| **Supabase** | Schema tested on plain Postgres 16 with an `auth` shim. **Never applied to a Supabase project**; Supabase Auth, JWT claims, and PostgREST behaviour are untested. The demo app does not use Postgres. |
| **Deployment** | Not deployed anywhere. Local only. |
| **Matching quality** | Heuristic thresholds are untuned; no labelled test set; no transliteration, phonetics, DOB or nationality features. False-positive/negative rates are **unknown**. |
| **Security review** | Self-tested only. No independent review, no penetration test. No MFA/SSO, no password reset, no account management UI, no TLS termination in-app. |
| **Real users** | No analyst interviews yet. Demand and workflow fit are **unvalidated**. |
| **Naming** | "Meridian Intelligence" is not trademark/domain-cleared. |

## Known limitations (by design for a demo)

- JSON-file store: single process, no concurrency control, whole-file rewrite on each write.
- Sessions and login throttling are in memory/JSON (throttle resets on restart).
- The audit chain proves tampering only against someone who cannot rewrite the whole store; anchor the head hash externally.
- Entities cannot yet be edited or archived through the UI; there is no entity merge/dedup.
- Relationship graph layout is a simple radial layout, adequate for small neighbourhoods only.

## Recommended next steps (in order)

1. **Wire the app to Postgres** (use `supabase/schema.sql`), then re-run the browser suite against it. Apply to a real Supabase dev project and run `test:rls`-style checks over PostgREST with real JWTs.
2. **Verify OFAC access** from an unrestricted network: download the files, check the real column layout, read the terms, then record `license_status` and run the importer. Add the Consolidated Screening List as a second importer.
3. **Evaluate matching**: build a small labelled test set (true matches, near-miss names, transliterations); measure false positives/negatives; tune and document thresholds before any claim about quality.
4. **Connect a model provider** behind `briefing.js`'s provider interface; keep the validator mandatory; add an analyst-correction counter (a metric from the spec).
5. **User validation**: walk 5–8 sanctions/due-diligence analysts through `docs/DEMO_WALKTHROUGH.md`; measure handoff completion and re-entry avoided.
6. Entity edit/archive/merge, case assignment UI, report export (PDF), MFA/SSO, external audit-head anchoring.
