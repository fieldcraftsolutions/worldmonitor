# Data sources: what is verified and what is not

| Source | Intended use | Status |
|---|---|---|
| Simulated demo list (`server/seed.js`) | Exercise the matching workflow | **Active.** Invented entries; origin `simulated_fixture`. |
| OFAC Sanctions List Service <https://ofac.treasury.gov/sanctions-list-service> | Official SDN data | **Not connected.** Recorded as a reference source with `retrieved_at = null`. |
| U.S. Consolidated Screening List <https://www.trade.gov/consolidated-screening-list> | Multi-agency trade lists | **Not connected.** No importer yet. |
| Company registries, filings, press | Analyst-supplied evidence | Manual entry via the source registry. |

## What the experimental importer does and does not establish

`server/ingest/ofac-sdn.js` parses the legacy `sdn.csv` / `alt.csv` layout and loads it as a reference list.

- Tested **only** with a synthetic fixture and a local HTTP server.
- The build sandbox's proxy returned **403** for the OFAC hosts, so the real file layout, URL stability and update cadence were **not verified**.
- Lists load with `license_status = not_reviewed`; the app shows this in briefings.
- It fails closed: a failed or malformed download writes nothing, so an outage can never look like an empty list.
- A list is labelled `official_live` only when fetched by the script; fixtures are `test_fixture`.

## Checklist before treating any list as a live source

1. From an unrestricted network, download the current files and compare the real layout to the parser; update the parser and the fixture.
2. Read the publisher's terms and record the permitted use; set `license_status` accordingly.
3. Record the update cadence; set `LIST_STALE_DAYS` (default 7) to match it.
4. Confirm that the displayed freshness and the briefing warnings behave correctly for the real cadence.
5. Evaluate matching on a labelled set (including transliterations) before relying on candidate scores.
6. Have a compliance/legal reviewer sign off on how results are described to users.

## Matching: known gaps

No transliteration or phonetic matching; no date-of-birth, nationality or address features; legal-form stop-words are a short
English/European list; thresholds (`0.80` surface, `0.92` strong) and the conflict penalties are untuned heuristics. The
displayed score is **not a probability**.
