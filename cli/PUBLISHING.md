# Releasing delphi-science to npm

The package is `cli/` of this repository. It has no build step and no dependencies: `delphi.mjs`, `api.json` (cut
from the OpenAPI document by `npm run openapi` in `site/`) and `package.json`; npm adds `README.md`. This file is
not published.

Releases are made by GitHub Actions, not by hand: pushing a tag `cli-v<version>` runs
`.github/workflows/release-cli.yml`, which checks the tag against `cli/package.json`, runs the command-line tests
against the site, and publishes with npm trusted publishing (OIDC). No npm token is stored anywhere.

## Once, before the first release

npm sets a trusted publisher in the settings of a package, so the package has to exist first. The first version is
therefore published from the owner's own machine, and every later one by the workflow.

1. The package is Apache-2.0, as the repository is (`LICENSE`, `cli/LICENSE`, `"license"` in `cli/package.json`).
2. Check the name is still free: `npm view delphi-science` should answer 404. (`delphi` is taken.)
3. Publish the first version by hand, from a clean checkout of the commit to release:

   ```
   cd cli
   npm pack --dry-run          # api.json, delphi.mjs, package.json and the README
   npm login                   # the owner's account, with 2FA
   npm publish --access public
   ```

4. On npmjs.com: the package `delphi-science` → Settings → Trusted Publisher → GitHub Actions, with
   - Organization or user: `LionSR`
   - Repository: `open-research-index`
   - Workflow filename: `release-cli.yml`
   - Environment name: empty
   - Allowed actions: allow `npm publish`

   npm drops a trusted publisher that has not published within 2 days of being set up, so set it up when the next
   release is near, or follow it with a patch release.
5. Then, in the package's Settings → Publishing access, choose "Require two-factor authentication and disallow
   tokens". The workflow keeps working; tokens stop.

## Every release after that

1. Change the version in `cli/package.json` (and, if the verbs changed, run `npm run openapi` in `site/` and commit
   `site/openapi.json` and `cli/api.json`). Merge to `main`.
2. Deploy the site first if the release depends on a change to the six verb routes.
3. Tag the merged commit and push the tag:

   ```
   git tag cli-v0.1.1 && git push origin cli-v0.1.1
   ```

4. Check it from somewhere else: `npx delphi-science@latest --version`.

The workflow file must be on the tagged commit under exactly this name, since npm matches the filename. Provenance
is attached automatically while the repository is public.
