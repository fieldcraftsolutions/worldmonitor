# Lovable build prompt — Meridian Intelligence

Build **Meridian Intelligence**, a polished, responsive, desktop-first enterprise SaaS application for corporate intelligence, investigations, sanctions screening review, and international trade risk. The main differentiator is one persistent **mode switch** that changes between two focused workspaces without logging out or losing the current entity context.

## Product experience

### Workspace switcher
- Persistent at the top of the left sidebar on every authenticated page.
- Two modes: **Risk & Compliance** and **Intelligence & Investigations**.
- Clearly highlight active mode and use subtle visual accents to distinguish them.
- Switching modes changes the navigation and dashboard, but keeps the shared entity directory and selected entity accessible.
- Remember each workspace's last selected page during the current session.

### Risk & Compliance navigation
- Overview
- Screening queue
- Cases
- Entity directory (shared)
- Sources and data freshness

### Intelligence & Investigations navigation
- Overview
- Investigations
- Entity directory (shared)
- Relationship map
- Briefings and reports

### Required screens
1. Login and account shell.
2. Workspace-specific dashboard with clear demo-data banner.
3. Shared entity directory with search, filters, and entity type/status labels.
4. Entity profile with identifiers, aliases, source-backed relationships, screening context, findings, and activity.
5. Screening review page that supports a *potential match* disposition, comparison of identifiers, analyst notes, and escalation to a case. Never auto-label a record as a confirmed match based on name similarity alone.
6. Case detail with status, owner, linked entities, evidence, decision history, and audit events.
7. Investigation workspace with research question, evidence register, hypotheses, unresolved questions, and timeline.
8. Relationship map with visible confidence/source state for every edge. Unverified edges must be visually distinct.
9. Briefing editor/preview with source references attached to claims, explicit uncertainty, and a limitations section.
10. Source registry with publisher, source type, official URL, publication date (if known), retrieval timestamp, license/terms status, and freshness status.

## Shared data model

Use Supabase for authentication and persistence. Create tables for profiles, entities, aliases, identifiers, relationships, sources, findings, cases, case_entities, and audit_events. Every tenant-owned record must be scoped to an authenticated user or organization. Enable Row Level Security. Never rely on front-end filters as an authorization control.

Suggested core fields:
- Entity: id, owner_id/organization_id, entity_type, legal_name, jurisdiction, registration_id, description, created_at, updated_at.
- Alias: entity_id, alias_text, alias_type, source_id.
- Identifier: entity_id, identifier_type, identifier_value, issuing_jurisdiction, source_id, valid_from, valid_to.
- Source: publisher, title, URL, source_type, publication_date, retrieved_at, license_status, notes.
- Finding: entity_id, case_id, source_id, claim, finding_type, confidence, verification_status, analyst_notes, created_by.
- Relationship: source_entity_id, target_entity_id, relationship_type, confidence, verification_status, source_id, valid_from, valid_to.
- Case: case_type, status, priority, summary, assigned_to, created_by, closed_at.
- Audit event: actor, action, object_type, object_id, timestamp, minimal change metadata.

## AI behavior

AI output must be grounded in retrieved source records supplied to the model. Each material factual claim should cite a source record and URL. If no source supports a claim, label it as an analyst question or omit it. Clearly distinguish:
- Verified source-backed fact
- Potential screening match
- Analyst assessment / hypothesis
- AI-generated synthesis
- Unknown / unresolved

AI must not declare a person or company safe, sanctioned, guilty, or compliant. It must not invent citations, source dates, identifiers, or ownership relationships. Require human review for dispositions. Show the model's limitations and source freshness. Log report generation and analyst disposition events.

## Design direction

Use a premium, restrained intelligence-software visual language: deep navy sidebar, white content panels, cool gray background, muted blue accents for navigation, amber for review states, red only for meaningful alerts, clear typography, dense but readable tables, strong spacing, accessible contrast, and responsive layouts. Avoid decorative maps or charts that imply unsupported facts. Use realistic **fictional** seed data and a persistent label saying `DEMO DATA — NOT FOR REAL-WORLD SCREENING`.

## Functional requirements

- Search by entity name, alias, registration identifier, or jurisdiction.
- Filters must update results, not just decorate the UI.
- Every primary button must work or be explicitly disabled with an explanation.
- Users can create and edit a case, add a source, add an analyst finding, and link an entity to an investigation.
- A screening review can be handed off to an investigation without duplicating the entity record.
- Reports should be copyable and exportable when feasible; include source register and generated-at timestamp.
- Empty, loading, error, and no-results states must be designed.
- Add tests for access control and key workflows before production.

## Build order

First implement navigation, mode switch, shared entity search/profile, and fictional seed data. Then implement Supabase persistence and RLS. Next implement case/evidence workflows. Only after those are stable should you add official data ingestion and server-side AI summaries. Do not pretend a live source integration exists before it has been built and tested.

Use environment secrets/server-side functions for API keys; never put secrets in browser code. Do not use employer confidential information. Keep the demo useful without any external API credentials.
