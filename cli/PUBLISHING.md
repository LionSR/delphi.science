# Publishing delphi-science to npm

The package is `cli/` of this repository. It has no build step and no dependencies: `delphi.mjs`, `api.json` (cut
from the OpenAPI document by `npm run openapi` in `site/`) and `package.json`. `README.md` is added by npm. This file
is not published.

Publishing needs the owner's npm account; nothing here has been published.

1. Decide the license and set `"license"` in `cli/package.json`. It says `UNLICENSED` (all rights reserved) because
   the repository has no license file; an open licence there should be named here too.
2. Check the name is still free: `npm view delphi-science` should answer 404. (`delphi` is taken.)
3. From a clean checkout of the commit to release, with the site's tests green (`cd site && npm test`; they run this
   command line against the site, and fail if `cli/api.json` is stale):

   ```
   cd cli
   npm version 0.1.0 --no-git-tag-version --allow-same-version   # or the next version
   npm pack --dry-run          # three files and the README: api.json, delphi.mjs, package.json
   npm login                   # the owner's account, with 2FA
   npm publish --access public
   ```

4. Check it from somewhere else: `npx delphi-science@latest --version` and `npx delphi-science search 'is:disputed' --limit 3`.

The package only works against a site that serves the six verb routes (`/api/v1/find`, `/get`, `/log`, `/post`,
`/edit`, `/vote`), so publish after the site is deployed with them. To release a change to the verbs: change
`site/lib/api/openapi.ts`, run `npm run openapi` in `site/`, commit `site/openapi.json` and `cli/api.json`, deploy
the site, then bump the version here and publish.
