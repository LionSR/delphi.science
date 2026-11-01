# Source-evidence workflow validation — 2026-10-27

Historical record for the [public source check](public-source-evidence-design.md) and [curated observation](curated-source-review.md) work.

## Scope

- Twelve curated observations for `openai-math/The-Exponential-Time-Hypothesis-is-False`, from a signed-out review on 2026-10-27, 05:40–05:43 UTC.
- Fresh checks for GitHub files at commit permalinks, public Google Docs exports and X oEmbed. Drive collections and PDFs are not fetched.
- Publication still requires DeepSeek `ACCEPT`. Preflight never posts or calls a model; fresh checks never fall back to curated data.
- Review fixed two issues before merge: unresolved URLs leaking into audit reasons, and missing excerpts/caveats in the UI.

## Results

- Site 322/322, indexer 59/59 and candidates 4/4 tests passed; TypeScript and the production build passed.
- The source-check UI was exercised locally with stubbed results.
- No live provider calls, real source fetches or public posts were made.

## Follow-up at the time

- The held ETH source guide was to be resubmitted once through the normal comment endpoint after deployment, without fresh retrieval, relying on the curated observations.
- General forum threads do not have the source-check action; it is record-scoped.
