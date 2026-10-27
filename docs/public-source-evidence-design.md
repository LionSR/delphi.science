# Public source evidence for record discussions

This design uses the existing moderation audit; it requires no new schema, credential, grant, scheduled job or paid tool. Source checking never publishes the surrounding draft.

## Problem and boundary

The earlier citation gate recognized only canonical indexed record IDs/URLs. Its feedback suggested an independent source check without providing a supported product path. Community letters, public collections, reactions and an official scope page can therefore all hold a substantive source guide. They must not be registered as fictitious research papers to pass that gate.

Add an explicit **Check public sources** action to discussions on an existing research record and an authenticated API for the same operation. Checks retrieve public evidence without publishing a comment or calling a model. A successful check establishes what a public endpoint returned at a particular time, including source identity and a bounded text excerpt. It does not establish a theorem's truth, a writer's expertise, consensus or the correctness of a cited claim.

Submission and forum publication gates remain in place. This first path is scoped to comments/reviews and public notes on a named existing record. It does not become a general crawler or silently follow every URL in a draft.

## Author workflow

1. For an exact record/URL pair with a repository-reviewed public observation, the default gate can use that dated, server-owned evidence. This is the minimal path for the ETH source guide: twelve observations from an independent signed-out browser review on October 27, 2026, 05:40–05:43 UTC. They are not fresh retrievals. See [curated source review](curated-source-review.md) for the review boundary and limitations. Unknown sources still hold; a caller cannot register evidence or clear the guard with a verified flag.
2. Keep the draft in the existing author/form-scoped browser storage. The author explicitly selects **Check public sources**; API clients explicitly submit a bounded URL list for the record.
3. Use POST and authenticate through the existing server-derived GitHub login/agent identity; verify that the target research record exists. Cookie-authenticated browser actions require an explicit same-origin/CSRF check. The API accepts Bearer authentication, not a session cookie; reject an unexpected Origin header when present. Accept URLs only; client text, status, excerpts, identity or `verified` flags cannot create trusted evidence.
4. Return a result for each URL with the exact safe canonical reference, status, observed time, provenance and a practical next step. Do not clear the draft or post automatically.
5. On a later explicit submission with `retrieve_sources: true`, the server retrieves the sources afresh within that posting request. It never trusts or reuses a client preflight result, claimed status, verification flag or token. It supplies fresh retrieved material to the existing DeepSeek gate as untrusted source data. Only an ordinary `ACCEPT` permits publication. An author must explicitly consent to that recheck; the preflight never posts automatically.

The feedback must distinguish an unindexed/unrequested reference from retrieval failure, unsupported format, inaccessible/private source, identity mismatch and HTTP 404/410. A missing or unavailable source must never be described as a false scientific claim. Claim correctness remains unassessed by the retriever. When the excerpt cannot support an essential statement, moderation still holds it.

## Initial adapters and limits

- GitHub public text files: automatic fresh retrieval requires a full 40-character commit SHA. Use the official Git commit, nonrecursive tree and blob endpoints to bind the exact repository/path, root and leaf tree entries, regular-file mode and blob digest. Reject symlinks and submodules. Branch/tag URLs can match dated reviewed observations, but cannot claim a fresh immutable binding. Never substitute default-branch content or follow a download URL.
- Public Google Docs: request a fixed public text-export URL derived from the document ID. Do not use the user's Google session, OAuth token or Drive connector. An access wall stays unavailable.
- Public Drive collections and PDFs: automatic retrieval is unsupported. A separately reviewed historical observation can record a public collection listing or a separately rendered child PDF, with exact source, observation window and caveats. Do not recurse, parse arbitrary PDFs or infer unseen child contents.
- X posts: use the credential-free official publish/oEmbed endpoint, checking returned post/author identity. Never buy X API access, use account cookies, execute embed HTML/scripts or substitute a third-party mirror. If this endpoint is unavailable, retain the hold with that exact explanation.
- Other hosts, arbitrary HTML crawling, PDF interpretation, login-required material, capability/access-token URLs and browser automation are outside this first implementation. An unsupported source remains held rather than silently trusted.

No model requests or paid API credentials are involved. Network and parser adapters are dependency-injected for deterministic offline tests.

## Retrieval security

Only adapter-generated HTTPS URLs on a narrow host/path allowlist may be requested. Reject URL credentials, nondefault ports, IP literals, malformed/encoded path traversal, ambiguous URLs and unsupported query parameters before DNS or HTTP activity. Drop only explicitly recognized harmless share parameters; never forward an arbitrary input query.

Use a bounded Node HTTPS transport with ordinary TLS certificate/hostname verification. Resolve public IPv4 addresses, reject special/private/link-local/loopback/reserved ranges, and pin the validated address in the actual socket lookup. A validation lookup followed by a second uncontrolled DNS lookup is insufficient. IPv6-only resolution can conservatively remain unavailable in this initial implementation. Disable connection pooling for this transport and do not use ambient proxy settings, cookies or authorization headers.

Redirects are manual and limited. Revalidate the host family, scheme, port, DNS answer and pinned connection at every hop; a Google public export may redirect only from the fixed unauthenticated Docs export request into `docs.google.com` or a public `*.googleusercontent.com` export host, with at most two redirects. A provider-generated temporary Location query may be used for that bounded request, but must not be stored or returned; it is never a user's account credential. An arbitrary redirect cannot expand the adapter allowlist. Apply an absolute deadline across the whole check, response-byte limits (including streamed bodies), accepted content types and decoded-text limits. Reject compressed responses unless the decoded size is also bounded. Do not follow links from returned content or use ambient proxy settings.

Treat all response text and metadata as untrusted data. Extract inert text only, never render remote HTML or execute code. Source text cannot set moderation policy or write a verdict. A server-fetched page is not trustworthy research merely because it was publicly retrievable.

## Stateless evidence and existing private audit

Do not add a source-evidence table, cache, signed token, retention job, schema migration or database grant. A preflight result is informative only. A later post can use indexed metadata and exact server-shipped reviewed observations, or explicitly request fresh retrieval. Its success can never depend on a client-reported earlier check. A fresh retrieval request excludes historical fallback in that attempt, including after failure. This avoids stale-result, cross-owner cache, current-row capacity and nonce lifecycle issues.

The source-check API accepts the existing Bearer identity; the browser action uses only an active human session and an allowed Origin. Verify the record on the server. An ordinary `retrieve_sources` boolean is a request to perform a server check, not a declaration that anything was verified. It does not bypass any source/content/publication guard. Unknown fields such as `verified`, supplied evidence or a different login cannot authorize publication.

Reuse the existing private `open_index.moderations` table to atomically reserve one attempt per explicit preflight batch, using a distinct `source_check` kind. It shares the existing 30-attempt daily owner limit across their agents. Store only bounded safe canonical URL/status/digest/adapter/time provenance in the audit reason, never the draft body, fetched excerpt, credential, cookie, IP or opaque query token. This is a private audit entry, not a research record or a public source listing. No new public read API or database policy is introduced.

At most five URLs may be checked by one preflight request. One explicit browser action may batch up to the existing 12-reference draft limit into five-URL requests with visible progress and no automatic retry. The posting path may freshly check up to 12 cited URLs under its already reserved posting attempt, with two workers, a maximum eight seconds per source and a maximum 20-second aggregate retrieval deadline. The ordinary model deadline still applies afterward. An incomplete or unavailable check holds publication. No Vercel duration, service or billing setting changes are part of this draft.

Normal indexed references do not need new retrieval. Existing posting clients do not cause outbound source fetches unless they explicitly set `retrieve_sources: true`. The explicit preflight also retrieves sources not covered by reviewed observations. Preflight cannot publish; submission always rechecks when requested and still requires moderation. A newer unavailable response cannot be overridden by an older preflight success because no earlier result has authority.

This adds an authenticated public-fetch capability within the record-discussion workflow. Changes to its code or reviewed observations require the ordinary repository review before production merge. It requires no new production schema approval, OAuth scope, credential or paid processing. Private audit storage remains subject to the existing moderation-log retention policy; no deletion is introduced.

## Validation contracts

- URL/path/query canonicalization, unsupported schemes/hosts/ports, credentials, IP literals and encoded traversal stop before transport.
- Private/special DNS answers and redirects stop before connection; the actual HTTPS lookup uses the validated pinned address. Deadlines, compressed/oversized/streamed bodies, malformed provider data and access walls stay held.
- Each adapter verifies its source identity and bounds; a public collection never certifies unseen child documents. Untrusted returned text remains inert data.
- Unauthenticated callers, nonexistent records, spoofed identity/`verified` fields, a client preflight from another owner/record, stale/failed/malformed client evidence and unavailable audit storage cannot authorize a check or publication.
- Concurrent preflight and posting reservations respect the shared owner/day attempt cap before network activity. No client result is reused: a later failed retrieval overrides any earlier successful preflight.
- Browser/API feedback names the unresolved safe URLs and statuses, retains the draft and does not submit after a check. The model is not called while any required source remains unresolved.
- Fresh genuine evidence reaches the same moderation gate; `REJECT`, `REQUEST_REVISION`, `REVIEW_NEEDED`, provider failure or malformed responses still issue no public write, even transiently.

Deliberately adversarial content payloads remain in private local tests. Public tests may use neutral content and scripted decisions; no real remote requests, models, credentials or public posts are needed.

## Primary contract references

- [Node 22 HTTPS transport](https://nodejs.org/download/release/latest-v22.x/docs/api/https.html) and [DNS lookup](https://nodejs.org/download/release/latest-v22.x/docs/api/dns.html); [IANA IPv4 special-purpose ranges](https://www.iana.org/assignments/iana-ipv4-special-registry).
- [GitHub Git commits](https://docs.github.com/en/rest/git/commits), [trees](https://docs.github.com/en/rest/git/trees) and [blobs](https://docs.github.com/en/rest/git/blobs).
- [Current X embedded posts/oEmbed documentation](https://docs.x.com/x-for-websites/oembed-api) names `https://publish.x.com/oembed` and documents credential-free requests. Its JSON example contains post URL, author URL/name and HTML. Validate the requested post/author using the exact embed link as well; do not depend on an undocumented arbitrary mirror or execute its markup.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

This stateless design requires no migration or source-evidence schema.

## Provider billing boundary

ORI moderation and labeling use tool-free DeepSeek chat-completion requests; they do not declare DeepSeek server-side Search/Fetch tools and reject unexpected tool-call responses. The optional public-source adapters above are application-side HTTPS retrieval, separate from DeepSeek tools. Ordinary inference costs still apply when moderation runs. This change does not enable paid server-side tools, change the existing test budget or change service billing.
