# Research intake repair validation

The repair removes repository star/citation-file eligibility checks, supports bounded public research webpages, and gives authors a path through source and metadata revisions. Venue bans and broader editorial policy are outside this change.

## Behavior and boundaries

- New repositories remain eligible with zero stars and no `CITATION.cff`. Citation-file availability remains source metadata. GitHub file, tree and release URLs never silently become repository records; submit a repository root or cite the exact object in a discussion.
- Public HTTPS webpages use the existing credential-free transport, public IPv4 validation and socket pinning. Every redirect is checked again; webpage redirects stay on the same origin. HTML is bounded by the existing 256 KiB metadata cap, source time by eight seconds, and post retrieval by twenty seconds with two workers. No child crawling, remote code execution, login sessions, query tokens or PDF interpretation is added. Webpage intake and Python Web reads/refreshes share this transport. Node and the site's installed dependencies are required for Python Web reads. Historical Web record keys remain stable across refresh.
- A moderator may classify an unresolved or unchecked reference as supplemental only when the contribution stands independently. An ACCEPT must explicitly list every unresolved/unchecked source index in `supplemental_sources`; missing or malformed classifications cannot publish. Essential unresolved evidence still requires review. This is a source-relevance decision, not scientific verification.
- At most twelve references are checked, in their textual order across URLs and identifiers. Additional references produce an explicit unchecked count and instructions to prioritize essential sources, trim optional links or split the bibliography. Private/capability URL checks apply to the entire post, including references after twelve.
- Forum questions, answers and comments can explicitly request fresh public-source retrieval. Known public URLs can also be read afresh: stored identity metadata does not establish their contents. Authentication, Origin checks, shared thirty-attempt moderation limit, twenty-link submission limit and atomic write checks remain in place. CLI `add` remains read-only.
- Supplemental submission context is bounded to 2,000 characters, attributed to the authenticated submitter, and supplied to moderation separately from upstream metadata. It is not stored or published. The browser retains it in the same author/form-scoped draft through revision; credential-shaped drafts are discarded.

## Evidence

- `cd site && npm test`: 376 passing tests against a local sample index and PGlite databases. The sample index used `fixtures/entries.jsonl` plus a locally cached public APP registry snapshot; no production database was used.
- `cd site && ./node_modules/.bin/tsc --noEmit -p .`: passed.
- `python test_index.py`: 62 passing tests; `python test_candidates.py`: four passing tests. Python database tests use a temporary localhost PGlite server.
- `site/lib/intake-repair.test.ts` covers the exact blog URL, realistic theme overhead above 64 KiB, source metadata attribution, no-write-on-refusal, deduplication, explicit source roles, bibliography overflow/order, forum retrieval, auth/Origin/closed-body checks, secrets/private addresses, redirect revalidation, DNS pinning, deadlines, byte bounds and quotas. Python tests cover the shared transport bridge and stable historical keys.
- A read-only live check of `https://xiaoliangqi.github.io/blog/posts/what-is-life/` returned HTTP 200 through the bounded transport on October 31, 2026. Page-reported title: “What Is Life? -- Question Revisited in the AI Era”. The response digest was `df550fc436a8f9e1d90196e4b8161d6012f7703318357b781eba23c7094f08e7`. This observation establishes compatibility at that time, not authorship or correctness. No record was submitted.

No paid moderation calls were run. Scripted moderators test the publication contract, not the live model's semantic accuracy. The optional agy polish could not complete: its ordinary headless workflow auto-denied the command permission required to inspect the diff. No permission bypass was used; the implementation was independently self-reviewed.

## Remaining limits

The model must correctly distinguish essential evidence from optional background; strict output validation and the server's unclassified-ACCEPT hold remain conservative safeguards. Pages beyond the byte/encoding limits, login walls, PDFs and cross-origin redirects remain unsupported and need an alternate public landing page or independent review. Broad venue/editorial restrictions need separate discussion. Live inclusion of the blog must await deployment and the normal authenticated submission/moderation path; this PR neither deploys nor writes a production record.
