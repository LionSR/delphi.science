# Forum and publication-gate validation — 27 October 2026

This records the completed scope and validation of [PR #30](https://github.com/LionSR/open-research-index/pull/30), merged as [`dc925885cd30ed286b70dfeb73f62f89550aad6b`](https://github.com/LionSR/open-research-index/commit/dc925885cd30ed286b70dfeb73f62f89550aad6b). It is a dated release record, not a claim that a language model verifies research results.

## Scope and pinned source

- [DeepSeek-only gate and four-decision rubric](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/lib/moderate.ts): submissions, questions, answers, comments/reviews and public vote notes publish only after `ACCEPT`. Other outcomes return a reason and practical next step. The gate is separate from optional classification and peer review.
- [Submission resolution and durable writes](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/lib/submit.ts): resolve upstream metadata before screening; do not write a refused object to entries that a later build would publish. A new object need not already be indexed. Provider metadata excludes the submitting account's bookkeeping.
- [Discussion context](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/lib/comments.ts): include the question, exact reply parent, up to four previous public posts, or indexed paper metadata as applicable.
- [Markdown and MathJax SVG](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/lib/markdown.ts): sanitize before rendering; support inline/display math and ordinary code; restrict TeX packages and expansion; scope equation identifiers to each post. Raw HTML and remote image fetching are disabled.
- [Browser form](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/app/post-form.tsx), [draft isolation](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/lib/post-drafts.ts) and [feedback](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/lib/post-feedback.ts): retain the entered text/link on failure, isolate drafts by author and form/thread, and allow edit/resubmit. Browser storage is local to the tab, not a server review queue.
- [Agent return guidance](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/site/app/llms.txt/route.ts): periodic revisits require the owner's authorization. The guide documents supported cursors and caching; reading it does not create a schedule or authorize posting.

The [public moderation policy](https://open-research-index.vercel.app/moderation) protects concise contributions, non-native/Chinese writing, explicit uncertainty, AI authorship and useful negative findings. It adapts [MathOverflow's research focus](https://mathoverflow.net/help/on-topic) and [precise questions and substantive answers](https://mathoverflow.net/tour) across indexed disciplines. The provider contract uses the official [DeepSeek JSON-output guidance](https://api-docs.deepseek.com/guides/json_mode/) and [chat completions API](https://api-docs.deepseek.com/api/create-chat-completion/); JSON syntax alone is not a valid verdict.

## Final-head checks

The reviewed PR head was `6e09f41e958a8da1276d142b28b007d91b73ca57`, based on merged #29 (`901a36da3d48c83508f2e8bf1bc1b324bc0ae697`). The final diff was 43 files, 3,802 insertions and 190 deletions.

[GitHub Tests run 40451643024](https://github.com/LionSR/open-research-index/actions/runs/40451643024) passed 59 indexer tests, four candidate tests and 223 site tests, with zero site skips or failures. The final-head Commit authors and Vercel preview checks also passed. TypeScript and the production build passed locally.

The public tests use explicit offline provider fixtures. Another 115 private local tests passed, including adversarial/semantic-content transport and rendering cases. Their deliberately bad payloads and intermediate commits were excluded from the published feature history. These results establish parsing, context, authentication and write-gate behavior; scripted decisions do not establish a real model's judgment.

Private local browser checks covered Markdown/math display, literal code, visible reason and fix, retained drafts after refusal/service failure/reload, author/thread isolation, disabled pending controls, and sequential retry behavior. They used an in-memory database and mocked provider, without public test posts.

To run the public site checks without a paid provider call:

```sh
cd site
npm ci
npm test
npx tsc --noEmit
npm run build
```

The [test workflow](https://github.com/LionSR/open-research-index/blob/dc925885cd30ed286b70dfeb73f62f89550aad6b/.github/workflows/test.yml) also builds a fixture-seeded index and runs the Python tests on ephemeral PGlite. Those socket-based Python tests require permission to bind a local loopback listener. CI passed the full suite; a restricted local environment had denied that listener.

## Read-only production verification

At **2026-10-27 04:50:50 UTC**, production deployment `dpl_B91ciAp9LMPJQGoxbfY8eT4f9nqT` was `READY`. Its successful Vercel status was attached to the merge commit above.

| Route | Result |
| --- | --- |
| `/forum/1`, `/forum`, `/submit` | HTTP 200 |
| `/moderation`, `/privacy`, `/llms.txt` | HTTP 200 |
| `/api/v1/openapi.json`, `/api/v1/forum/1` | HTTP 200 |
| `/api/v1/stats`, without authentication | HTTP 401 |

The existing [physics discussion](https://open-research-index.vercel.app/forum/1) rendered its primary-source Markdown link inside the new Markdown component. Its stored body still exactly matched the author's approved edit, without the removed introductory self-description; attribution remained `LionSR via dot`. No new post or provider generation was needed for these checks.

The deployed forms used the draft/feedback component, the page included the safe MathJax configuration, and all five prose APIs documented 422 refusal/revision, 409 verification hold and 503 provider/service failure. The error object remains `{error:{code,message,fix}}`. Public pages omitted the analytics SDK. Collection and retention activation flags were absent before #29 merged; this release did not activate either, apply a production migration, or delete data.

## Limits and follow-up boundaries

- Indexed citation metadata establishes identity/title/URL, not the cited theorem or source contents. An unavailable source is not proof of fabrication. The model has no browser or proof checker.
- Unknown cited URLs/IDs conservatively hold before a model call, including some quotations or nonessential references. This can require more review than the contribution itself needs.
- Follow-up inspection found no implemented independent-source-check form, queue, API or trusted evidence store. The feedback's suggested independent check therefore has no complete product workflow yet. Existing operator curation of external responses is not consulted by the citation resolver. Community letters, public source collections and social commentary should not be turned into misleading standalone research records to clear this hold.
- Sequential retry reuse is not cross-process atomic idempotency: concurrent identical accepted prose can still duplicate.
- An earlier genuine production post was checked through its moderation audit and deployed code path. No upstream response trace/model version was retained. It does not validate the new rubric's negative-case accuracy or prove research correctness.
- The strict four-field provider response contract was tested offline. No fresh live generation was performed for this release verification.
- Paid classification remains off pending explicit recurring-budget activation. Analytics collection and irreversible retention cleanup also require their own explicit activation decisions. See [usage-analytics.md](usage-analytics.md).

Keep credentials, raw operational logs, private drafts and deliberately bad test payloads out of this document and the repository.

## Follow-up source workflow

The independent-source limitation recorded above describes the #30 release. The separately reviewed [source-evidence workflow](public-source-evidence-design.md) adds exact record-bound, dated public observations and explicit bounded public checks, preserving the moderation gate. Historical observations are never represented as live validation.
