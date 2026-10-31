# Curated public-source observations

`site/lib/curated-public-sources.json` holds reviewed, dated observations of public sources cited in record discussions. It ships with the server and changes only through an owner-reviewed PR, like code.

## How it is used

- `lookupCuratedPublicSource(recordId, sourceUrl)` (`site/lib/curated-public-sources.ts`) returns an immutable `CuratedPublicSnapshot` only for an exact shipped record/source pair (compared by canonical source identity), otherwise `undefined`.
- The backend checks that the record exists before consulting the registry. Callers cannot add entries: verified flags, preflight results, client digests or custom registries are ignored.
- A snapshot is passed to the normal moderation gate as source data; only `ACCEPT` publishes. Lookup never publishes anything.
- Snapshots serve as historical evidence only when no fresh check was requested. If a requested fresh check fails, the attempt fails; it does not fall back to a snapshot.
- Schema validation rejects unknown fields, non-canonical URLs, mismatched adapters, unbounded/HTML/credential-like text and invalid observation windows.
- The SHA-256 digest identifies the reviewed observation record. It is not a digest of the raw page and does not attest authorship.

## Current contents

All twelve observations are scoped to `openai-math/The-Exponential-Time-Hypothesis-is-False`.

- Source: a research agent's signed-out browser review of ten URLs and two separately rendered public child PDFs, 2026-10-27 05:40–05:43 UTC (exact per-item times unknown). The child PDFs use a curated-only `drive_file` identity; this does not enable automatic Drive fetching or PDF parsing.
- `reviewed_by` names the agent and repository review, not a human approval.
- Summaries are paraphrases, not quotations.
- The seven X display dates read October 26 in an unspecified timezone; they are not converted to UTC. The community letter has no date. The GitHub URL points at mutable `main`, not a commit.
- Titles, accounts and signatures do not authenticate authorship. Observations do not certify proof correctness, expertise, consensus or current availability.

Tests (`site/lib/curated-public-sources.test.ts`) cover structure validation and lookup with no network, database or model calls.
