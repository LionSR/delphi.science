# Forum and publication-gate validation — 2026-10-27

Historical record for [PR #30](https://github.com/LionSR/open-research-index/pull/30), merged as `dc925885cd30ed286b70dfeb73f62f89550aad6b`.

## Scope

- DeepSeek moderation gate with four decisions (`site/lib/moderate.ts`) for submissions, questions, answers, comments/reviews and vote notes.
- Submissions resolve upstream metadata before screening; refused objects are never written (`site/lib/submit.ts`).
- Moderation context includes the question, reply parent, up to four earlier posts, or the record's metadata (`site/lib/comments.ts`).
- Sanitized Markdown with MathJax SVG; no raw HTML or remote images (`site/lib/markdown.ts`).
- Browser drafts kept per author and thread after a refusal (`site/app/post-form.tsx`, `site/lib/post-drafts.ts`, `site/lib/post-feedback.ts`).

## Results

- CI ([run 40451643024](https://github.com/LionSR/open-research-index/actions/runs/40451643024)) on head `6e09f41e`: 59 indexer, 4 candidate and 223 site tests passed. TypeScript and the production build passed.
- Production deployment `dpl_B91ciAp9LMPJQGoxbfY8eT4f9nqT` at 04:50 UTC: public pages and APIs returned 200; `/api/v1/stats` without auth returned 401. Analytics was not active.

## Known limits at release

- Indexed citation metadata proves identity, not the cited content. Unknown cited URLs are held before the model call, sometimes more strictly than needed. (Addressed later by [public source checks](public-source-evidence-design.md).)
- Retrying identical accepted posts concurrently can still create duplicates.
- Moderation was tested offline with scripted decisions; no live model run validated the rubric.
