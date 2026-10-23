# Demo walkthrough (about 5 minutes)

Everything on screen is fictional. State that up front: the banner on every page says so.

## Setup

```bash
cd meridian && npm run reset && npm start     # http://127.0.0.1:3000
```

Sign in as `analyst@harbor-demo.test` (password: see README).

## Script

| # | Do | Say | Expect |
|---|---|---|---|
| 1 | Open the **Overview** | "Two workspaces, one engine. This table says exactly what is real and what is simulated." | Banner; status table showing the screening list and AI briefings as **SIMULATED** and OFAC as **NOT CONNECTED**. |
| 2 | **Screening queue** → pick *Volga Meridian Trading* → **Run screening** | "A name resemblance is not a match." | Candidate *Volga-Meridian Trade Co.*, score, **Candidate for review, not a determination**, side-by-side comparison, *why it surfaced*, and a data gap: *no identifiers on your record*. |
| 3 | Click **Escalate to case**, give a reason | "Escalation is a human decision." | A compliance case opens; the candidate links to it. |
| 4 | In the case, click **Open investigation →** | "Now the mode switch: same entity, no re-entry." | Workspace flips to Intelligence; sidebar still shows *Volga Meridian Trading*; the investigation says "linked, not copied". |
| 5 | **Register source** (any title/publisher, URL `https://registry.demo.invalid/x`, set *Retrieved at*) then **Add finding** (kind *Source fact*, pick the source, status *verified*) | "Every claim needs a source." | The finding appears in the Evidence register with its source. |
| 6 | Add another finding, kind *Hypothesis*, status *verified* → submit | "Confidence is not verification." | **Refused**: *requires a cited source*. |
| 7 | **Generate briefing** | "No model is connected; it is a template over stored records, and it is validated." | Draft banner, generation method (*deterministic-template, language model: none*), inline citations `[1]` resolving to the source register, warnings (SIMULATED list, licence *not reviewed*), unknowns, limitations. |
| 8 | Toggle **Risk & Compliance** (top-left) | "Context preserved." | Back in Risk; the same entity still selected. |
| 9 | **Sign out**, sign in as `reviewer@harbor-demo.test` → **Compliance cases** → the case | "Dispositions need a reviewer." | Disposition form (analysts see a notice instead). |
| 10 | Choose *Inconclusive*, write a rationale → **Record disposition** | | Disposition history shows the rationale **and the freshness/origin of the list relied on**. |
| 11 | **Audit & integrity** | "Every step is on the record, tamper-evident." | Events for screening, case, handoff, finding, report, disposition; **Chain verified**. |

## Optional: show the guardrails

- *Altavista Metals FZE* → screen → **Close as not a match** as analyst: disabled; as reviewer: needs rationale, evidence, and an explicit acknowledgement because the identifier agrees.
- *Asterion Components Ltd.* → screen → "No candidates … **not a clearance**".
- *Kestrel Freight Services Ltd* → candidate with an **identifier conflict** shown, not hidden.
- *Northstar Maritime Group* → **Relationship map**: unverified (amber), disputed (red), corroborated (green) edges; "no source" is labelled.
- Sign in as `outsider@other-demo.test`: sees only *Outsider Holdings*. Nothing from the other organization is reachable, including by guessed IDs.
- Sign in as `viewer@…`: every action button is disabled with an explanation.

## Talking points (accurate claims only)

- "I built a working prototype with fictional data; the matching and briefing validation are real code, the list and the writer are simulated."
- "Isolation, roles and the audit chain are tested, including in Postgres with row-level security."
- "Next: connect verified official data after a terms review, evaluate matching on a labelled set, and test with practitioners."

Do **not** say: live sanctions screening, AI-powered briefings, production-ready, secure/compliant, or anything implying real coverage.
