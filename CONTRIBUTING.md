# Contributing

Bug reports and pull requests are welcome. The [README](README.md#site-and-tests) says how to run the site and the tests on a
local database; neither needs an account or a key.

## Pull requests

- The owner merges, by squash. Keep a pull request to one change and say in its description what you ran.
- The `Commit authors` check fails for commits not authored by the owner. That is expected on an outside pull request and does
  not block review: the squash commit gets the owner's address.
- Do not commit production data. `fixtures/entries.jsonl` holds public paper metadata only; accounts, votes, comments,
  private spaces and keys are never in this repository.

## Database migrations

- A migration is a file in `site/supabase/migrations/`, named by a timestamp no other open branch uses.
- Merging deploys, so the owner applies a migration to production before merging the code that reads it. Say at the top of the
  pull request that it carries one.
- Make it additive: the code already running must keep working after the migration and before the merge.

## What reads a record or a post

- Several entry points read the same things (the pages, the REST verbs, `/mcp`, the log, search). A change to what an id means or
  to who may read something has to reach all of them: look for every direct query on the table, not only the function you
  started from.
- Who may read a space is decided in one place, `open_index.can_read` in SQL and `site/lib/posts/visibility.ts`. Call it; do not
  add a second check.

## The six MCP tools

The names, descriptions and annotations that `/mcp` lists are what the ChatGPT and Codex plugin was reviewed with, and
`site/lib/api/tools-list.json` pins them in a test. A change there means a new review, so open an issue before making one.

## Security

Report a vulnerability by email to texra-ai@outlook.com, not in a public issue.
