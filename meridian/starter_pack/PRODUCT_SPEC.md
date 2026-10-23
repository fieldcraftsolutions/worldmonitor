# Product specification — Meridian Intelligence

## Product thesis

Analysts often have to move between compliance screening and deeper corporate research. Meridian is designed to reduce context switching by giving both workflows one shared entity, source, relationship, and case layer while keeping the operational tasks distinct.

## Target users

- Sanctions and trade compliance analysts
- Corporate intelligence and due diligence analysts
- Investigations teams
- Risk teams assessing counterparties and supply-chain exposure

Initial positioning: an analyst-support and research organization tool, not an autonomous compliance decision-maker.

## Core workflow

1. Search for a legal entity and collect identifiers.
2. Review a potential screening result against available identifiers and source provenance.
3. Open or create a case if analyst review is required.
4. Switch to Intelligence & Investigations with the entity context preserved.
5. Build a source register, collect evidence, map relationships, and document unknowns.
6. Generate a preliminary briefing where claims are traceable to sources.
7. Return to the compliance case and record the analyst's disposition, rationale, and supporting evidence.

## MVP scope

### P0 — required
- Persistent two-mode switch
- Authentication and user/organization access boundaries
- Shared entity directory, aliases, identifiers, and entity profiles
- Create/read/update case and investigation records
- Source register with URL, publisher, publication date, retrieval time, and source type
- Evidence and finding records with verification status
- Relationships with source links and confidence state
- Audit log for case changes and analyst dispositions
- Fictional demo dataset with persistent disclosure

### P1 — next
- Import official list data using documented and permitted feeds
- Candidate matching with configurable normalization and explainable match features
- Analyst review queue and escalation flow
- Server-side AI briefing generation using only supplied source records
- Report export and case handoff
- Data freshness indicators and failed-ingestion monitoring

### P2 — later
- Scheduled refresh and change monitoring
- Country and trade-risk source library
- Watchlists, alert subscriptions, and entity change notifications
- More advanced ownership and supply-chain graph exploration
- Organization-level roles, retention policies, and enterprise audit exports

## Non-goals for MVP

- Automatically deciding whether a person or entity is prohibited
- Replacing legal or compliance advice
- Claiming complete global sanctions coverage
- Scraping sources without reviewing terms and licensing
- Inferring wrongdoing from geography, nationality, shared names, or a weak relationship
- Using confidential employer data in the portfolio demo

## Acceptance criteria

- Mode switch works on every primary screen and preserves the selected entity.
- Entity records created from one mode are available in the other mode, subject to authorization.
- Every relationship/finding has an explicit verification state; source-backed claims can be traced to a source record.
- A potential name match can be marked inconclusive, escalated, or closed with rationale; it cannot be silently promoted to confirmed.
- Case creation, evidence attachment, analyst notes, and disposition changes produce audit events.
- Users cannot read or modify records outside their authorized organization/user scope.
- Demo records are unmistakably fictional and never mixed with live screening results without a visible data-source indicator.
- AI-generated briefings include source citations, generation timestamp, unknowns, and a disclaimer that human review is required.
- Missing, stale, or unavailable sources are shown explicitly rather than represented as a clean screening result.

## Evidence model

Each source record should include a stable internal ID, publisher, title, canonical URL, source type, publication date if available, retrieval timestamp, license/terms status, and any retrieval error. Each finding should point to one or more source records where possible and separately store analyst notes. Keep contradictory evidence instead of overwriting it. Confidence is not the same as verification status.

## Matching principles

Use exact identifiers when available, with transparent normalization and candidate scoring. Treat transliteration, alias, and fuzzy-name matches as candidates requiring review. Display why a candidate was surfaced (name similarity, identifier agreement, jurisdiction, date, etc.) and the data gaps. Never interpret a missing match as proof that an entity is clear.

## Product metrics

- Median time to complete a reviewed case
- Percentage of report claims with attached sources
- Percentage of relationships with provenance
- False-positive rate on a labelled test set
- Stale-source and failed-ingestion rate
- Analyst correction rate for AI summaries
- Cross-workspace handoff completion rate

## Risk and launch checklist

- Validate official source access, usage terms, licensing, and update schedule.
- Use test fixtures to measure matching false positives and false negatives.
- Security-review RLS, API key handling, logging, backups, and tenant isolation.
- Establish retention/deletion, privacy, and incident-response practices.
- Do not market the product as legally determinative or as complete coverage.
- Conduct user interviews with analysts before broadening feature scope.
