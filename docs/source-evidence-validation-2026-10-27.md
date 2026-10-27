# Source-evidence workflow validation — October 27, 2026

This follow-up addresses the existing-record source-guide hold without creating research records for reactions or trusting client verification flags. See [design and security boundary](public-source-evidence-design.md) and [historical observation provenance](curated-source-review.md).

## Scope and review

- The immediate ETH path uses twelve immutable, server-owned observations bound to one existing record and exact canonical source URLs. Observations describe a signed-out public review on October 27, 05:40–05:43 UTC. They are paraphrases with attribution caveats, not a fresh fetch or proof certification.
- Optional explicit public checks support bounded GitHub regular files at full commit permalinks, public Docs text exports and official X oEmbed responses. Drive collections/PDFs stay unsupported for automatic retrieval. Unsupported, inaccessible, unindexed and mismatched sources remain distinct holds.
- Publication still requires normal DeepSeek moderation. Fresh opt-in checks cannot fall back to historical evidence. Preflight never publishes or calls a model; there is no reusable client verification token.
- Independent source review found and resolved two issues: unsafe unresolved URL retention in private audit reasons, and missing displayed excerpts/caveats. Origin checks also cover posting-time retrieval. No remaining blocking P1/P2 finding was identified in that review; this is not a comprehensive security certification.
- No new source table, migration, OAuth scope, credential, analytics category, collection setting, retention/deletion job or paid tool is introduced. New endpoint aggregate metrics are excluded until their category is separately approved; the existing private attempt audit still applies.

## Local final validation

- Site: **322/322 tests passed**, zero skips.
- Harvester: **59/59 tests passed**; candidates: **4/4 passed**, zero skips, using the existing project virtualenv and ephemeral PGlite.
- Private quality/redaction fixtures: **116/116 passed**; private transport fixtures: **7/7 passed**, zero skips. Deliberately adversarial text remains outside the repository.
- TypeScript and production build passed. Whitespace validation passed.
- Actual SourceChecks component was exercised in an isolated local app with stubbed server results: explicit check retained the draft, showed 2/2 outcomes without posting, displayed live text literally, and exposed historical attribution caveats and observation-window limits. This browser check used no production account, external retrieval or model.
- Final tests cover API authentication/closed schemas/Origin, rate reservation before retrieval, source identity and transport bounds, historical/fresh separation, unavailable providers, and rejection/revision/hold paths with no public writes. These are deterministic plumbing tests; they do not establish a real model's scientific judgment.

The first full site run caught the analytics endpoint-category constraint mismatch (320 passed, one failed); excluding the new operation without changing SQL resolved it. The initial system-Python invocation lacked psycopg; the existing project virtualenv passed both Python suites. A restricted local UI listener received EPERM; the normal approved loopback execution succeeded. No denied action was bypassed.

## Remaining operational limits

No live provider calls, real source-fetch compatibility calls or public posts were made for this follow-up. Optional fetch adapters can encounter upstream rate limits, access walls or changed formats and must hold safely. The reviewed ETH observations permit only their recorded content/attribution scope; stronger claims or current availability can still require review. General forum threads do not gain the record-scoped source-check action from this change.

The already-held ETH guide must be resubmitted only once through the ordinary authenticated comment endpoint after deployment is verified, with the intended existing bot identity. Leave fresh retrieval disabled when intentionally relying on the dated registry. The caller must still inspect the actual moderation outcome; no acceptance is promised by this validation.

ORI's moderation and labeling requests declare no DeepSeek server-side Search/Fetch tools and reject tool-call responses. Application-side public HTTPS checks are separate. Ordinary inference remains billable; this follow-up changes neither billing nor the existing test cap.
