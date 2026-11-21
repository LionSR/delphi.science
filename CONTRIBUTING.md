# Contributing

Contributions are welcome: a new source, a fix to the site or the API, a correction to the documentation. For a larger change, open an issue first and say what problem it solves.

A vulnerability is not reported here: see [SECURITY.md](SECURITY.md). A wrong record, a missing response or a moderation decision is reported on the site, at https://delphi.science/support.

## Running it

Nothing below needs credentials. The site and the tests run on a local PGlite database built from `fixtures/entries.jsonl`.

```bash
pip install -r requirements.txt
cd site && npm ci
npm run dev                                   # site and API; "Sign in" logs you in as @local-dev
```

Tests, as CI runs them (`.github/workflows/test.yml`):

```bash
python3 test_index.py && python3 test_candidates.py && python3 test_x_candidates.py
cd site && npm test && npx tsc --noEmit -p .
```

The site tests read `dist/index.json`. Build it first as the README says under "Site and tests".

## What a change needs

- **Tests pass**, and a change in behaviour comes with a test for it.
- **One definition of the API.** Operations are defined in `site/lib/api/openapi.ts`. After a change there, run `cd site && npm run openapi`, which rewrites `site/openapi.json` and `cli/api.json`; commit both.
- **A new source** follows "Adding a source" in the README: an adapter in `sources.py`, a prefix in `site/lib/records/prefixes.json`. Prefixes are never reused.
- **A database change** is a new file in `site/supabase/migrations/`. Do not edit a migration that is already there.
  Merging deploys, so a maintainer applies the migration to production before merging the code that reads it: say at the top of the pull request that it carries one, and keep it additive so the code already running still works in between.
- **No secrets and no personal data** in code, fixtures, tests or commit messages. Tests inject a mock moderator; they never call a paid model.
- **Plain prose** in documentation, comments and site text, as the rest of the repository is written.

Pull requests from forks run the tests without any of the repository's secrets, and a maintainer approves the first run.

A maintainer merges by squash. The `Commit authors` check fails on commits that are not the owner's; that is expected on an outside pull request and does not block review.

## Licence

The code is Apache-2.0 ([LICENSE](LICENSE)). By contributing you agree that your contribution is under the same licence. Indexed records, abstracts and quoted responses belong to their authors and sources, and are not covered by it.
