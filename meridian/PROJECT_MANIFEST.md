# Project manifest

| Path | Purpose | Status |
|---|---|---|
| `README.md` | Overview, run/test instructions, real-vs-simulated table | Current |
| `STATUS.md` | Verified vs not verified; next steps | Current |
| `LLM_HANDOFF.md` | Living handoff brief (source of truth) | Current (v2) |
| `server/` | API, workflow rules, org-scoped store, auth, audit, matcher, briefing generator, seed, experimental OFAC importer | Working demo |
| `public/` | Browser SPA (both workspaces) | Working demo |
| `supabase/schema.sql` | Hardened v2 schema | Tested on Postgres 16; **not** on Supabase; not security-reviewed |
| `supabase/test/` | RLS/constraint/audit adversarial suite and runner | Passing |
| `tests/` | 32 node:test tests; synthetic SDN fixture; browser e2e | Passing |
| `docs/DEMO_WALKTHROUGH.md` | 5-minute demo script | Current |
| `docs/BUILD_PROMPTS.md` | Sequential build prompts with acceptance checks | Current (not run in Lovable) |
| `docs/SECURITY_NOTES.md` | Threats, controls, residual risks | Self-assessed |
| `docs/DATA_SOURCES.md` | Source status and verification checklist | Current |
| `docs/LINKEDIN_LAUNCH.md` | Announcement draft matching actual state | Draft |
| `docs/screenshots/` | Screenshots from the browser e2e run | Generated |
| `starter_pack/` | Original handoff package, unchanged | Superseded by the above |
