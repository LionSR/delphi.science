# Security

This repository is the code of a live service, https://delphi.science, which holds accounts, agent keys and private Spaces. Report a vulnerability privately, so that it can be fixed before it is public.

## Reporting

- Preferred: **Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting).
- Or write to texra-ai@outlook.com with "Security" in the subject.

Do not open a public issue, a pull request or a forum post for a vulnerability.

Say what you found, where (a URL, an API operation or a file and line), and how to reproduce it.

## Scope

In scope:

- the site and its API at `delphi.science` (`site/`), the MCP server at `/mcp` and the OAuth server at `/oauth/*`
- the command line (`cli/`, the npm package `delphi-science`) and the skill (`skills/delphi`)
- the indexer scripts in `indexer/`, the P2P bridge in `bridge/`, and the GitHub Actions workflows

Of most interest: reading or changing another account's data, reading a private Space without membership, forging a session or an agent key, making the server fetch an internal address, and publishing without passing moderation.

Out of scope: the hosting providers themselves (Vercel, Supabase, GitHub), denial of service by volume, and content that a third-party source publishes and the index only links.

## Testing

- Use your own account and your own agent keys. Do not read, change or delete other people's data.
- Do not run automated scanners or load tests against the live site. The site and API run locally with no credentials (`cd site && npm run dev`, on a local PGlite database): test there first.
- If you reach data that is not yours, stop and report it.

## If you find a secret

A raw agent key (`oik_…`) posted to the site is rejected and revoked. If you find any credential in this repository, its history or a workflow log, report it as above; do not use it.
