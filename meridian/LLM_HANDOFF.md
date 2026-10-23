# Meridian Intelligence: LLM handoff brief (living document, v2)

This file is the source of truth. The original v1 brief is preserved unchanged, with headings demoted one level, in the section
**Original brief (v1)** at the bottom; the untouched package is in `starter_pack/`.

## Current state (v2)

A working, tested, locally runnable application now exists in this directory (`meridian/`). Read `README.md` first,
then `STATUS.md` (verified vs not verified), then `docs/`.

**Preserved from v1:** the persistent two-workspace mode switch (Risk & Compliance / Intelligence) and the shared intelligence
engine (entities, aliases, identifiers, sources, findings, relationships, cases, audit). Switching modes keeps the selected
entity and last page; handoffs link the same entity records.

**The vertical slice from v1 is implemented and tested end to end:** search/select a fictional entity → run a screening →
review an explainable candidate → escalate to a case → open an investigation on the same entity → register a source and a
sourced finding → generate a cited briefing from stored records only → record a reviewer disposition → audit trail with chain
verification.

### Run and verify

```bash
cd meridian
npm start            # app on http://127.0.0.1:3000 (README lists demo accounts)
npm test             # 32 tests, zero dependencies
npm run test:rls     # schema + 51 RLS/constraint/audit checks on a throwaway Postgres 16
npm run test:e2e     # 16-step real-browser workflow (needs Playwright + Chromium)
```

### Real vs simulated (do not blur this)

| Real and tested | Simulated or absent |
|---|---|
| Auth/roles/sessions/CSRF, org isolation, audit hash chain, evidence rules, explainable matcher, citation validator, Postgres schema (on plain Postgres 16) | **Screening list is a fictional fixture.** **No LLM is connected** (deterministic template). **OFAC/CSL not connected** (importer is fixture-tested only; real layout unverified). **Not applied to Supabase.** Persistence in the app is a JSON file. Not deployed. |

Never describe the project as live sanctions screening, AI-powered, production-ready or deployed.

### Decisions made in v2 (so you need not re-litigate them)

1. **Zero-dependency Node app** instead of waiting on Lovable: runnable anywhere, demonstrable now. Lovable prompts were rewritten as sequential milestones (`docs/BUILD_PROMPTS.md`); no Lovable account was accessed.
2. **Organization tenancy** with roles (viewer/analyst/reviewer), not owner-only rows. Cross-tenant *references* are rejected (app) and impossible (composite FKs in SQL).
3. **No "confirmed match" state exists anywhere.** Candidate states: pending_review, inconclusive, escalated, not_a_match, retained_potential_match.
4. **Conflicts never hide a candidate.** An identifier or jurisdiction conflict lowers the displayed score; only an analyst can dismiss.
5. **Closing as "not a match" needs a reviewer, a rationale (≥20 chars), linked evidence, and an explicit acknowledgement if an identifier agreed.** The disposition stores the origin and freshness of the list relied on.
6. **Briefings** are built from stored records, then run through a mandatory validator (uncited claims, unknown citations, verdict language, AI-marked-verified). Any future model provider must pass the same validator.
7. **Audit** is append-only and hash-chained per org; clients have no write path.
8. The integration registry (`GET /api/system`) is the single source of truth for real/simulated claims, and a test pins it.

### Next actions (priority order)

1. Wire the app to Postgres/Supabase using `supabase/schema.sql`; re-run the browser suite and RLS checks over the real API.
2. From an unrestricted network, verify OFAC access, real file layout, terms and cadence; then update `server/ingest/ofac-sdn.js` and fixtures. Add the Consolidated Screening List.
3. Build a labelled matching evaluation set; measure and document false positives/negatives; tune thresholds.
4. Connect a model provider behind `briefing.js`'s provider interface (validator mandatory); log generations.
5. Validate with 5–8 practitioners using `docs/DEMO_WALKTHROUGH.md`.
6. Entity edit/archive/merge, report export, MFA/SSO, external audit-head anchoring.

### Conventions

- No real, confidential or employer data. Demo URLs use `.invalid`.
- Update `STATUS.md` and the `INTEGRATIONS` registry in `server/service.js` whenever reality changes; add a test when a claim changes.
- Be explicit about what you ran. Do not claim an external service is configured or deployed unless verified.

---

## Original brief (v1)

### Purpose of this file

This document transfers the product context, decisions, existing artifacts, and recommended next actions to another LLM or AI coding agent. Treat the accompanying files as the current project baseline. Continue the work rather than restarting discovery or asking the user to re-approve routine product decisions.

### User's operating preference

The user explicitly said: **“Don’t have to check in with me, run with your ideas.”** Take initiative, make reasonable product and implementation decisions, and deliver concrete progress. Ask questions only when blocked by an essential choice, credential, external account access, or an irreversible action. Do not imply external services were configured or deployed unless verified.

### Project at a glance

- **Working name:** Meridian Intelligence (not yet trademark/domain-cleared).
- **Goal:** An ambitious, evolving AI-assisted portfolio product with possible commercial potential and career value.
- **Domain:** Sanctions, compliance, international trade, corporate intelligence, due diligence, and investigations.
- **Build preference:** No-code / AI-assisted, using tools such as Lovable, Supabase, and a server-side AI API.
- **Key differentiator:** One product with a persistent **mode switch** between two specialist workspaces and a shared underlying intelligence layer.

#### Workspace A — Risk & Compliance

- Screening queue and potential-match review
- Sanctions/restricted-party screening context
- Compliance cases, analyst dispositions, and audit history
- Data source registry and freshness indicators
- International trade / jurisdiction risk as a later expansion

#### Workspace B — Intelligence & Investigations

- Corporate/person/entity profiles
- Public-source research and evidence register
- Entity relationships and relationship graph
- Investigation cases, timelines, gaps, and hypotheses
- Source-backed AI intelligence briefings

#### Shared intelligence layer

Entities, aliases, identifiers, relationships, source records, findings, cases, evidence provenance, analyst notes, and audit events. Records should be reusable across workspaces only where authorization permits. Distinguish verified facts, potential matches, analyst assessments, AI synthesis, contradictory evidence, and unknowns.

### Important product principles

1. AI assists analysts; it does not make final legal/compliance determinations.
2. Never treat a name-only similarity as a confirmed sanctions match.
3. A lack of a match is not proof that an entity is clear.
4. Every source-backed claim should retain source title/publisher, URL, publication date when available, retrieval timestamp, and source/license status.
5. Display uncertainty, conflicting evidence, missing data, and stale/unavailable sources explicitly.
6. Use clearly labelled fictional records for the public demo. Do not use confidential employer or customer data.
7. Keep all API secrets server-side; use authentication, authorization, row-level security, and audit trails.
8. Check official source terms/licensing and security/legal requirements before commercialization.

### Current artifacts in this package

- `prototype.html` — standalone interactive front-end prototype; synthetic demo data only.
- `PRODUCT_SPEC.md` — product thesis, users, scope, workflow, acceptance criteria, metrics, and risks.
- `LOVABLE_BUILD_PROMPT.md` — prompt to build the app in Lovable.
- `supabase/schema.sql` — starter Supabase/Postgres schema and basic owner-scoped RLS policies. This is a development scaffold, not production-certified security.
- `LINKEDIN_LAUNCH.md` — draft LinkedIn announcement and portfolio case-study outline.
- `README.md` — overview and suggested implementation sequence.

### What exists vs. what does not

**Exists:** product concept, UI prototype, product specification, build prompt, initial SQL schema, launch draft.

**Not yet established:** a deployed production application, real user authentication, a live Supabase project, official list ingestion, functioning live sanctions matching, a connected AI API, robust source retrieval, production-grade multi-tenant authorization, security review, source licensing clearance, or validated commercial demand.

Never claim these integrations are live unless you personally verify and test them.

### Recommended next actions (take initiative)

#### Priority 1 — inspect and improve the current baseline

- Open and review `prototype.html`, `PRODUCT_SPEC.md`, `LOVABLE_BUILD_PROMPT.md`, and `supabase/schema.sql`.
- Fix inconsistencies or gaps. In particular, review whether child-table owner IDs can diverge from parent records, whether audit events are protected from client tampering, whether organization-level tenancy is needed, and whether schema constraints/indexes support the intended workflows.
- Keep the schema starter explicitly labelled as non-production until RLS, authorization, audit integrity, and tenant isolation are tested.

#### Priority 2 — produce a genuinely useful build handoff

- Refine the Lovable prompt into small, sequential build prompts so the coding agent implements one coherent milestone at a time.
- Define the first vertical slice: search/select a fictional entity → create/review a potential match → open investigation with the same entity → attach source/evidence → generate a cited report from only stored sources → record a human disposition and audit event.
- Provide seed data, expected behavior, and test/acceptance steps.

#### Priority 3 — implement where tools/accounts permit

- If no direct Lovable connector exists, prepare the exact prompts and files for the user to import; do not pretend to operate their Lovable account.
- Build a local runnable demo or add code/artifacts when the available environment permits.
- Keep mock/demo integrations visibly separate from live data integrations.

#### Priority 4 — validate data sources and product claims

- Start with official sources such as OFAC Sanctions List Service: https://ofac.treasury.gov/sanctions-list-service and the U.S. Consolidated Screening List: https://www.trade.gov/consolidated-screening-list.
- Verify current download/API options, terms, update cadence, and permitted use before implementing ingestion. Never assume access or licensing.
- Matching must show the reasons a candidate surfaced, conflicting/missing identifiers, and analyst review status.

#### Priority 5 — make it portfolio-ready

- Prepare a short product walkthrough script and a concise LinkedIn project description.
- Explain what was actually built, what is simulated, design trade-offs, source provenance, safety controls, and next milestones.
- Do not exaggerate product maturity or claim the user has shipped a live product before deployment/testing.

### Suggested technical direction

- UI: Lovable-generated React app or an equivalent maintainable web frontend.
- Data/auth: Supabase/Postgres with carefully tested RLS; use organization membership tables before claiming multi-tenant enterprise support.
- AI: server-side calls to an AI API, grounded only in retrieved/stored evidence; structured outputs should carry source references and explicit unknowns.
- Data ingestion: official source data and documented formats/feeds only after terms and licensing review.
- Optional automation: Make or scheduled server functions for refresh jobs, monitoring, and alerting.

### Reference URLs

- Lovable: https://lovable.dev/
- Supabase RLS documentation: https://supabase.com/docs/guides/database/postgres/row-level-security
- OFAC Sanctions List Service: https://ofac.treasury.gov/sanctions-list-service
- U.S. Consolidated Screening List: https://www.trade.gov/consolidated-screening-list

### Instructions to the receiving LLM

Act as a product-minded AI application architect and implementation partner. Begin by inspecting the provided files. Do not ask the user to repeat the brief. Make practical decisions, state assumptions briefly, and deliver the next tangible artifact or tested increment. Prefer end-to-end workflow quality, provenance, security, and demonstrability over adding superficial features. Be explicit about what you have actually run, tested, or deployed.
