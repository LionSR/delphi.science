// End to end, as a real MCP client does it: the official SDK client discovers the authorization server and registers,
// a real browser signs in and approves, the SDK exchanges the code, then tools are called over Streamable HTTP, the
// vote is checked on the record's page, and the connection is revoked at /keys. Not part of 
> test
> node --test --experimental-strip-types 'lib/**/*.test.ts'

TAP version 13
# Subtest: the plain and www site addresses return to the registered one; other hosts keep their own
ok 1 - the plain and www site addresses return to the registered one; other hosts keep their own
  ---
  duration_ms: 0.933879
  type: 'test'
  ...
# Subtest: affiliations drop GitHub's leading @ only before a name
ok 2 - affiliations drop GitHub's leading @ only before a name
  ---
  duration_ms: 2320.265188
  type: 'test'
  ...
# Subtest: the migration starts from the newest named sign-in; lookups ignore login case and drop bare logins
ok 3 - the migration starts from the newest named sign-in; lookups ignore login case and drop bare logins
  ---
  duration_ms: 7.728823
  type: 'test'
  ...
# Subtest: sign-in copies GitHub until the person edits; their edits, even blank ones, then stick
ok 4 - sign-in copies GitHub until the person edits; their edits, even blank ones, then stick
  ---
  duration_ms: 14.411551
  type: 'test'
  ...
# Subtest: edits over the length limits are refused
ok 5 - edits over the length limits are refused
  ---
  duration_ms: 1.87586
  type: 'test'
  ...
# Subtest: a failed lookup shows no names, and a failed copy never fails sign-in
ok 6 - a failed lookup shows no names, and a failed copy never fails sign-in
  ---
  duration_ms: 0.291119
  type: 'test'
  ...
# Subtest: an agent reads and sets its person's name and affiliation; fields left out keep their value
ok 7 - an agent reads and sets its person's name and affiliation; fields left out keep their value
  ---
  duration_ms: 2519.516305
  type: 'test'
  ...
# Subtest: profile edits need a key and a field within limits
ok 8 - profile edits need a key and a field within limits
  ---
  duration_ms: 5.769043
  type: 'test'
  ...
# Subtest: an agent lists its person's keys and revokes one, its own included, but never a browser session
ok 9 - an agent lists its person's keys and revokes one, its own included, but never a browser session
  ---
  duration_ms: 58.61051
  type: 'test'
  ...
# Subtest: posts link to their permalinks and say whether a bot posted them; pages are numbered
ok 10 - posts link to their permalinks and say whether a bot posted them; pages are numbered
  ---
  duration_ms: 58.478209
  type: 'test'
  ...
# Subtest: tabs show counts and mark the current one, and keep the tab across pages; the votes tab lists record votes
ok 11 - tabs show counts and mark the current one, and keep the tab across pages; the votes tab lists record votes
  ---
  duration_ms: 14.996962
  type: 'test'
  ...
# Subtest: a known name heads the profile and labels its posts, with the login beside it, then the owner's editor
ok 12 - a known name heads the profile and labels its posts, with the login beside it, then the owner's editor
  ---
  duration_ms: 20.043079
  type: 'test'
  ...
# Subtest: an empty page says so without paging on; a failed one offers to try again
ok 13 - an empty page says so without paging on; a failed one offers to try again
  ---
  duration_ms: 1.558083
  type: 'test'
  ...
# Subtest: login validation normalizes case without accepting arbitrary account paths
ok 14 - login validation normalizes case without accepting arbitrary account paths
  ---
  duration_ms: 6.006608
  type: 'test'
  ...
# Subtest: human and bot contributions come only from public rows with an explicit DTO whitelist
ok 15 - human and bot contributions come only from public rows with an explicit DTO whitelist
  ---
  duration_ms: 2076.137039
  type: 'test'
  ...
# Subtest: a profile pages like every list: by number or by cursor, with the tab's total
ok 16 - a profile pages like every list: by number or by cursor, with the tab's total
  ---
  duration_ms: 1305.343419
  type: 'test'
  ...
# Subtest: limits and pages outside the schema fail before a query
ok 17 - limits and pages outside the schema fail before a query
  ---
  duration_ms: 5.234559
  type: 'test'
  ...
# Subtest: nonexistent and private-only handles have identical empty public activity without private-table dependence
ok 18 - nonexistent and private-only handles have identical empty public activity without private-table dependence
  ---
  duration_ms: 1187.986785
  type: 'test'
  ...
# Subtest: posts on missing or gone places, in topics without a root post, or replying across places do not expose activity
ok 19 - posts on missing or gone places, in topics without a root post, or replying across places do not expose activity
  ---
  duration_ms: 999.477743
  type: 'test'
  ...
# Subtest: permalinks encode public record identifiers instead of interpreting their punctuation
ok 20 - permalinks encode public record identifiers instead of interpreting their punctuation
  ---
  duration_ms: 1293.211886
  type: 'test'
  ...
# Subtest: query failures expose a neutral public error without database diagnostics
ok 21 - query failures expose a neutral public error without database diagnostics
  ---
  duration_ms: 0.839745
  type: 'test'
  ...
# Subtest: posts are typed as topic, reply, comment or review, and tabs and counts follow the types
ok 22 - posts are typed as topic, reply, comment or review, and tabs and counts follow the types
  ---
  duration_ms: 1217.11726
  type: 'test'
  ...
# Subtest: record votes on live records list newest first, to the microsecond
ok 23 - record votes on live records list newest first, to the microsecond
  ---
  duration_ms: 1086.678227
  type: 'test'
  ...
# Subtest: the agent speaks first, with the account linked as its team
ok 24 - the agent speaks first, with the account linked as its team
  ---
  duration_ms: 7.401936
  type: 'test'
  ...
# Subtest: agent attribution preserves public names, account links and affiliations, and escapes names
ok 25 - agent attribution preserves public names, account links and affiliations, and escapes names
  ---
  duration_ms: 1.777378
  type: 'test'
  ...
# Subtest: human attribution stays unchanged when the agent or public name is absent
ok 26 - human attribution stays unchanged when the agent or public name is absent
  ---
  duration_ms: 1.807845
  type: 'test'
  ...
# Subtest: display-name normalization is optional, whitespace-neutral and Unicode bounded
ok 27 - display-name normalization is optional, whitespace-neutral and Unicode bounded
  ---
  duration_ms: 2129.726486
  type: 'test'
  ...
# Subtest: agent names are trimmed and at most 60 characters; missing, blank, non-text or longer ones are refused with a fix
ok 28 - agent names are trimmed and at most 60 characters; missing, blank, non-text or longer ones are refused with a fix
  ---
  duration_ms: 0.874511
  type: 'test'
  ...
# Subtest: sessions keep a cosmetic name, or the login when it is blank, while the API identity stays the login
ok 29 - sessions keep a cosmetic name, or the login when it is blank, while the API identity stays the login
  ---
  duration_ms: 18.785028
  type: 'test'
  ...
# Subtest: agent keys remain API callers and cannot become browser people or device approvers
ok 30 - agent keys remain API callers and cannot become browser people or device approvers
  ---
  duration_ms: 10.400371
  type: 'test'
  ...
# Subtest: revoked, expired and unknown sessions do not identify a person
ok 31 - revoked, expired and unknown sessions do not identify a person
  ---
  duration_ms: 8.597977
  type: 'test'
  ...
# Subtest: page URLs and dynamic paths share a fixed public route allowlist
ok 32 - page URLs and dynamic paths share a fixed public route allowlist
  ---
  duration_ms: 2.999558
  type: 'test'
  ...
# Subtest: incoming referrers cannot bypass event URL filtering with paths or queries
ok 33 - incoming referrers cannot bypass event URL filtering with paths or queries
  ---
  duration_ms: 4.354433
  type: 'test'
  ...
# Subtest: pre-existing SDK attribution cannot add identifiers or traits to pageviews
ok 34 - pre-existing SDK attribution cannot add identifiers or traits to pageviews
  ---
  duration_ms: 0.173496
  type: 'test'
  ...
# Subtest: discovery
    # Subtest: the resource names this site as its authorization server, and the server names its endpoints
    ok 1 - the resource names this site as its authorization server, and the server names its endpoints
      ---
      duration_ms: 1.522355
      type: 'test'
      ...
    # Subtest: the metadata routes serve them, at the root and under the resource path, to any origin
    ok 2 - the metadata routes serve them, at the root and under the resource path, to any origin
      ---
      duration_ms: 31.087091
      type: 'test'
      ...
    1..2
ok 35 - discovery
  ---
  duration_ms: 2131.030637
  type: 'suite'
  ...
# Subtest: client registration
    # Subtest: a public client registers itself through the route and is told it has no secret
    ok 1 - a public client registers itself through the route and is told it has no secret
      ---
      duration_ms: 13.037
      type: 'test'
      ...
    # Subtest: a client with no name is named after where it returns to; a long name is cut to an agent name's length
    ok 2 - a client with no name is named after where it returns to; a long name is cut to an agent name's length
      ---
      duration_ms: 20.992997
      type: 'test'
      ...
    # Subtest: redirect URIs must be https, loopback http, or an app's own scheme, with no fragment
    ok 3 - redirect URIs must be https, loopback http, or an app's own scheme, with no fragment
      ---
      duration_ms: 18.659959
      type: 'test'
      ...
    # Subtest: a loopback redirect matches on any port; anything else must match exactly
    ok 4 - a loopback redirect matches on any port; anything else must match exactly
      ---
      duration_ms: 0.435274
      type: 'test'
      ...
    # Subtest: registrations never used are dropped after 90 days; used ones are kept
    ok 5 - registrations never used are dropped after 90 days; used ones are kept
      ---
      duration_ms: 30.523818
      type: 'test'
      ...
    1..5
ok 36 - client registration
  ---
  duration_ms: 84.430323
  type: 'suite'
  ...
# Subtest: authorization
    # Subtest: a request from an unknown client, or to an unregistered return address, is shown to the person and goes nowhere
    ok 1 - a request from an unknown client, or to an unregistered return address, is shown to the person and goes nowhere
      ---
      duration_ms: 7.092684
      type: 'test'
      ...
    # Subtest: other problems go back to the client with its state: no PKCE, plain PKCE, another response type or resource
    ok 2 - other problems go back to the client with its state: no PKCE, plain PKCE, another response type or resource
      ---
      duration_ms: 16.620405
      type: 'test'
      ...
    # Subtest: an approved code is exchanged once, at the token route, for an agent key named after the client
    ok 3 - an approved code is exchanged once, at the token route, for an agent key named after the client
      ---
      duration_ms: 25.283118
      type: 'test'
      ...
    # Subtest: the exchange needs the right verifier, client and return address, within five minutes
    ok 4 - the exchange needs the right verifier, client and return address, within five minutes
      ---
      duration_ms: 32.493805
      type: 'test'
      ...
    # Subtest: a code presented twice is refused, and the key from its first use stops working
    ok 5 - a code presented twice is refused, and the key from its first use stops working
      ---
      duration_ms: 11.138587
      type: 'test'
      ...
    1..5
ok 37 - authorization
  ---
  duration_ms: 93.156531
  type: 'suite'
  ...
# Subtest: a caller without a token
    # Subtest: lists every tool, each marked with whether it needs sign-in, and with honest annotations
    ok 1 - lists every tool, each marked with whether it needs sign-in, and with honest annotations
      ---
      duration_ms: 24.903463
      type: 'test'
      ...
    # Subtest: reads records, comments and the forum
    ok 2 - reads records, comments and the forum
      ---
      duration_ms: 48.252075
      type: 'test'
      ...
    # Subtest: cannot use any tool that acts for a person: each asks for sign-in and nothing is stored
    ok 3 - cannot use any tool that acts for a person: each asks for sign-in and nothing is stored
      ---
      duration_ms: 29.315568
      type: 'test'
      ...
    # Subtest: a token that does not work is 401 with where to sign in, even for a read
    ok 4 - a token that does not work is 401 with where to sign in, even for a read
      ---
      duration_ms: 5.746562
      type: 'test'
      ...
    1..4
ok 38 - a caller without a token
  ---
  duration_ms: 108.487853
  type: 'suite'
  ...
# Subtest: a signed-in plugin
    # Subtest: acts as the client's name on the person's team, sharing their one vote with their other agents
    ok 1 - acts as the client's name on the person's team, sharing their one vote with their other agents
      ---
      duration_ms: 54.284061
      type: 'test'
      ...
    # Subtest: the same token works on the REST API, where it is an agent key like any other
    ok 2 - the same token works on the REST API, where it is an agent key like any other
      ---
      duration_ms: 56.575919
      type: 'test'
      ...
    # Subtest: posts go through moderation: an accepted comment is stored with the attribution, a refused one is not
    ok 3 - posts go through moderation: an accepted comment is stored with the attribution, a refused one is not
      ---
      duration_ms: 92.984665
      type: 'test'
      ...
    # Subtest: with no moderation provider nothing is posted
    ok 4 - with no moderation provider nothing is posted
      ---
      duration_ms: 26.610985
      type: 'test'
      ...
    # Subtest: the daily limit of 30 attempts is the person's, whichever agent used them
    ok 5 - the daily limit of 30 attempts is the person's, whichever agent used them
      ---
      duration_ms: 19.2913
      type: 'test'
      ...
    # Subtest: takes part in the forum: asks, is answered, votes, and accepts; nobody votes on their own post
    ok 6 - takes part in the forum: asks, is answered, votes, and accepts; nobody votes on their own post
      ---
      duration_ms: 96.003578
      type: 'test'
      ...
    # Subtest: a post that contains the token is refused and the token revoked, as for any agent key
    ok 7 - a post that contains the token is refused and the token revoked, as for any agent key
      ---
      duration_ms: 15.310463
      type: 'test'
      ...
    1..7
ok 39 - a signed-in plugin
  ---
  duration_ms: 361.492322
  type: 'suite'
  ...
# Subtest: expiry and revocation
    # Subtest: an expired token stops working
    ok 1 - an expired token stops working
      ---
      duration_ms: 17.124152
      type: 'test'
      ...
    # Subtest: the person revokes it at /keys, where it is listed with their other agents
    ok 2 - the person revokes it at /keys, where it is listed with their other agents
      ---
      duration_ms: 12.085272
      type: 'test'
      ...
    # Subtest: the client revokes it at the revocation route; unknown tokens and browser sessions are left alone
    ok 3 - the client revokes it at the revocation route; unknown tokens and browser sessions are left alone
      ---
      duration_ms: 27.152008
      type: 'test'
      ...
    1..3
ok 40 - expiry and revocation
  ---
  duration_ms: 56.629201
  type: 'suite'
  ...
# Subtest: the reviewers' demo account
    # Subtest: is off unless both a login no GitHub account can have and a long password are set
    ok 1 - is off unless both a login no GitHub account can have and a long password are set
      ---
      duration_ms: 0.323778
      type: 'test'
      ...
    # Subtest: signs in with exactly its login and password
    ok 2 - signs in with exactly its login and password
      ---
      duration_ms: 0.242804
      type: 'test'
      ...
    # Subtest: once signed in it is an account like any other: approves a plugin and acts under its own login
    ok 3 - once signed in it is an account like any other: approves a plugin and acts under its own login
      ---
      duration_ms: 10.21067
      type: 'test'
      ...
    1..3
ok 41 - the reviewers' demo account
  ---
  duration_ms: 10.915389
  type: 'suite'
  ...
# Subtest: the MCP tools follow the OpenAPI document
    # Subtest: search_records takes searchRecords' query parameters, but format
    ok 1 - search_records takes searchRecords' query parameters, but format
      ---
      duration_ms: 48.966968
      type: 'test'
      ...
    # Subtest: list_discussed_records takes the same, with its query in q's syntax and no q or sort
    ok 2 - list_discussed_records takes the same, with its query in q's syntax and no q or sort
      ---
      duration_ms: 7.871859
      type: 'test'
      ...
    # Subtest: get_record takes getRecord's path parameters as one id
    ok 3 - get_record takes getRecord's path parameters as one id
      ---
      duration_ms: 17.163748
      type: 'test'
      ...
    # Subtest: outputs are Record and SearchResult, with page for links and responses shown as quotes
    ok 4 - outputs are Record and SearchResult, with page for links and responses shown as quotes
      ---
      duration_ms: 6.65845
      type: 'test'
      ...
    1..4
ok 42 - the MCP tools follow the OpenAPI document
  ---
  duration_ms: 81.992123
  type: 'suite'
  ...
# Subtest: what the tools return fits their output schemas, closed
    # Subtest: get_record: a real record fits, and a field the schema leaves out does not
    ok 1 - get_record: a real record fits, and a field the schema leaves out does not
      ---
      duration_ms: 99.832679
      type: 'test'
      ...
    # Subtest: search_records and list_discussed_records, compact and full
    ok 2 - search_records and list_discussed_records, compact and full
      ---
      duration_ms: 138.253452
      type: 'test'
      ...
    # Subtest: get_record shows each response's stance, and says what an id looks like when one is malformed
    ok 3 - get_record shows each response's stance, and says what an id looks like when one is malformed
      ---
      duration_ms: 19.045753
      type: 'test'
      ...
    # Subtest: query, search_records' old name for q, still answers the same
    ok 4 - query, search_records' old name for q, still answers the same
      ---
      duration_ms: 8.636584
      type: 'test'
      ...
    1..4
ok 43 - what the tools return fits their output schemas, closed
  ---
  duration_ms: 2368.98735
  type: 'suite'
  ...
# Subtest: site/openapi.json is the current OpenAPI document (npm run openapi rewrites it)
ok 44 - site/openapi.json is the current OpenAPI document (npm run openapi rewrites it)
  ---
  duration_ms: 138.857293
  type: 'test'
  ...
# Subtest: the OpenAPI document
    # Subtest: documents every API route and method and nothing else, each served by operation() under its id and usage name from the document
    ok 1 - documents every API route and method and nothing else, each served by operation() under its id and usage name from the document
      ---
      duration_ms: 260.490501
      type: 'test'
      ...
    # Subtest: fits what tool importers accept: unique operation ids, summaries under 300 characters, parameters under 700
    ok 2 - fits what tool importers accept: unique operation ids, summaries under 300 characters, parameters under 700
      ---
      duration_ms: 0.39567
      type: 'test'
      ...
    # Subtest: its schemas compile
    ok 3 - its schemas compile
      ---
      duration_ms: 106.725903
      type: 'test'
      ...
    1..3
ok 45 - the OpenAPI document
  ---
  duration_ms: 368.692693
  type: 'suite'
  ...
# Subtest: real responses fit it
    # Subtest: search, compact and full, as JSON and Markdown, and a bad query
    ok 1 - search, compact and full, as JSON and Markdown, and a bad query
      ---
      duration_ms: 81.173431
      type: 'test'
      ...
    # Subtest: records, with stances and a reception, and an unknown id
    ok 2 - records, with stances and a reception, and an unknown id
      ---
      duration_ms: 20.627262
      type: 'test'
      ...
    # Subtest: comments and votes, read and written with an agent key
    ok 3 - comments and votes, read and written with an agent key
      ---
      duration_ms: 122.311614
      type: 'test'
      ...
    # Subtest: prefixes, usage stats and the agent-key device flow
    ok 4 - prefixes, usage stats and the agent-key device flow
      ---
      duration_ms: 56.131819
      type: 'test'
      ...
    # Subtest: a request the document does not allow is a 400 that says what to send
    ok 5 - a request the document does not allow is a 400 that says what to send
      ---
      duration_ms: 44.095069
      type: 'test'
      ...
    # Subtest: query strings are read as the declared types, with their defaults
    ok 6 - query strings are read as the declared types, with their defaults
      ---
      duration_ms: 40.434722
      type: 'test'
      ...
    # Subtest: /api/v1 and /llms.txt list the operations from the document
    ok 7 - /api/v1 and /llms.txt list the operations from the document
      ---
      duration_ms: 9.894649
      type: 'test'
      ...
    # Subtest: submitting a link, and the forum: asking, answering, voting and accepting
    ok 8 - submitting a link, and the forum: asking, answering, voting and accepting
      ---
      duration_ms: 281.19704
      type: 'test'
      ...
    # Subtest: a person's activity, by tab and page, for agents as for /u/<login>
    ok 9 - a person's activity, by tab and page, for agents as for /u/<login>
      ---
      duration_ms: 92.315443
      type: 'test'
      ...
    # Subtest: posting feedback: every prose path documents revision, verification hold and service failure
    ok 10 - posting feedback: every prose path documents revision, verification hold and service failure
      ---
      duration_ms: 187.450412
      type: 'test'
      ...
    # Subtest: public source checks document auth, same-origin, strict URL bodies and unavailable audit storage
    ok 11 - public source checks document auth, same-origin, strict URL bodies and unavailable audit storage
      ---
      duration_ms: 77.499649
      type: 'test'
      ...
    # Subtest: post editing responses preserve the original through refusal and conflicts
    ok 12 - post editing responses preserve the original through refusal and conflicts
      ---
      duration_ms: 108.108035
      type: 'test'
      ...
    # Subtest: an agent reads and sets its person's name and affiliation, and lists and revokes keys
    ok 13 - an agent reads and sets its person's name and affiliation, and lists and revokes keys
      ---
      duration_ms: 87.626799
      type: 'test'
      ...
    # Subtest: every documented response was checked
    ok 14 - every documented response was checked
      ---
      duration_ms: 0.336779
      type: 'test'
      ...
    1..14
ok 46 - real responses fit it
  ---
  duration_ms: 3699.017946
  type: 'suite'
  ...
# Subtest: client names
    # Subtest: known products are named from anywhere in the user agent; nothing else of it is kept, since it could hold a name, email, key or URL
    ok 1 - known products are named from anywhere in the user agent; nothing else of it is kept, since it could hold a name, email, key or URL
      ---
      duration_ms: 1.289442
      type: 'test'
      ...
    # Subtest: each client name has a kind; unknown names are other
    ok 2 - each client name has a kind; unknown names are other
      ---
      duration_ms: 0.187127
      type: 'test'
      ...
    1..2
ok 47 - client names
  ---
  duration_ms: 2.000413
  type: 'suite'
  ...
# Subtest: weeks
    # Subtest: start on Monday, UTC
    ok 1 - start on Monday, UTC
      ---
      duration_ms: 0.29833
      type: 'test'
      ...
    1..1
ok 48 - weeks
  ---
  duration_ms: 0.416576
  type: 'suite'
  ...
# Subtest: counting calls on Postgres
    # Subtest: calls add up per day, endpoint and client, and stats read them back
    ok 1 - calls add up per day, endpoint and client, and stats read them back
      ---
      duration_ms: 2025.829164
      type: 'test'
      ...
    # Subtest: unknown products collapse to one bucket and unique endpoints never get stored
    ok 2 - unknown products collapse to one bucket and unique endpoints never get stored
      ---
      duration_ms: 1882.16619
      type: 'test'
      ...
    1..2
ok 49 - counting calls on Postgres
  ---
  duration_ms: 3908.495777
  type: 'suite'
  ...
# Subtest: fixed categories match the database constraints; only four aggregate columns exist
ok 50 - fixed categories match the database constraints; only four aggregate columns exist
  ---
  duration_ms: 1504.541547
  type: 'test'
  ...
# Subtest: retains exactly 90 UTC dates, with repeatable cleanup even when traffic stops
ok 51 - retains exactly 90 UTC dates, with repeatable cleanup even when traffic stops
  ---
  duration_ms: 1123.980128
  type: 'test'
  ...
# Subtest: migration preserves legacy rows while reports exclude unsafe dimensions and old dates
ok 52 - migration preserves legacy rows while reports exclude unsafe dimensions and old dates
  ---
  duration_ms: 1594.926433
  type: 'test'
  ...
# Subtest: admin allowlist fails closed and matches whole GitHub logins
ok 53 - admin allowlist fails closed and matches whole GitHub logins
  ---
  duration_ms: 0.55311
  type: 'test'
  ...
# Subtest: collection and deletion fail closed independently, including direct calls and stats reads
ok 54 - collection and deletion fail closed independently, including direct calls and stats reads
  ---
  duration_ms: 1084.669288
  type: 'test'
  ...
# Subtest: scheduler and CLI are inert until both collection and retention are explicitly enabled
ok 55 - scheduler and CLI are inert until both collection and retention are explicitly enabled
  ---
  duration_ms: 984.003295
  type: 'test'
  ...
# Subtest: retention job does not print database credentials when configuration is invalid
ok 56 - retention job does not print database credentials when configuration is invalid
  ---
  duration_ms: 378.256631
  type: 'test'
  ...
# Subtest: source-check endpoint does not expand the deployed aggregate metric categories or issue cleanup writes
ok 57 - source-check endpoint does not expand the deployed aggregate metric categories or issue cleanup writes
  ---
  duration_ms: 0.195348
  type: 'test'
  ...
# Subtest: homepage order exposes ranking and chronological choices and marks the active one
ok 58 - homepage order exposes ranking and chronological choices and marks the active one
  ---
  duration_ms: 8.540547
  type: 'test'
  ...
# Subtest: one citation is found with status indexed_metadata: versioned arXiv ID
ok 59 - one citation is found with status indexed_metadata: versioned arXiv ID
  ---
  duration_ms: 2.324332
  type: 'test'
  ...
# Subtest: one citation is found with status indexed_metadata: uppercase versioned arXiv ID
ok 60 - one citation is found with status indexed_metadata: uppercase versioned arXiv ID
  ---
  duration_ms: 0.446335
  type: 'test'
  ...
# Subtest: one citation is found with status indexed_metadata: Chinese full stop after URL
ok 61 - one citation is found with status indexed_metadata: Chinese full stop after URL
  ---
  duration_ms: 0.444546
  type: 'test'
  ...
# Subtest: one citation is found with status indexed_metadata: Chinese parentheses
ok 62 - one citation is found with status indexed_metadata: Chinese parentheses
  ---
  duration_ms: 0.115486
  type: 'test'
  ...
# Subtest: one citation is found with status unresolved: unknown arXiv ID before a Chinese full stop
ok 63 - one citation is found with status unresolved: unknown arXiv ID before a Chinese full stop
  ---
  duration_ms: 0.176581
  type: 'test'
  ...
# Subtest: one citation is found with status unresolved: unknown uppercase URL before a Chinese full stop
ok 64 - one citation is found with status unresolved: unknown uppercase URL before a Chinese full stop
  ---
  duration_ms: 0.435391
  type: 'test'
  ...
# Subtest: shipped registry validates and every observation is historical evidence for its record, not a fresh retrieval
ok 65 - shipped registry validates and every observation is historical evidence for its record, not a fresh retrieval
  ---
  duration_ms: 3.052215
  type: 'test'
  ...
# Subtest: lookup matches canonical safe identity and exact record scope only
ok 66 - lookup matches canonical safe identity and exact record scope only
  ---
  duration_ms: 0.588675
  type: 'test'
  ...
# Subtest: the digest hashes the canonical reviewed record, not page bytes
ok 67 - the digest hashes the canonical reviewed record, not page bytes
  ---
  duration_ms: 0.202191
  type: 'test'
  ...
# Subtest: returned observations are deeply immutable and validation cannot register caller data
ok 68 - returned observations are deeply immutable and validation cannot register caller data
  ---
  duration_ms: 0.613703
  type: 'test'
  ...
# Subtest: unknown authority fields and structural errors fail closed
ok 69 - unknown authority fields and structural errors fail closed
  ---
  duration_ms: 0.889408
  type: 'test'
  ...
# Subtest: bounded inert text, public identities and honest observation windows are required
ok 70 - bounded inert text, public identities and honest observation windows are required
  ---
  duration_ms: 0.786082
  type: 'test'
  ...
# Subtest: heavy Unicode math is returned for revision within the verdict field limits
ok 71 - heavy Unicode math is returned for revision within the verdict field limits
  ---
  duration_ms: 1.205051
  type: 'test'
  ...
# Subtest: the same math in LaTeX, or inside code, passes
ok 72 - the same math in LaTeX, or inside code, passes
  ---
  duration_ms: 0.254211
  type: 'test'
  ...
# Subtest: a few stray symbols, Greek-language text, names and punctuation pass
ok 73 - a few stray symbols, Greek-language text, names and punctuation pass
  ---
  duration_ms: 0.835328
  type: 'test'
  ...
# Subtest: DeepSeek-only moderation contract (offline)
    # Subtest: uses the official endpoint, current model, JSON mode, no tools and a bounded timeout, sending the post as data
    ok 1 - uses the official endpoint, current model, JSON mode, no tools and a bounded timeout, sending the post as data
      ---
      duration_ms: 18.24636
      type: 'test'
      ...
    # Subtest: a valid verdict, including a hold for verification, comes back intact
    ok 2 - a valid verdict, including a hold for verification, comes back intact
      ---
      duration_ms: 1.023968
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: null
    ok 3 - malformed verdict holds publication: null
      ---
      duration_ms: 0.664295
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: missing actionable fix
    ok 4 - malformed verdict holds publication: missing actionable fix
      ---
      duration_ms: 0.435608
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: empty revision fix
    ok 5 - malformed verdict holds publication: empty revision fix
      ---
      duration_ms: 2.213355
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: unknown enum
    ok 6 - malformed verdict holds publication: unknown enum
      ---
      duration_ms: 0.427303
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: empty reason
    ok 7 - malformed verdict holds publication: empty reason
      ---
      duration_ms: 0.319288
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: overlong reason
    ok 8 - malformed verdict holds publication: overlong reason
      ---
      duration_ms: 1.041873
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: string verification boolean
    ok 9 - malformed verdict holds publication: string verification boolean
      ---
      duration_ms: 0.695314
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: extra field
    ok 10 - malformed verdict holds publication: extra field
      ---
      duration_ms: 0.675712
      type: 'test'
      ...
    # Subtest: malformed verdict holds publication: unresolved verification cannot ACCEPT
    ok 11 - malformed verdict holds publication: unresolved verification cannot ACCEPT
      ---
      duration_ms: 0.417636
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: empty JSON-mode content
    ok 12 - an incomplete or unexpected completion cannot authorize publication: empty JSON-mode content
      ---
      duration_ms: 0.400314
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: invalid JSON
    ok 13 - an incomplete or unexpected completion cannot authorize publication: invalid JSON
      ---
      duration_ms: 0.298593
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: null content
    ok 14 - an incomplete or unexpected completion cannot authorize publication: null content
      ---
      duration_ms: 0.21171
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: finish_reason length
    ok 15 - an incomplete or unexpected completion cannot authorize publication: finish_reason length
      ---
      duration_ms: 0.17381
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: no finish_reason
    ok 16 - an incomplete or unexpected completion cannot authorize publication: no finish_reason
      ---
      duration_ms: 0.420757
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: no choices
    ok 17 - an incomplete or unexpected completion cannot authorize publication: no choices
      ---
      duration_ms: 0.209592
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: two choices
    ok 18 - an incomplete or unexpected completion cannot authorize publication: two choices
      ---
      duration_ms: 0.191937
      type: 'test'
      ...
    # Subtest: an incomplete or unexpected completion cannot authorize publication: a tool call
    ok 19 - an incomplete or unexpected completion cannot authorize publication: a tool call
      ---
      duration_ms: 0.242632
      type: 'test'
      ...
    # Subtest: HTTP 429 holds without alternate provider or retry
    ok 20 - HTTP 429 holds without alternate provider or retry
      ---
      duration_ms: 0.885462
      type: 'test'
      ...
    # Subtest: HTTP 500 holds without alternate provider or retry
    ok 21 - HTTP 500 holds without alternate provider or retry
      ---
      duration_ms: 0.221315
      type: 'test'
      ...
    # Subtest: network and timeout exceptions hold without publishing exception text
    ok 22 - network and timeout exceptions hold without publishing exception text
      ---
      duration_ms: 0.348581
      type: 'test'
      ...
    1..22
ok 74 - DeepSeek-only moderation contract (offline)
  ---
  duration_ms: 31.50418
  type: 'suite'
  ...
# Subtest: publication paths through the shared gate
    # Subtest: math typed as Unicode is returned for revision before the model is called
    ok 1 - math typed as Unicode is returned for revision before the model is called
      ---
      duration_ms: 26.967201
      type: 'test'
      ...
    # Subtest: held submission leaves no entries for the daily build to publish: REQUEST_REVISION
    ok 2 - held submission leaves no entries for the daily build to publish: REQUEST_REVISION
      ---
      duration_ms: 72.634731
      type: 'test'
      ...
    # Subtest: held submission leaves no entries for the daily build to publish: REJECT
    ok 3 - held submission leaves no entries for the daily build to publish: REJECT
      ---
      duration_ms: 18.188938
      type: 'test'
      ...
    # Subtest: held submission leaves no entries for the daily build to publish: REVIEW_NEEDED
    ok 4 - held submission leaves no entries for the daily build to publish: REVIEW_NEEDED
      ---
      duration_ms: 26.282095
      type: 'test'
      ...
    # Subtest: held submission leaves no entries for the daily build to publish: provider failure
    ok 5 - held submission leaves no entries for the daily build to publish: provider failure
      ---
      duration_ms: 16.587904
      type: 'test'
      ...
    # Subtest: held submission leaves no entries for the daily build to publish: malformed injected moderator
    ok 6 - held submission leaves no entries for the daily build to publish: malformed injected moderator
      ---
      duration_ms: 17.848
      type: 'test'
      ...
    # Subtest: a new arXiv object is accepted from resolved metadata without already being indexed
    ok 7 - a new arXiv object is accepted from resolved metadata without already being indexed
      ---
      duration_ms: 34.620566
      type: 'test'
      ...
    # Subtest: a repository matched to a newly indexed APP object returns the canonical race winner
    ok 8 - a repository matched to a newly indexed APP object returns the canonical race winner
      ---
      duration_ms: 16.226407
      type: 'test'
      ...
    # Subtest: rejected submission and discussion fixtures never issue a public-table write, even transiently
    ok 9 - rejected submission and discussion fixtures never issue a public-table write, even transiently
      ---
      duration_ms: 54.073855
      type: 'test'
      ...
    # Subtest: question/title never becomes public before acceptance: REQUEST_REVISION
    ok 10 - question/title never becomes public before acceptance: REQUEST_REVISION
      ---
      duration_ms: 10.873703
      type: 'test'
      ...
    # Subtest: question/title never becomes public before acceptance: REJECT
    ok 11 - question/title never becomes public before acceptance: REJECT
      ---
      duration_ms: 7.096596
      type: 'test'
      ...
    # Subtest: question/title never becomes public before acceptance: REVIEW_NEEDED
    ok 12 - question/title never becomes public before acceptance: REVIEW_NEEDED
      ---
      duration_ms: 7.670007
      type: 'test'
      ...
    # Subtest: question/title never becomes public before acceptance: provider failure
    ok 13 - question/title never becomes public before acceptance: provider failure
      ---
      duration_ms: 14.444533
      type: 'test'
      ...
    # Subtest: question/title never becomes public before acceptance: malformed injected moderator
    ok 14 - question/title never becomes public before acceptance: malformed injected moderator
      ---
      duration_ms: 8.834563
      type: 'test'
      ...
    # Subtest: answers and replies carry the question and exact parent; record reviews carry source context
    ok 15 - answers and replies carry the question and exact parent; record reviews carry source context
      ---
      duration_ms: 50.006204
      type: 'test'
      ...
    # Subtest: all held verdicts and failures stop answers, comments and reviews
    ok 16 - all held verdicts and failures stop answers, comments and reviews
      ---
      duration_ms: 140.871442
      type: 'test'
      ...
    # Subtest: vote-note moderation precedes creating or replacing any vote
    ok 17 - vote-note moderation precedes creating or replacing any vote
      ---
      duration_ms: 42.278397
      type: 'test'
      ...
    # Subtest: unresolved citation cannot publish even with a scripted ACCEPT: arxiv:2999.99999
    ok 18 - unresolved citation cannot publish even with a scripted ACCEPT: arxiv:2999.99999
      ---
      duration_ms: 7.978892
      type: 'test'
      ...
    # Subtest: unresolved citation cannot publish even with a scripted ACCEPT: arxiv/2999.99999
    ok 19 - unresolved citation cannot publish even with a scripted ACCEPT: arxiv/2999.99999
      ---
      duration_ms: 7.960669
      type: 'test'
      ...
    # Subtest: unresolved citation cannot publish even with a scripted ACCEPT: https://unresolved.example.org/unindexed-record
    ok 20 - unresolved citation cannot publish even with a scripted ACCEPT: https://unresolved.example.org/unindexed-record
      ---
      duration_ms: 11.586543
      type: 'test'
      ...
    # Subtest: unresolved citation cannot publish even with a scripted ACCEPT: HTTPS://unresolved.example.org/unindexed-record
    ok 21 - unresolved citation cannot publish even with a scripted ACCEPT: HTTPS://unresolved.example.org/unindexed-record
      ---
      duration_ms: 11.080753
      type: 'test'
      ...
    # Subtest: unresolved citation cannot publish even with a scripted ACCEPT: ARXIV/2999.99999
    ok 22 - unresolved citation cannot publish even with a scripted ACCEPT: ARXIV/2999.99999
      ---
      duration_ms: 6.004338
      type: 'test'
      ...
    # Subtest: indexed citation sends server identity metadata without asserting proof verification
    ok 23 - indexed citation sends server identity metadata without asserting proof verification
      ---
      duration_ms: 9.906538
      type: 'test'
      ...
    # Subtest: server citation evidence cannot expand the actual provider input beyond its bound
    ok 24 - server citation evidence cannot expand the actual provider input beyond its bound
      ---
      duration_ms: 30.190989
      type: 'test'
      ...
    # Subtest: two concurrent attempts after 29 reservations invoke at most one model and retain exactly 30 counted attempts
    ok 25 - two concurrent attempts after 29 reservations invoke at most one model and retain exactly 30 counted attempts
      ---
      duration_ms: 14.797023
      type: 'test'
      ...
    # Subtest: a provider exception consumes its reserved attempt and records a hold
    ok 26 - a provider exception consumes its reserved attempt and records a hold
      ---
      duration_ms: 5.029385
      type: 'test'
      ...
    # Subtest: a database adapter without transaction support holds without a model call
    ok 27 - a database adapter without transaction support holds without a model call
      ---
      duration_ms: 0.279863
      type: 'test'
      ...
    # Subtest: audit retains decision and identity without the rejected body
    ok 28 - audit retains decision and identity without the rejected body
      ---
      duration_ms: 1.707746
      type: 'test'
      ...
    # Subtest: development without credentials holds submissions, questions, comments and vote notes
    ok 29 - development without credentials holds submissions, questions, comments and vote notes
      ---
      duration_ms: 37.45013
      type: 'test'
      ...
    # Subtest: authenticated REST writes still hold on DeepSeek nonacceptance across every prose path
    ok 30 - authenticated REST writes still hold on DeepSeek nonacceptance across every prose path
      ---
      duration_ms: 182.611096
      type: 'test'
      ...
    # Subtest: REST unauthorized, invalid and revoked callers cannot write or invoke the model
    ok 31 - REST unauthorized, invalid and revoked callers cannot write or invoke the model
      ---
      duration_ms: 35.308585
      type: 'test'
      ...
    1..31
ok 75 - publication paths through the shared gate
  ---
  duration_ms: 3041.523086
  type: 'suite'
  ...
# Subtest: cookie actions require the trusted site/deployment Origin; Bearer API may omit it
ok 76 - cookie actions require the trusted site/deployment Origin; Bearer API may omit it
  ---
  duration_ms: 2.034682
  type: 'test'
  ...
# Subtest: a missing record or an unavailable attempt ledger prevents every retrieval
ok 77 - a missing record or an unavailable attempt ledger prevents every retrieval
  ---
  duration_ms: 2153.45671
  type: 'test'
  ...
# Subtest: preflight reserves one attempt per five-URL batch; later explicit checks are fresh
ok 78 - preflight reserves one attempt per five-URL batch; later explicit checks are fresh
  ---
  duration_ms: 20.25355
  type: 'test'
  ...
# Subtest: owner-wide atomic limits include agents and stop retrieval before network activity
ok 79 - owner-wide atomic limits include agents and stop retrieval before network activity
  ---
  duration_ms: 39.80018
  type: 'test'
  ...
# Subtest: an observed failure or identity mismatch cannot become successful source evidence
ok 80 - an observed failure or identity mismatch cannot become successful source evidence
  ---
  duration_ms: 24.781578
  type: 'test'
  ...
# Subtest: five-URL preflight limit is separate from twelve-reference explicit posting limit
ok 81 - five-URL preflight limit is separate from twelve-reference explicit posting limit
  ---
  duration_ms: 1.896293
  type: 'test'
  ...
# Subtest: aggregate deadline holds slow retrievals and never auto retries
ok 82 - aggregate deadline holds slow retrievals and never auto retries
  ---
  duration_ms: 10.838932
  type: 'test'
  ...
# Subtest: canonical adapters generate fixed requests and discard only recognized share parameters
ok 83 - canonical adapters generate fixed requests and discard only recognized share parameters
  ---
  duration_ms: 15.317106
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: non-HTTPS
ok 84 - unsupported input is rejected before transport: non-HTTPS
  ---
  duration_ms: 0.497149
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: PDF file
ok 85 - unsupported input is rejected before transport: PDF file
  ---
  duration_ms: 0.351138
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: double-encoded path syntax
ok 86 - unsupported input is rejected before transport: double-encoded path syntax
  ---
  duration_ms: 0.12457
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: unsupported host
ok 87 - unsupported input is rejected before transport: unsupported host
  ---
  duration_ms: 0.144013
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: IP literal
ok 88 - unsupported input is rejected before transport: IP literal
  ---
  duration_ms: 0.107324
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: URL credentials
ok 89 - unsupported input is rejected before transport: URL credentials
  ---
  duration_ms: 0.082576
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: nondefault port
ok 90 - unsupported input is rejected before transport: nondefault port
  ---
  duration_ms: 0.089567
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: capability query
ok 91 - unsupported input is rejected before transport: capability query
  ---
  duration_ms: 0.373979
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: unknown share parameter
ok 92 - unsupported input is rejected before transport: unknown share parameter
  ---
  duration_ms: 0.501689
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: encoded path separator
ok 93 - unsupported input is rejected before transport: encoded path separator
  ---
  duration_ms: 0.150958
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: encoded traversal
ok 94 - unsupported input is rejected before transport: encoded traversal
  ---
  duration_ms: 0.063346
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: literal traversal
ok 95 - unsupported input is rejected before transport: literal traversal
  ---
  duration_ms: 0.049132
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: fragment
ok 96 - unsupported input is rejected before transport: fragment
  ---
  duration_ms: 0.066202
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: ambiguous path
ok 97 - unsupported input is rejected before transport: ambiguous path
  ---
  duration_ms: 0.066247
  type: 'test'
  ...
# Subtest: unsupported input is rejected before transport: GitHub path deeper than eight segments
ok 98 - unsupported input is rejected before transport: GitHub path deeper than eight segments
  ---
  duration_ms: 0.083046
  type: 'test'
  ...
# Subtest: public IPv4 validation rejects private and special-use address ranges
ok 99 - public IPv4 validation rejects private and special-use address ranges
  ---
  duration_ms: 0.346174
  type: 'test'
  ...
# Subtest: the actual HTTPS connector receives a validated pinned lookup, TLS hostname and no ambient credentials
ok 100 - the actual HTTPS connector receives a validated pinned lookup, TLS hostname and no ambient credentials
  ---
  duration_ms: 2.444636
  type: 'test'
  ...
# Subtest: nonpublic DNS answers never reach a socket: 1 answer(s)
ok 101 - nonpublic DNS answers never reach a socket: 1 answer(s)
  ---
  duration_ms: 0.404997
  type: 'test'
  ...
# Subtest: nonpublic DNS answers never reach a socket: 2 answer(s)
ok 102 - nonpublic DNS answers never reach a socket: 2 answer(s)
  ---
  duration_ms: 0.215732
  type: 'test'
  ...
# Subtest: nonpublic DNS answers never reach a socket: 0 answer(s)
ok 103 - nonpublic DNS answers never reach a socket: 0 answer(s)
  ---
  duration_ms: 0.371493
  type: 'test'
  ...
# Subtest: nonpublic DNS answers never reach a socket: 1 answer(s)
ok 104 - nonpublic DNS answers never reach a socket: 1 answer(s)
  ---
  duration_ms: 0.179972
  type: 'test'
  ...
# Subtest: a changed requestUrl cannot expand the adapter request allowlist
ok 105 - a changed requestUrl cannot expand the adapter request allowlist
  ---
  duration_ms: 0.197576
  type: 'test'
  ...
# Subtest: Google provider redirects are re-resolved and pinned while opaque Location queries remain internal
ok 106 - Google provider redirects are re-resolved and pinned while opaque Location queries remain internal
  ---
  duration_ms: 0.878648
  type: 'test'
  ...
# Subtest: out-of-family redirects and redirect DNS changes are held before another connection
ok 107 - out-of-family redirects and redirect DNS changes are held before another connection
  ---
  duration_ms: 2.444464
  type: 'test'
  ...
# Subtest: redirect count and streamed byte bounds fail closed
ok 108 - redirect count and streamed byte bounds fail closed
  ---
  duration_ms: 0.951526
  type: 'test'
  ...
# Subtest: one absolute deadline includes DNS, headers and a stalled response stream
ok 109 - one absolute deadline includes DNS, headers and a stalled response stream
  ---
  duration_ms: 41.62582
  type: 'test'
  ...
# Subtest: GitHub binds requested ref to commit, exact tree modes, path and verified UTF-8 blob
ok 110 - GitHub binds requested ref to commit, exact tree modes, path and verified UTF-8 blob
  ---
  duration_ms: 2.348581
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: wrong commit identity
ok 111 - GitHub holds without a complete object-mode binding: wrong commit identity
  ---
  duration_ms: 6.045397
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: truncated root tree
ok 112 - GitHub holds without a complete object-mode binding: truncated root tree
  ---
  duration_ms: 0.338727
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: missing exact path
ok 113 - GitHub holds without a complete object-mode binding: missing exact path
  ---
  duration_ms: 0.538841
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: nonregular leaf mode
ok 114 - GitHub holds without a complete object-mode binding: nonregular leaf mode
  ---
  duration_ms: 0.283183
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: submodule mode
ok 115 - GitHub holds without a complete object-mode binding: submodule mode
  ---
  duration_ms: 0.307721
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: wrong tree identity
ok 116 - GitHub holds without a complete object-mode binding: wrong tree identity
  ---
  duration_ms: 0.209307
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: wrong blob digest
ok 117 - GitHub holds without a complete object-mode binding: wrong blob digest
  ---
  duration_ms: 0.254974
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: invalid Base64
ok 118 - GitHub holds without a complete object-mode binding: invalid Base64
  ---
  duration_ms: 0.351132
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: wrong encoding
ok 119 - GitHub holds without a complete object-mode binding: wrong encoding
  ---
  duration_ms: 0.234381
  type: 'test'
  ...
# Subtest: GitHub holds without a complete object-mode binding: wrong declared size
ok 120 - GitHub holds without a complete object-mode binding: wrong declared size
  ---
  duration_ms: 0.207217
  type: 'test'
  ...
# Subtest: Google Docs accepts bounded plain UTF-8 only and access walls remain holds
ok 121 - Google Docs accepts bounded plain UTF-8 only and access walls remain holds
  ---
  duration_ms: 0.693366
  type: 'test'
  ...
# Subtest: Drive collections never certify unseen children when no stable public listing contract is available
ok 122 - Drive collections never certify unseen children when no stable public listing contract is available
  ---
  duration_ms: 0.135931
  type: 'test'
  ...
# Subtest: X oEmbed binds the returned author and exact post anchor, without requiring a top-level url
ok 123 - X oEmbed binds the returned author and exact post anchor, without requiring a top-level url
  ---
  duration_ms: 2.276313
  type: 'test'
  ...
# Subtest: HTTP 404 is a precise retrieval result, never a scientific truth judgment
ok 124 - HTTP 404 is a precise retrieval result, never a scientific truth judgment
  ---
  duration_ms: 0.372331
  type: 'test'
  ...
# Subtest: HTTP 410 is a precise retrieval result, never a scientific truth judgment
ok 125 - HTTP 410 is a precise retrieval result, never a scientific truth judgment
  ---
  duration_ms: 0.192572
  type: 'test'
  ...
# Subtest: HTTP 403 is a precise retrieval result, never a scientific truth judgment
ok 126 - HTTP 403 is a precise retrieval result, never a scientific truth judgment
  ---
  duration_ms: 0.124953
  type: 'test'
  ...
# Subtest: a DNS lookup finishing after the whole deadline cannot start HTTP
ok 127 - a DNS lookup finishing after the whole deadline cannot start HTTP
  ---
  duration_ms: 19.628256
  type: 'test'
  ...
# Subtest: compression and oversized declared bodies are rejected before consuming a stream
ok 128 - compression and oversized declared bodies are rejected before consuming a stream
  ---
  duration_ms: 0.915719
  type: 'test'
  ...
# Subtest: caller deadline bounds the whole source check and expired callers start no transport
ok 129 - caller deadline bounds the whole source check and expired callers start no transport
  ---
  duration_ms: 10.201187
  type: 'test'
  ...
# Subtest: regular executable blobs are supported, but a non-tree ancestor is not traversed
ok 130 - regular executable blobs are supported, but a non-tree ancestor is not traversed
  ---
  duration_ms: 0.709174
  type: 'test'
  ...
# Subtest: GitHub does not follow even an in-family object redirect
ok 131 - GitHub does not follow even an in-family object redirect
  ---
  duration_ms: 0.354398
  type: 'test'
  ...
# Subtest: the total Git object budget is shared across every bounded metadata response
ok 132 - the total Git object budget is shared across every bounded metadata response
  ---
  duration_ms: 11.068724
  type: 'test'
  ...
# Subtest: all Git calls share a caller deadline, including a stalled later metadata request
ok 133 - all Git calls share a caller deadline, including a stalled later metadata request
  ---
  duration_ms: 10.62958
  type: 'test'
  ...
# Subtest: error HTTP status is reported without reading or retaining its response body
ok 134 - error HTTP status is reported without reading or retaining its response body
  ---
  duration_ms: 0.701808
  type: 'test'
  ...
# Subtest: X excerpts and reported author text respect UTF-16 field bounds without splitting Unicode points
ok 135 - X excerpts and reported author text respect UTF-16 field bounds without splitting Unicode points
  ---
  duration_ms: 1.010568
  type: 'test'
  ...
# Subtest: branch references remain canonicalizable for historical lookup but cause no automatic HTTP request
ok 136 - branch references remain canonicalizable for historical lookup but cause no automatic HTTP request
  ---
  duration_ms: 0.248774
  type: 'test'
  ...
# Subtest: deadline checks at phase boundaries stop already-resolved DNS or byte-free streams
ok 137 - deadline checks at phase boundaries stop already-resolved DNS or byte-free streams
  ---
  duration_ms: 0.694411
  type: 'test'
  ...
# Subtest: web intake preserves DNS, redirect, secret and response-size guards
ok 138 - web intake preserves DNS, redirect, secret and response-size guards
  ---
  duration_ms: 3.054183
  type: 'test'
  ...
# Subtest: preflight never publishes and cannot clear a later post without explicit fresh retrieval
ok 139 - preflight never publishes and cannot clear a later post without explicit fresh retrieval
  ---
  duration_ms: 2167.948931
  type: 'test'
  ...
# Subtest: vote notes use the same fresh source and moderation gates before replacing a public vote
ok 140 - vote notes use the same fresh source and moderation gates before replacing a public vote
  ---
  duration_ms: 1168.454043
  type: 'test'
  ...
# Subtest: actual preflight API authenticates Bearer only, checks Origin, rejects supplied verification and returns closed errors
ok 141 - actual preflight API authenticates Bearer only, checks Origin, rejects supplied verification and returns closed errors
  ---
  duration_ms: 1415.417399
  type: 'test'
  ...
# Subtest: operator-reviewed snapshots are record-scoped historical data and never replace an explicit current failure
ok 142 - operator-reviewed snapshots are record-scoped historical data and never replace an explicit current failure
  ---
  duration_ms: 1263.151723
  type: 'test'
  ...
# Subtest: fresh comment/review and vote-note APIs reject a foreign Origin before reserving or fetching
ok 143 - fresh comment/review and vote-note APIs reject a foreign Origin before reserving or fetching
  ---
  duration_ms: 1031.609859
  type: 'test'
  ...
# Subtest: unresolved URL feedback stores only safe source labels, without copying caller query parameters
ok 144 - unresolved URL feedback stores only safe source labels, without copying caller query parameters
  ---
  duration_ms: 947.0719
  type: 'test'
  ...
# Subtest: source-fetched agent keys cannot be transmitted to the moderator or enter durable/public records
ok 145 - source-fetched agent keys cannot be transmitted to the moderator or enter durable/public records
  ---
  duration_ms: 2176.197794
  type: 'test'
  ...
# Subtest: two accepted submissions competing for the twentieth daily link cannot exceed the public limit
ok 146 - two accepted submissions competing for the twentieth daily link cannot exceed the public limit
  ---
  duration_ms: 67.69489
  type: 'test'
  ...
# Subtest: page numbers show the ends and the pages around this one, and skip the rest
ok 147 - page numbers show the ends and the pages around this one, and skip the rest
  ---
  duration_ms: 1.449307
  type: 'test'
  ...
# Subtest: a page parameter that is not a page number reads as the first page
ok 148 - a page parameter that is not a page number reads as the first page
  ---
  duration_ms: 0.290331
  type: 'test'
  ...
# Subtest: page links keep the non-empty parameters and name every page after the first
ok 149 - page links keep the non-empty parameters and name every page after the first
  ---
  duration_ms: 0.267207
  type: 'test'
  ...
# Subtest: the pager links every page and marks this one; one page needs none
ok 150 - the pager links every page and marks this one; one page needs none
  ---
  duration_ms: 20.153732
  type: 'test'
  ...
# Subtest: a page number and the cursor before it start at the same place; the reply says where it is
ok 151 - a page number and the cursor before it start at the same place; the reply says where it is
  ---
  duration_ms: 1.912592
  type: 'test'
  ...
# Subtest: private post drafts
    # Subtest: keeps each author’s draft for each form, topic and parent separate
    ok 1 - keeps each author’s draft for each form, topic and parent separate
      ---
      duration_ms: 2.355654
      type: 'test'
      ...
    # Subtest: does not migrate a guest draft without an explicit login marker
    ok 2 - does not migrate a guest draft without an explicit login marker
      ---
      duration_ms: 0.218666
      type: 'test'
      ...
    # Subtest: migrates only the form whose guest author intentionally starts login
    ok 3 - migrates only the form whose guest author intentionally starts login
      ---
      duration_ms: 0.22915
      type: 'test'
      ...
    # Subtest: prefers an existing owner draft and offers the explicitly carried guest draft separately
    ok 4 - prefers an existing owner draft and offers the explicitly carried guest draft separately
      ---
      duration_ms: 0.246528
      type: 'test'
      ...
    # Subtest: a guest draft offered to one account can be neither adopted nor restored by another
    ok 5 - a guest draft offered to one account can be neither adopted nor restored by another
      ---
      duration_ms: 0.404591
      type: 'test'
      ...
    # Subtest: a signed-in author’s login marker never transfers a draft to another account
    ok 6 - a signed-in author’s login marker never transfers a draft to another account
      ---
      duration_ms: 0.170346
      type: 'test'
      ...
    # Subtest: adopting an alternate without login intent is refused and leaves stored drafts unchanged
    ok 7 - adopting an alternate without login intent is refused and leaves stored drafts unchanged
      ---
      duration_ms: 0.210072
      type: 'test'
      ...
    # Subtest: expired or future guest-login markers do not authorize migration
    ok 8 - expired or future guest-login markers do not authorize migration
      ---
      duration_ms: 3.22327
      type: 'test'
      ...
    # Subtest: clearing after a confirmed post, or saving an emptied form, removes only that owner’s form
    ok 9 - clearing after a confirmed post, or saving an emptied form, removes only that owner’s form
      ---
      duration_ms: 0.43262
      type: 'test'
      ...
    # Subtest: malformed, outdated, oversized, or secret-bearing stored drafts are not restored
    ok 10 - malformed, outdated, oversized, or secret-bearing stored drafts are not restored
      ---
      duration_ms: 0.673606
      type: 'test'
      ...
    # Subtest: malformed login metadata cannot authorize guest migration
    ok 11 - malformed login metadata cannot authorize guest migration
      ---
      duration_ms: 0.280591
      type: 'test'
      ...
    # Subtest: blocked storage never throws or prevents an in-memory composer from working
    ok 12 - blocked storage never throws or prevents an in-memory composer from working
      ---
      duration_ms: 0.311111
      type: 'test'
      ...
    # Subtest: quota failure does not destroy a prior saved owner draft
    ok 13 - quota failure does not destroy a prior saved owner draft
      ---
      duration_ms: 0.133376
      type: 'test'
      ...
    # Subtest: a readable explicit guest draft is restored in memory when migration cannot persist
    ok 14 - a readable explicit guest draft is restored in memory when migration cannot persist
      ---
      duration_ms: 0.108532
      type: 'test'
      ...
    # Subtest: never persists an oik-shaped value in title or body and discards its stale saved draft
    ok 15 - never persists an oik-shaped value in title or body and discards its stale saved draft
      ---
      duration_ms: 0.201282
      type: 'test'
      ...
    1..15
ok 152 - private post drafts
  ---
  duration_ms: 10.745245
  type: 'suite'
  ...
# Subtest: edit drafts retain the base revision, isolate owners and post IDs, and clear only the selected draft
ok 153 - edit drafts retain the base revision, isolate owners and post IDs, and clear only the selected draft
  ---
  duration_ms: 1.690002
  type: 'test'
  ...
# Subtest: an edit draft holding an agent key is dropped, and broken storage never throws
ok 154 - an edit draft holding an agent key is dropped, and broken storage never throws
  ---
  duration_ms: 0.353662
  type: 'test'
  ...
# Subtest: the person and any of their agents edit the person's posts, whichever agent made them, without changing attribution or metadata
ok 155 - the person and any of their agents edit the person's posts, whichever agent made them, without changing attribution or metadata
  ---
  duration_ms: 2084.423505
  type: 'test'
  ...
# Subtest: ownership boundaries precede moderation, even for no-op retries
ok 156 - ownership boundaries precede moderation, even for no-op retries
  ---
  duration_ms: 43.412919
  type: 'test'
  ...
# Subtest: invalid and missing targets cannot be used as an IDOR
ok 157 - invalid and missing targets cannot be used as an IDOR
  ---
  duration_ms: 10.884215
  type: 'test'
  ...
# Subtest: rejection and provider failure preserve body and mentions
ok 158 - rejection and provider failure preserve body and mentions
  ---
  duration_ms: 59.1597
  type: 'test'
  ...
# Subtest: accepted edits replace mentions atomically and refresh generated search text
ok 159 - accepted edits replace mentions atomically and refresh generated search text
  ---
  duration_ms: 49.208194
  type: 'test'
  ...
# Subtest: stale revisions are refused before moderation, including change-away-and-back saves
ok 160 - stale revisions are refused before moderation, including change-away-and-back saves
  ---
  duration_ms: 35.23743
  type: 'test'
  ...
# Subtest: a competing save during moderation wins without being overwritten
ok 161 - a competing save during moderation wins without being overwritten
  ---
  duration_ms: 29.571583
  type: 'test'
  ...
# Subtest: parallel saves have one winner; identical retries do not moderate or mutate again
ok 162 - parallel saves have one winner; identical retries do not moderate or mutate again
  ---
  duration_ms: 83.281355
  type: 'test'
  ...
# Subtest: mention failure rolls back the body; nontransactional adapters fail closed
ok 163 - mention failure rolls back the body; nontransactional adapters fail closed
  ---
  duration_ms: 75.53645
  type: 'test'
  ...
# Subtest: question, answer, reply and review edits preserve kind, context, votes and acceptance
ok 164 - question, answer, reply and review edits preserve kind, context, votes and acceptance
  ---
  duration_ms: 201.68896
  type: 'test'
  ...
# Subtest: PATCH binds credential identity and rejects spoofing, immutable fields and stale saves
ok 165 - PATCH binds credential identity and rejects spoofing, immutable fields and stale saves
  ---
  duration_ms: 224.306696
  type: 'test'
  ...
# Subtest: an unexpected posting error gives generic feedback and hides the error text
ok 166 - an unexpected posting error gives generic feedback and hides the error text
  ---
  duration_ms: 1.543462
  type: 'test'
  ...
# Subtest: refusal/service failure expose reason+fix and create no public rows; revision then acceptance is retry-safe
ok 167 - refusal/service failure expose reason+fix and create no public rows; revision then acceptance is retry-safe
  ---
  duration_ms: 2133.443778
  type: 'test'
  ...
# Subtest: actual forum API distinguishes 422 refusal from 503 unavailable and preserves its documented error shape
ok 168 - actual forum API distinguishes 422 refusal from 503 unavailable and preserves its documented error shape
  ---
  duration_ms: 1367.410182
  type: 'test'
  ...
# Subtest: ordinary hold feedback is one concise actionable explanation, without verification machinery
ok 169 - ordinary hold feedback is one concise actionable explanation, without verification machinery
  ---
  duration_ms: 0.557603
  type: 'test'
  ...
# Subtest: MathJax renders inline/display dollar and backslash delimiters, including aligned equations
ok 170 - MathJax renders inline/display dollar and backslash delimiters, including aligned equations
  ---
  duration_ms: 123.2353
  type: 'test'
  ...
# Subtest: backslash normalization leaves code, escaped delimiters and URL destinations literal
ok 171 - backslash normalization leaves code, escaped delimiters and URL destinations literal
  ---
  duration_ms: 37.082228
  type: 'test'
  ...
# Subtest: backslash math preserves embedded TeX dollars and list/blockquote containers
ok 172 - backslash math preserves embedded TeX dollars and list/blockquote containers
  ---
  duration_ms: 37.575103
  type: 'test'
  ...
# Subtest: raw HTML and javascript: links are dropped, and images become links so no external asset is fetched
ok 173 - raw HTML and javascript: links are dropped, and images become links so no external asset is fetched
  ---
  duration_ms: 10.532034
  type: 'test'
  ...
# Subtest: malformed Markdown/TeX remain bounded and preserve surrounding prose
ok 174 - malformed Markdown/TeX remain bounded and preserve surrounding prose
  ---
  duration_ms: 32.843519
  type: 'test'
  ...
# Subtest: equation tags and references cannot collide or resolve into a different post
ok 175 - equation tags and references cannot collide or resolve into a different post
  ---
  duration_ms: 54.830137
  type: 'test'
  ...
# Subtest: the daily prompt only casts create-only upvotes with no note
ok 176 - the daily prompt only casts create-only upvotes with no note
  ---
  duration_ms: 0.952771
  type: 'test'
  ...
# Subtest: the templates use real search parameters and never print the key
ok 177 - the templates use real search parameters and never print the key
  ---
  duration_ms: 0.223285
  type: 'test'
  ...
# Subtest: the ingestion time matches the daily workflow
ok 178 - the ingestion time matches the daily workflow
  ---
  duration_ms: 0.411059
  type: 'test'
  ...
# Subtest: the quick start fills in answers and falls back for empty ones
ok 179 - the quick start fills in answers and falls back for empty ones
  ---
  duration_ms: 0.226213
  type: 'test'
  ...
# Subtest: create-only preserves every existing human/bot vote field, including emoji-only choices
ok 180 - create-only preserves every existing human/bot vote field, including emoji-only choices
  ---
  duration_ms: 1953.677935
  type: 'test'
  ...
# Subtest: new create-only votes report creation and retain the authenticated bot attribution
ok 181 - new create-only votes report creation and retain the authenticated bot attribution
  ---
  duration_ms: 20.133731
  type: 'test'
  ...
# Subtest: another owner keeps an independent vote on the same record
ok 182 - another owner keeps an independent vote on the same record
  ---
  duration_ms: 18.195469
  type: 'test'
  ...
# Subtest: an uncertain successful insert is safe to retry without changing timestamp or metadata
ok 183 - an uncertain successful insert is safe to retry without changing timestamp or metadata
  ---
  duration_ms: 16.260563
  type: 'test'
  ...
# Subtest: competing bot requests give one owner one vote and never replace the winning attribution
ok 184 - competing bot requests give one owner one vote and never replace the winning attribution
  ---
  duration_ms: 21.7493
  type: 'test'
  ...
# Subtest: a human choice inserted between bot validation and insert is preserved atomically
ok 185 - a human choice inserted between bot validation and insert is preserved atomically
  ---
  duration_ms: 33.652673
  type: 'test'
  ...
# Subtest: omitted and false flags preserve normal human-edit defaults and the original response shape
ok 186 - omitted and false flags preserve normal human-edit defaults and the original response shape
  ---
  duration_ms: 53.344338
  type: 'test'
  ...
# Subtest: invalid create-only flags fail before any database call
ok 187 - invalid create-only flags fail before any database call
  ---
  duration_ms: 0.656656
  type: 'test'
  ...
# Subtest: create-only does not bypass missing-record, self-vote or note-moderation guards
ok 188 - create-only does not bypass missing-record, self-vote or note-moderation guards
  ---
  duration_ms: 24.075768
  type: 'test'
  ...
# Subtest: database insert failure is not falsely acknowledged as an existing vote
ok 189 - database insert failure is not falsely acknowledged as an existing vote
  ---
  duration_ms: 9.989874
  type: 'test'
  ...
# Subtest: actual vote API validates the flag, authenticates ownership and needs no provider for note-free calls
ok 190 - actual vote API validates the flag, authenticates ownership and needs no provider for note-free calls
  ---
  duration_ms: 212.970838
  type: 'test'
  ...
# Subtest: reading a link
    # Subtest: ids match the harvester (sources.py)
    ok 1 - ids match the harvester (sources.py)
      ---
      duration_ms: 7.558691
      type: 'test'
      ...
    # Subtest: metadata comes from the source
    ok 2 - metadata comes from the source
      ---
      duration_ms: 134.053861
      type: 'test'
      ...
    1..2
ok 191 - reading a link
  ---
  duration_ms: 142.578383
  type: 'suite'
  ...
# Subtest: submitting and the forum, on Postgres
    # Subtest: a link the site reads is listed at once, with its metadata
    ok 1 - a link the site reads is listed at once, with its metadata
      ---
      duration_ms: 93.979974
      type: 'test'
      ...
    # Subtest: a public blog uses the existing moderation gate and one attempt, including failed checks
    ok 2 - a public blog uses the existing moderation gate and one attempt, including failed checks
      ---
      duration_ms: 33.515771
      type: 'test'
      ...
    # Subtest: thirty failed source requests exhaust the shared budget before any further fetch or model call
    ok 3 - thirty failed source requests exhaust the shared budget before any further fetch or model call
      ---
      duration_ms: 218.021735
      type: 'test'
      ...
    # Subtest: a record already listed is found by id, URL or repository, without reading the source
    ok 4 - a record already listed is found by id, URL or repository, without reading the source
      ---
      duration_ms: 4.060698
      type: 'test'
      ...
    # Subtest: links the site cannot read, blocked venues and missing records are refused; 20 a day
    ok 5 - links the site cannot read, blocked venues and missing records are refused; 20 a day
      ---
      duration_ms: 9.096283
      type: 'test'
      ...
    # Subtest: a record labelled harmful is not listed again by submitting it
    ok 6 - a record labelled harmful is not listed again by submitting it
      ---
      duration_ms: 3.195635
      type: 'test'
      ...
    # Subtest: questions, answers and comments; mentions of records; latest activity
    ok 7 - questions, answers and comments; mentions of records; latest activity
      ---
      duration_ms: 70.44583
      type: 'test'
      ...
    # Subtest: answers are voted on and sorted by score; the asker accepts one, and it goes first
    ok 8 - answers are voted on and sorted by score; the asker accepts one, and it goes first
      ---
      duration_ms: 46.012834
      type: 'test'
      ...
    # Subtest: moderation: a refusal tells the author the reason
    ok 9 - moderation: a refusal tells the author the reason
      ---
      duration_ms: 3.335014
      type: 'test'
      ...
    # Subtest: search, pages, and a feed of what is new
    ok 10 - search, pages, and a feed of what is new
      ---
      duration_ms: 99.664343
      type: 'test'
      ...
    # Subtest: a person may post 30 times a day, agents and refused posts included
    ok 11 - a person may post 30 times a day, agents and refused posts included
      ---
      duration_ms: 275.254175
      type: 'test'
      ...
    # Subtest: bad questions and replies are refused, and leave nothing behind
    ok 12 - bad questions and replies are refused, and leave nothing behind
      ---
      duration_ms: 13.740239
      type: 'test'
      ...
    1..12
ok 192 - submitting and the forum, on Postgres
  ---
  duration_ms: 2952.836608
  type: 'suite'
  ...
# Subtest: query syntax
    # Subtest: parses arXiv-style operators
    ok 1 - parses arXiv-style operators
      ---
      duration_ms: 1.88792
      type: 'test'
      ...
    # Subtest: user text is always a parameter
    ok 2 - user text is always a parameter
      ---
      duration_ms: 0.704291
      type: 'test'
      ...
    # Subtest: errors say how to fix the query
    ok 3 - errors say how to fix the query
      ---
      duration_ms: 1.098963
      type: 'test'
      ...
    # Subtest: subjects: codes, divisions and names
    ok 4 - subjects: codes, divisions and names
      ---
      duration_ms: 0.370209
      type: 'test'
      ...
    # Subtest: the docs describe the language as it compiles: every field, flag and sort they name is real
    ok 5 - the docs describe the language as it compiles: every field, flag and sort they name is real
      ---
      duration_ms: 1.091952
      type: 'test'
      ...
    1..5
ok 193 - query syntax
  ---
  duration_ms: 6.196215
  type: 'suite'
  ...
# Subtest: on Postgres
    # Subtest: records are stored as JSON objects
    ok 1 - records are stored as JSON objects
      ---
      duration_ms: 6.017086
      type: 'test'
      ...
    # Subtest: a second load with nothing changed writes nothing
    ok 2 - a second load with nothing changed writes nothing
      ---
      duration_ms: 15.884508
      type: 'test'
      ...
    # Subtest: structured filters match the build exactly
    ok 3 - structured filters match the build exactly
      ---
      duration_ms: 32.227194
      type: 'test'
      ...
    # Subtest: text search finds, ranks and pages
    ok 4 - text search finds, ranks and pages
      ---
      duration_ms: 26.213317
      type: 'test'
      ...
    # Subtest: the sitemap lists every record once, at most 50,000 URLs a file, each with its last change
    ok 5 - the sitemap lists every record once, at most 50,000 URLs a file, each with its last change
      ---
      duration_ms: 9.991864
      type: 'test'
      ...
    # Subtest: votes: up or down, an emoji, a note; one per voter; never on your own repo
    not ok 6 - votes: up or down, an emoji, a note; one per voter; never on your own repo
      ---
      duration_ms: 30.94792
      type: 'test'
      location: '/home/user/open-research-index/site/lib/records/search.test.ts:115:2'
      failureType: 'testCodeFailure'
      error: "Cannot read properties of undefined (reading 'repo')"
      code: 'ERR_TEST_FAILURE'
      name: 'TypeError'
      stack: |-
        TestContext.<anonymous> (file:///home/user/open-research-index/site/lib/records/search.test.ts:128:28)
        async Test.run (node:internal/test_runner/test:1054:7)
        async Suite.processPendingSubtests (node:internal/test_runner/test:744:7)
      ...
    # Subtest: posts and articles about a record count like upvotes and show as discussed
    ok 7 - posts and articles about a record count like upvotes and show as discussed
      ---
      duration_ms: 9.313303
      type: 'test'
      ...
    # Subtest: in day, week and month a post counts on the day it was posted, not the day it was linked
    ok 8 - in day, week and month a post counts on the day it was posted, not the day it was linked
      ---
      duration_ms: 25.191527
      type: 'test'
      ...
    # Subtest: responded: the record with the newest response first, then the ones without
    ok 9 - responded: the record with the newest response first, then the ones without
      ---
      duration_ms: 18.296543
      type: 'test'
      ...
    # Subtest: only responses that confirm, simplify or extend count as upvotes; refutes and questions mark it disputed
    ok 10 - only responses that confirm, simplify or extend count as upvotes; refutes and questions mark it disputed
      ---
      duration_ms: 30.792361
      type: 'test'
      ...
    # Subtest: comments and reviews; mentions count once per voter, never for the record itself
    not ok 11 - comments and reviews; mentions count once per voter, never for the record itself
      ---
      duration_ms: 0.541974
      type: 'test'
      location: '/home/user/open-research-index/site/lib/records/search.test.ts:180:2'
      failureType: 'testCodeFailure'
      error: "Cannot read properties of undefined (reading 'id')"
      code: 'ERR_TEST_FAILURE'
      name: 'TypeError'
      stack: |-
        TestContext.<anonymous> (file:///home/user/open-research-index/site/lib/records/search.test.ts:184:95)
        Test.runInAsyncScope (node:async_hooks:214:14)
        Test.run (node:internal/test_runner/test:1047:25)
        async Suite.processPendingSubtests (node:internal/test_runner/test:744:7)
      ...
    # Subtest: most cited in comments: the records comments name, by how many people, then the newest
    ok 12 - most cited in comments: the records comments name, by how many people, then the newest
      ---
      duration_ms: 53.673085
      type: 'test'
      ...
    # Subtest: agent keys: created once, stored as a hash, revocable
    ok 13 - agent keys: created once, stored as a hash, revocable
      ---
      duration_ms: 13.576214
      type: 'test'
      ...
    # Subtest: device flow: the agent gets its key itself, once, after its person approves
    ok 14 - device flow: the agent gets its key itself, once, after its person approves
      ---
      duration_ms: 17.394091
      type: 'test'
      ...
    # Subtest: top today, this week, this month: votes cast in that time
    ok 15 - top today, this week, this month: votes cast in that time
      ---
      duration_ms: 46.558475
      type: 'test'
      ...
    # Subtest: MCP at /mcp: initialize, list the tools, call each, over Streamable HTTP
    ok 16 - MCP at /mcp: initialize, list the tools, call each, over Streamable HTTP
      ---
      duration_ms: 96.498016
      type: 'test'
      ...
    # Subtest: hybrid ranking puts the nearest embedding first
    ok 17 - hybrid ranking puts the nearest embedding first
      ---
      duration_ms: 13.59887
      type: 'test'
      ...
    1..17
not ok 194 - on Postgres
  ---
  duration_ms: 2617.075187
  type: 'suite'
  location: '/home/user/open-research-index/site/lib/records/search.test.ts:49:1'
  failureType: 'subtestsFailed'
  error: '2 subtests failed'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: sitemap
    # Subtest: no file holds more than 50,000 URLs, with room for the site pages
    ok 1 - no file holds more than 50,000 URLs, with room for the site pages
      ---
      duration_ms: 1.972331
      type: 'test'
      ...
    # Subtest: the index lists each numbered file; a file gives each URL its lastmod, escaped
    ok 2 - the index lists each numbered file; a file gives each URL its lastmod, escaped
      ---
      duration_ms: 4.744402
      type: 'test'
      ...
    1..2
ok 195 - sitemap
  ---
  duration_ms: 12.945183
  type: 'suite'
  ...
# Subtest: a record with a reviewed reception shows it; anything else shows none
ok 196 - a record with a reviewed reception shows it; anything else shows none
  ---
  duration_ms: 1.057416
  type: 'test'
  ...
# Subtest: a source tag links to the index filtered by source, never to the work itself
ok 197 - a source tag links to the index filtered by source, never to the work itself
  ---
  duration_ms: 0.282818
  type: 'test'
  ...
# Subtest: the original is the record url, shown without scheme or www. and with its host; records without a url have none
ok 198 - the original is the record url, shown without scheme or www. and with its host; records without a url have none
  ---
  duration_ms: 0.869639
  type: 'test'
  ...
1..198
# tests 341
# suites 22
# pass 339
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 26529.368704: it needs a
// running site and Playwright (not a dependency here; NODE_PATH=$(npm root -g) finds a global one).
//
//   npm run build && REVIEW_ACCOUNT_LOGIN=demo_reviewer REVIEW_ACCOUNT_PASSWORD=<20+ characters> SITE_URL=http://localhost:3112 npx next start -p 3112
//   BASE=http://localhost:3112 MODE=review REVIEW_ACCOUNT_LOGIN=… REVIEW_ACCOUNT_PASSWORD=… node scripts/mcp-e2e.mjs
//   BASE=http://localhost:3113 MODE=github node scripts/mcp-e2e.mjs     # against next dev, where GitHub sign-in is @local-dev
//
// It casts and removes one vote as the signed-in account and posts nothing that stays (the comment it tries is held
// when no moderation provider is configured; with one, the comment may be published). Against the live site it acts
// publicly as the demo account, so run it there only on purpose.
import { createRequire } from 'node:module';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const B = process.env.BASE, MODE = process.env.MODE; // MODE: review (password demo account) | github (dev stand-in)
const out = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
let failed = 0; const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// The client's loopback callback, on an OS-assigned port, as Codex and Claude Code use.
let gotCallback; const callback = new Promise((r) => { gotCallback = r; });
const server = http.createServer((req, res) => { gotCallback(new URL(req.url, 'http://127.0.0.1')); res.end('You can close this window.'); }).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const redirectUrl = `http://127.0.0.1:${server.address().port}/callback`;

const store = {}; let authorizeUrl;
const provider = {
	get redirectUrl() { return redirectUrl; },
	get clientMetadata() { return { client_name: 'ChatGPT', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
	clientInformation: () => store.client, saveClientInformation: (c) => { store.client = c; },
	tokens: () => store.tokens, saveTokens: (t) => { store.tokens = t; },
	redirectToAuthorization: (u) => { authorizeUrl = u; },
	saveCodeVerifier: (v) => { store.verifier = v; }, codeVerifier: () => store.verifier,
};
const connect = async (authProvider) => { const c = new Client({ name: 'e2e', version: '0' }); const t = new StreamableHTTPClientTransport(new URL(`${B}/mcp`), authProvider ? { authProvider } : {}); await c.connect(t); return { c, t }; };

// 1. Anonymous: connect, list, read, and be asked to sign in for a write.
const anon = await connect();
const tools = (await anon.c.listTools()).tools;
check('anonymous client lists the tools', tools.length === 16, `${tools.length} tools`);
const raw = (await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.json())).result.tools;
check('on the wire every tool has securitySchemes (top level and _meta mirror) and the three hints', raw.every((t) => Array.isArray(t.securitySchemes) && JSON.stringify(t.securitySchemes) === JSON.stringify(t._meta.securitySchemes) && ['readOnlyHint', 'destructiveHint', 'openWorldHint'].every((h) => typeof t.annotations[h] === 'boolean')), `${raw.filter((t) => t.securitySchemes[0].type === 'oauth2').length} need sign-in`);
check('through the SDK client the _meta mirror survives (the SDK drops fields it does not know)', tools.every((t) => Array.isArray(t._meta?.securitySchemes)));
const found = await anon.c.callTool({ name: 'search_records', arguments: { limit: 1 } });
const id = found.structuredContent.results[0].id;
check('anonymous search and read work', !found.isError && (await anon.c.callTool({ name: 'get_record', arguments: { id } })).structuredContent.id === id, id);
const asked = await anon.c.callTool({ name: 'vote_on_record', arguments: { id, value: 1 } });
check('a write without sign-in returns the tool-level challenge', asked.isError && /insufficient_scope/.test(asked._meta?.['mcp/www_authenticate']?.[0] ?? ''), asked._meta?.['mcp/www_authenticate']?.[0]);

// 2. Sign in the way an MCP client does. A mixed server gives no 401 to an anonymous client, so the client starts
// authorization itself once a tool asks (as ChatGPT does on the tool-level challenge).
check('SDK starts authorization (discovery + registration)', await auth(provider, { serverUrl: `${B}/mcp` }) === 'REDIRECT', store.client?.client_id);
check('authorization URL carries PKCE S256 and the resource', authorizeUrl.searchParams.get('code_challenge_method') === 'S256' && authorizeUrl.searchParams.get('resource') === `${B}/mcp`, authorizeUrl.searchParams.get('resource'));

const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto(authorizeUrl.href);
const signedOut = await page.locator('article').innerText();
check('approval page names the app before any sign-in', /ChatGPT is asking to act for you/.test(signedOut));
if (MODE === 'review') {
	await page.getByText('Sign in with the demo account').click();
	await page.fill('input[name=login]', process.env.REVIEW_ACCOUNT_LOGIN); await page.fill('input[name=password]', process.env.REVIEW_ACCOUNT_PASSWORD);
	await page.click('article button:has-text("Sign in")');
} else {
	check('no reviewer link when the demo account is not configured', !/demo account/.test(signedOut));
	await page.locator('article').getByText('Sign in with GitHub').click();
}
await page.waitForURL(/\/oauth\/authorize\?/);
const consent = await page.locator('article').innerText();
const login = consent.match(/comment as @([\w-]+)/)?.[1];
check('consent page shows who, what and where it returns', Boolean(login) && consent.includes(`127.0.0.1:${server.address().port}`), `@${login}`);
await page.click('button:has-text("Approve")');
const back = await callback;
check('redirect back carries code, state and iss', back.searchParams.has('code') && back.searchParams.get('iss') === B && back.searchParams.get('state') === authorizeUrl.searchParams.get('state'));
check('SDK exchanges the code', await auth(provider, { serverUrl: `${B}/mcp`, authorizationCode: back.searchParams.get('code') }) === 'AUTHORIZED', `expires_in ${store.tokens?.expires_in}`);

// 3. Signed in: act, and see it on the site.
const me = await connect(provider);
const who = (await me.c.callTool({ name: 'whoami', arguments: {} })).structuredContent;
check('whoami', who.login === login && who.agent === 'ChatGPT', who.attribution);
const voted = await me.c.callTool({ name: 'vote_on_record', arguments: { id, value: 1, emoji: '🤔' } });
check('vote_on_record', !voted.isError && voted.structuredContent.score === 1, JSON.stringify(voted.structuredContent));
await page.goto(`${B}/r/${id}`);
check('the record page shows the vote with its attribution', (await page.locator('body').innerText()).includes(`ChatGPT · @${login}’s team`));
const kept = await me.c.callTool({ name: 'vote_on_record', arguments: { id, value: -1, if_absent: true } });
check('if_absent keeps the existing vote', kept.structuredContent.created === false && kept.structuredContent.score === 1);
const posted = await me.c.callTool({ name: 'post_comment', arguments: { id, body: 'The bound in Lemma 2 needs $n > 3$; for $n = 3$ the sum diverges.' } });
out('post_comment', posted.content[0].text.slice(0, 150));
check('post_comment is either published or refused with a moderation code', !posted.isError || /^moderation_/.test(posted.content[0].text));
const forum = await me.c.callTool({ name: 'search_forum', arguments: {} });
check('search_forum', !forum.isError, `${forum.structuredContent.total} topics`);
const gone = await me.c.callTool({ name: 'remove_record_vote', arguments: { id } });
check('remove_record_vote', gone.structuredContent.score === 0);
const rest = await fetch(`${B}/api/v1/keys`, { headers: { Authorization: `Bearer ${store.tokens.access_token}` } }).then((r) => r.json());
check('the token is listed as an agent key on the REST API', rest.keys.some((k) => k.current && k.agent === 'ChatGPT'));

// 4. Revocation by the person at /keys, then the client is told to sign in again.
await page.goto(`${B}/keys`);
check('/keys lists the connection', (await page.locator('form.meta').first().innerText()).startsWith('ChatGPT'));
await page.locator('form.meta button:has-text("Revoke")').first().click(); await page.waitForLoadState('networkidle');
const after = await fetch(`${B}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${store.tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
check('after revoking at /keys the token gets 401 with a challenge', after.status === 401 && /invalid_token/.test(after.headers.get('www-authenticate') ?? ''));
let reauth = false; try { store.tokens = { ...store.tokens }; await (await connect({ ...provider, redirectUrl, clientMetadata: provider.clientMetadata, redirectToAuthorization: () => { reauth = true; } })).c.listTools(); } catch (e) { reauth ||= e instanceof UnauthorizedError; }
check('the SDK client reacts to that 401 by starting sign-in again', reauth);
check('anonymous reading still works afterwards', !(await anon.c.callTool({ name: 'get_record', arguments: { id } })).isError);

// 5. Denying.
gotCallback = undefined; const denied = new Promise((r) => { gotCallback = r; });
store.tokens = undefined; await auth(provider, { serverUrl: `${B}/mcp` });
await page.goto(authorizeUrl.href); await page.click('button:has-text("Deny")');
const no = await denied;
check('Deny returns access_denied with iss and no code', no.searchParams.get('error') === 'access_denied' && !no.searchParams.has('code') && no.searchParams.get('iss') === B);

// 6. Pages the listing links, and discovery under both names.
for (const p of ['/terms', '/privacy', '/support', '/llms.txt', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
	check(`GET ${p}`, (await fetch(B + p)).status === 200);
}
check('GET /auth/review is 404 unless configured', ((await fetch(`${B}/auth/review`)).status === 404) === (MODE !== 'review'));
await browser.close(); server.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0);
