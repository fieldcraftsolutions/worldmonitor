# Meridian Intelligence

An analyst workspace with **two modes over one shared intelligence engine**:

- **Risk & Compliance**: screening queue, explainable candidate review, cases, dispositions, source freshness.
- **Intelligence & Investigations**: entity profiles, evidence register, relationship map, cited briefings.

Both modes read and write the same entities, sources, findings, relationships, cases and audit log. Switching mode keeps the
selected entity, and handing a case to an investigation links the **same** entity record rather than copying it.

> **Everything here uses invented data.** The screening list is a simulated fixture, and no language model writes the
> briefings. See [What is real and what is simulated](#what-is-real-and-what-is-simulated). This is an analyst-support
> prototype, not a compliance system, and nothing it produces is a legal or compliance determination.

This project lives in its own directory inside the WorldMonitor repository and shares no code with it. It has **zero npm
dependencies** (Node 20+ only).

## Run it

```bash
cd meridian
npm start                    # http://127.0.0.1:3000  (seeds fictional demo data on first run)
```

| Account | Role | Can do |
|---|---|---|
| `analyst@harbor-demo.test` | analyst | everything except dispositions / closing "not a match" |
| `reviewer@harbor-demo.test` | reviewer | + record dispositions, close a candidate as "not a match" |
| `viewer@harbor-demo.test` | viewer | read-only |
| `outsider@other-demo.test` | reviewer in a **different** org | proves tenant isolation |

The default demo password is `meridian-demo-only`. Set `MERIDIAN_DEMO_PASSWORD` **before the first run** (or run
`npm run reset`) to change it. The server binds to `127.0.0.1` and refuses to bind elsewhere while the default password is
in use. Reset the demo data any time with `npm run reset`.

Follow the [5-minute demo walkthrough](docs/DEMO_WALKTHROUGH.md), or the **Guided demo** panel on the dashboard.

## Test it

```bash
npm test                     # 32 tests: workflow, security, integrity, honesty, ingestion (no dependencies)
npm run test:rls             # applies supabase/schema.sql to a throwaway Postgres 16 and runs 51 adversarial RLS checks
npm run test:e2e             # 16-step real-browser run of the whole workflow (needs Playwright + Chromium)
```

## What is real and what is simulated

The app serves this table at `GET /api/system` and shows it on the dashboard; a test pins it so it cannot drift.

| Capability | Status | Detail |
|---|---|---|
| Authentication, roles, sessions | **Implemented** | scrypt, hashed session tokens, CSRF, throttling. Local accounts only; no SSO/MFA. |
| Organization isolation | **Implemented** | Every query org-scoped; cross-tenant references rejected; tested. |
| Hash-chained audit log | **Implemented** | Append-only per org; tamper-evident; not externally anchored. |
| Persistence | **Demo** | Local JSON file. The Postgres schema is tested separately but the app is **not wired to it yet**. |
| Candidate matching | **Implemented** | Real, explainable heuristic matcher. Untuned; no labelled evaluation set yet. |
| Screening reference list | **Simulated** | Invented fictional parties. Not a sanctions list. |
| OFAC SDN / Consolidated Screening List | **Not connected** | No official data fetched. An experimental SDN CSV importer exists, tested on a synthetic fixture only. |
| AI briefings | **Simulated** | Deterministic template over stored records. The validator that checks citations is real and model-ready. |
| Scheduled refresh / monitoring | **Not connected** | Not built. |

## Layout

```text
server/            index.js (HTTP) · service.js (workflow rules) · store.js (org-scoped) · auth.js · audit.js
                   matching.js · briefing.js · seed.js · ingest/ofac-sdn.js (experimental)
public/            SPA: app.js (shell + mode switch) · pages-{shared,risk,intel}.js · ui.js (no innerHTML)
supabase/          schema.sql (v2, tested on Postgres 16) · test/ (RLS suite + runner)
tests/             node:test suites, fixtures, e2e/ui-workflow.mjs
docs/              DEMO_WALKTHROUGH · BUILD_PROMPTS · SECURITY_NOTES · DATA_SOURCES · LINKEDIN_LAUNCH · screenshots/
starter_pack/      the original handoff package, unchanged
STATUS.md          what was verified, what was not, next steps
LLM_HANDOFF.md     living handoff brief (source of truth)
```

## Principles enforced in code

1. AI assists; it never decides. There is no "confirmed match" state anywhere (API, UI, or database).
2. Name similarity is only ever a *candidate for review*, with reasons, conflicts and data gaps displayed.
3. "No candidates" is never a clearance; a missing or stale list says so; an unavailable list is `source_unavailable`.
4. Claims carry source, publisher, URL, publication date, retrieval time and licence status. A source never retrieved is shown as such.
5. Verified/corroborated findings and relationships require a cited source; confidence is separate from verification.
6. Dispositions need a reviewer, a written rationale and evidence, and are audited with the freshness of the list relied on.
7. Secrets stay server-side, and every state change is audited.
