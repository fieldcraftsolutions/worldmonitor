# LinkedIn launch draft (v2, matches what actually exists)

Only post claims that are true today. Update this file when the build changes.

## Post

I've been building **Meridian Intelligence**, an analyst-support prototype for a gap I find interesting: compliance screening
and corporate intelligence research usually live in separate tools, so entity context and source trails get rebuilt by hand.

The design idea is **two workspaces over one shared engine**, behind a persistent mode switch:

- **Risk & Compliance**: screening review, explainable candidates, cases, reviewer dispositions.
- **Intelligence & Investigations**: entity profiles, an evidence register, a relationship map, cited briefings.

Escalating a screening candidate opens an investigation on the *same* entity record, so nothing is re-keyed and nothing
loses its source trail.

What I focused on, because trust matters more than features here:

- A name similarity is only ever a *candidate*, shown with why it surfaced, what conflicts, and what data is missing.
  There is deliberately no "confirmed match" state.
- "No candidates" is never presented as a clearance, and a stale or missing list says so.
- Every claim carries a source, retrieval time and licence status; verified claims *require* a source.
- Dispositions need a human reviewer, a written rationale and evidence, and are written to a tamper-evident audit log.
- Briefings are validated: uncited claims and verdict language ("is sanctioned", "is cleared") are rejected.

**What it is today, honestly:** a working prototype with fictional data, tested end to end (32 automated tests, a
51-check row-level-security suite on Postgres, and a real-browser run of the full workflow). The screening list is simulated,
no language model is connected yet, and no official sanctions feed is integrated. It isn't deployed, and it isn't a
compliance tool.

Next: verified official data after a terms review, a labelled evaluation of the matching, a model provider behind the same
validation, and, most importantly, feedback from people who do this work. If you work in sanctions, trade compliance or due
diligence, I'd value 20 minutes of your time.

#ArtificialIntelligence #Compliance #Sanctions #CorporateIntelligence #ProductDevelopment

## Case-study outline

1. **Problem**: fragmented context between screening and research; re-entry and lost provenance.
2. **User**: analyst handling a potential match or a counterparty concern.
3. **Design decision**: two workspaces, one entity/source/case layer; handoff links records, never copies.
4. **Trust model**: candidate language, reasons/conflicts/gaps, confidence ≠ verification, reviewer-only dispositions, validated citations, tamper-evident audit.
5. **What was built and how it was tested**: see `STATUS.md`. Include the screenshots in `docs/screenshots/`.
6. **What is simulated**: list, writer; say so on the first slide.
7. **Findings**: three real bugs caught by tests (negation in the verdict filter, conflicts hiding candidates, CSP blocking inline styles).
8. **Next validation**: 5–8 practitioner interviews; measure handoff completion, re-entry avoided, sourced-claim coverage, false positives on a labelled set.

## Avoid

"Live screening", "AI-powered", "production-ready", "secure"/"compliant", "covers global sanctions", or implying the project is deployed
or has users.
