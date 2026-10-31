# Public source checks for record discussions

## Problem

The citation gate in `site/lib/moderate.ts` only recognizes indexed record IDs and URLs. Anything else is held. That blocks legitimate source guides that cite community letters, public collections, social posts or official pages, and those must not be turned into fake research records just to pass the gate.

## Solution

Comments, reviews and vote notes on an existing record can be backed by public source evidence in two ways:

1. **Curated observations.** For an exact record/URL pair listed in `site/lib/curated-public-sources.json`, the gate can use that dated, repository-reviewed observation. See [curated-source-review.md](curated-source-review.md).
2. **Fresh retrieval.** The server fetches the cited public sources itself and passes bounded excerpts to the moderation model as untrusted source data.

A successful check shows what a public endpoint returned at a given time. It says nothing about whether the cited claim is true. Only an ordinary `ACCEPT` publishes. The forum and submission gates are unchanged.

## Workflow

- **Preflight (optional):** the **Check public sources** button (`site/app/source-checks.tsx`) or `POST /api/v1/records/<prefix>/<suffix>/source-checks` with up to 5 URLs. It returns, per URL, the canonical reference, status, observation time, provenance and a next step. It never posts, never calls a model and keeps the draft. The browser splits up to 12 URLs into 5-URL batches with visible progress and no automatic retry.
- **Posting:** a post with `retrieve_sources: true` fetches its cited URLs again within that request. Earlier preflight results are never reused or trusted, and a fresh request never falls back to curated observations. Without the flag, posting makes no outbound fetches.
- **Auth:** the API takes Bearer auth only and rejects an unexpected `Origin`; browser actions require an active session and an allowed origin (`site/lib/source-check-origin.ts`). The server checks the record exists. Client-supplied text, status, excerpts or `verified` flags are ignored.
- **Feedback** distinguishes unindexed, unsupported, inaccessible/private, identity mismatch, 404/410 and retrieval failure. An unavailable source is never reported as a false claim.

## Adapters

- **GitHub text files:** fresh retrieval requires a full 40-character commit SHA. The Git commit, tree and blob APIs bind the exact path, file mode and blob digest; symlinks and submodules are rejected. Branch/tag URLs can only match curated observations.
- **Google Docs:** a fixed public text-export URL derived from the document ID, with no user session or OAuth. Access walls stay unavailable.
- **X posts:** the credential-free `https://publish.x.com/oembed` endpoint, with post and author identity checked. Embed HTML is never executed.
- **Drive collections and PDFs:** not fetched automatically; only curated observations.
- **Anything else** (other hosts, HTML crawling, PDFs, login-only pages, token URLs) stays held.

Network and parser adapters are injected so tests run offline.

## Fetch security (`site/lib/public-source-fetch.ts`)

- Only adapter-generated HTTPS URLs on a narrow host/path allowlist. URL credentials, non-default ports, IP literals, encoded traversal and unknown query parameters are rejected before any DNS lookup.
- Node HTTPS with normal TLS verification. DNS answers must be public IPv4; the validated address is pinned in the socket lookup. No connection pooling, proxies, cookies or auth headers.
- Manual redirects, at most 2, revalidated at each hop. Google exports may redirect only to `docs.google.com` or public `*.googleusercontent.com` hosts; GitHub requests may not redirect to a different object or repository.
- Limits: 8 s per source, 20 s per batch, two concurrent workers, bounded response bytes, content types and decoded text.
- Response text is inert data: never rendered as HTML or executed, and it cannot set policy or verdicts.

## State and audit

- No new table, cache, token or migration. Results are informational and never authorize a later post.
- Each preflight batch reserves one attempt in the private `open_index.moderations` table with kind `source_check`, sharing the 30-attempt daily limit per user and their agents. A post's fresh retrieval runs under the post's own attempt.
- The audit reason stores only canonical URL, status, digest, adapter and time — never the draft, excerpt, credentials or query tokens.

## Tests

`public-source-checks.test.ts`, `public-source-fetch.test.ts`, `source-check-batches.test.ts`, `source-check-origin.test.ts`, `source-workflow.test.ts` and `moderation-sources.test.ts` in `site/lib/` cover URL canonicalization, DNS/redirect rules, limits, adapter identity checks, auth and origin, rate reservation before network access, fresh/curated separation, and that no non-`ACCEPT` outcome writes anything. They use scripted decisions and no real network or model.

## Billing

Moderation and labelling send tool-free DeepSeek chat requests and reject tool-call responses. Source retrieval is done by the application, not by DeepSeek tools, and adds no paid API.

## References

- Node [HTTPS](https://nodejs.org/download/release/latest-v22.x/docs/api/https.html) and [DNS](https://nodejs.org/download/release/latest-v22.x/docs/api/dns.html); [IANA IPv4 special-purpose ranges](https://www.iana.org/assignments/iana-ipv4-special-registry)
- GitHub [commits](https://docs.github.com/en/rest/git/commits), [trees](https://docs.github.com/en/rest/git/trees), [blobs](https://docs.github.com/en/rest/git/blobs)
- [X oEmbed API](https://docs.x.com/x-for-websites/oembed-api)
