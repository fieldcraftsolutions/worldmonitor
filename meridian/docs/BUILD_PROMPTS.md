# Sequential build prompts (for Lovable or any AI coding agent)

The original single prompt (`starter_pack/LOVABLE_BUILD_PROMPT.md`) asks for everything at once. Use these instead:
one coherent milestone per prompt, each with acceptance checks. **Do not start a milestone until the previous one passes.**

**Reference implementation.** A working, tested reference exists in this repository: business rules in `server/service.js`,
matching in `server/matching.js`, briefing validation in `server/briefing.js`, schema in `supabase/schema.sql`, UI behaviour in
`public/`. A coding agent should port behaviour, not reinvent it. No Lovable account was accessed, and nothing here has been
imported into Lovable; these are prompts for the owner to run.

Preface every prompt with:

> You are building "Meridian Intelligence": an analyst-support tool, never an autonomous decision-maker. Use only fictional
> data and show the permanent label `DEMO DATA — NOT FOR REAL-WORLD SCREENING`. Never claim an integration is live unless
> it is built and tested. Keep all secrets server-side. Never use name similarity alone to call something a match.

## M0: Shell, auth, tenancy

> Create a React + TypeScript app with Supabase auth (email/password). After login show a left sidebar with a two-option
> **mode switch** (Risk & Compliance / Intelligence) at the top, a global search box, and a permanent red demo banner.
> Apply `supabase/schema.sql` from the repo (organizations, organization_members with roles viewer/analyst/reviewer/admin,
> composite foreign keys, RLS). On first login call `meridian.create_organization`. Roles must gate buttons in the UI **and**
> are enforced by RLS (never trust the UI).

Accept when: a second user in another org cannot read the first org's rows even by guessing ids (run `supabase/test/rls.sql`
logic against the Supabase project); a viewer cannot write.

## M1: Shared entity directory + profile + seed data

> Build the entity directory (server-side search over name, alias, identifier, jurisdiction; type filter) and entity profile
> (aliases, identifiers, findings, relationships, screening context, cases). Seed the fictional records from `server/seed.js`
> (nine entities, three aliases, three identifiers, three relationships, three findings, four sources). The mode switch must
> keep the **selected entity** and each mode's last page; shared pages (directory, profile, sources, audit) must not change
> when switching modes. Show a data-origin badge (FICTIONAL / ANALYST-ENTERED) on every record.

Accept when: searching `DEMO-AE-3302` finds Altavista Metals FZE; an empty search says no results is not evidence of absence;
switching mode on a profile keeps the profile.

## M2: Sources, findings, relationships (evidence rules)

> Build the source registry (publisher, title, URL, type, publication date, **retrieved at**, licence status). A source with no
> retrieval time must be shown as "not retrieved". Build findings (types: source_fact, analyst_assessment, unknown,
> contradictory_evidence) and relationships with a verification status. Rules, enforced in the database and in the UI:
> `source_fact`, `verified` and `corroborated` require a cited source; confidence is separate from verification;
> `ai_synthesis` and `potential_match` cannot be created by users. Draw the relationship graph from stored rows; edges
> without a source are dashed and labelled "no source".

Accept when: submitting a *verified* finding without a source fails with a clear message; cross-org source citation fails.

## M3: Screening review (explainable candidates)

> Add a reference list table (read-only to users) and a screening that compares an entity's name, aliases, identifiers and
> jurisdiction with list entries. Port `server/matching.js` into a server function: normalize names (strip diacritics,
> punctuation and legal-form words), score with Jaro-Winkler + token overlap, treat exact identifier agreement as a floor of
> 0.95, and **list conflicts and data gaps**. Conflicts lower the displayed score but must never remove a candidate. Each
> candidate shows a side-by-side comparison and *why it surfaced*. Store which list and snapshot was used. A run with zero
> candidates must say it is **not a clearance**; a missing list is `source_unavailable`. Candidate statuses: pending_review,
> inconclusive, escalated, not_a_match, retained_potential_match. **There must be no "confirmed" state.**

Accept when: the five behaviours in `tests/workflow.test.js` ("not a match" rules, no-candidate wording, Northstar/Kestrel
conflicts, Altavista identifier agreement) hold.

## M4: Cases, handoff, dispositions, audit

> Add cases (screening_review, investigation). Escalating a candidate creates (or reuses) a screening_review case. "Open
> investigation" creates an investigation linked to the **same entity ids** (idempotent; never copies entities) and switches
> mode. Only reviewers may record a disposition or close a case; closing as "not a match" requires a rationale of at least 20
> characters, at least one linked finding or source, and an explicit acknowledgement if a candidate agreed on an identifier.
> Record the origin and freshness of the list relied on. Write audit events for every change using the
> `meridian.log_audit` function and the provided triggers; clients must have no write access to `audit_events`. Show a case
> timeline and an "Audit & integrity" page with chain verification (`meridian.verify_audit_chain`).

Accept when: an analyst's disposition attempt is rejected by the database; tampering with an audit row is detected.

## M5: Cited briefings

> Add "Generate briefing" to an investigation. Build it **only from stored records** (entity, findings, relationships,
> screenings) and return structured sections whose claims carry `source_refs`. Port `server/briefing.js`'s validator and run it
> on every output: reject uncited claims, citations to unknown sources, verdict language ("is sanctioned", "is not sanctioned",
> "is cleared/compliant/safe", "confirmed match" when not negated), and AI items marked verified. Render inline citations that
> resolve to a source register with retrieved-at, freshness and licence; add warnings for stale, unretrieved and
> licence-unreviewed sources; always include unknowns, limitations, the generation timestamp and the human-review disclaimer.
> Start with a deterministic provider. Label it "simulated AI".

Accept when: a mock provider returning an uncited or verdict-bearing claim is rejected and nothing is saved.

## M6: Real model provider (only after M5 is stable)

> Add a server-side provider that calls an LLM with **only** the retrieved records and a JSON schema requiring `source_refs`
> per claim. Keep the M5 validator mandatory. Keep the API key in server secrets. Log generation (model id, claim count,
> validator outcome) to the audit log. Add an analyst "correction" action and count corrections as a quality metric.

Accept when: the validator rejects every adversarial output in the M5 test, and the UI still labels the text as AI-generated
and requires human review.

## M7: Official list ingestion (only after a terms/licence review)

> Port `server/ingest/ofac-sdn.js` into a scheduled server job. First verify, from an unrestricted network, the real file
> layout, URL, terms and update cadence, and update the parser and fixtures accordingly. The job must fail closed (never
> write a partial or empty list), label the list `official_live`, record `retrieved_at` and licence status, and surface
> freshness/failures in the Sources page.

Accept when: a simulated outage leaves the previous list in place and the UI shows it as stale, never as clean.
