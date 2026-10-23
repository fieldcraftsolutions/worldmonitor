# Meridian Intelligence — Starter Pack

Meridian Intelligence is a portfolio project concept for an analyst-oriented platform combining two workspaces behind a persistent mode switch:

- **Risk & Compliance** — screening review, potential matches, compliance cases, source registry.
- **Intelligence & Investigations** — entity profiles, relationship mapping, evidence management, research briefs.

Both workspaces use a shared entity and evidence model. The product should distinguish verified facts, possible matches, analyst assessments, AI-generated interpretations, and unresolved questions.

## Contents

- `prototype.html` — standalone interactive UI prototype; synthetic demo records only.
- `LOVABLE_BUILD_PROMPT.md` — ready-to-paste build instructions for Lovable.
- `PRODUCT_SPEC.md` — MVP requirements, user journeys, acceptance criteria, and safety principles.
- `supabase/schema.sql` — starter relational schema and row-level security policies.
- `LINKEDIN_LAUNCH.md` — draft project announcement and portfolio talking points.

## Suggested implementation sequence

1. Import `prototype.html` as visual reference while building a native Lovable project.
2. Create a Supabase project and apply `supabase/schema.sql` after reviewing it.
3. Implement authentication and the shared entity directory first.
4. Implement source records and analyst-created findings before adding AI summaries.
5. Add official sanctions/trade list ingestion only after validating source terms, data format, update cadence, and matching rules.
6. Add server-side AI synthesis with source-grounded output and an audit trail.
7. Deploy a demo with fictional records and a clear demo banner.

## Important limitations

The prototype is not a production screening system. It does not connect to live lists, does not make compliance determinations, and must not be used to make real-world decisions. The SQL is a starter scaffold, not a substitute for a security review. Before commercialization, review source licensing, privacy obligations, sanctions-screening requirements, security controls, retention, and legal advice as appropriate.

## Recommended official references

- OFAC Sanctions List Service: https://ofac.treasury.gov/sanctions-list-service
- U.S. Consolidated Screening List: https://www.trade.gov/consolidated-screening-list
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Lovable: https://lovable.dev/
