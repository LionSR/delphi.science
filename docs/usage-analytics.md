# Usage analytics

Two independent, opt-in mechanisms, both off by default:

- **API call counters** stored in Postgres (`site/lib/api/usage.ts`), readable by administrators.
- **Vercel Web Analytics** pageviews in the browser (`site/lib/analytics.ts`), viewed in the Vercel dashboard.

## Configuration

| Variable | Where | Effect |
| --- | --- | --- |
| `ORI_STATS_ADMINS` | server | Comma-separated GitHub logins allowed to read stats. Empty denies everyone. |
| `ORI_USAGE_ANALYTICS_ENABLED=true` | server | Count origin API calls. Skipped on preview deployments. |
| `ORI_USAGE_RETENTION_ENABLED=true` | server and repository variable | Delete counters older than 90 UTC dates. Also needs `ORI_USAGE_ANALYTICS_ENABLED=true` in the same place. |
| `ORI_WEB_ANALYTICS_ENABLED=true` | server | Mount the Vercel Analytics SDK, only when `VERCEL_ENV=production`. |

### Admin access

- Signed-in admins open `/stats`.
- API: `GET /api/v1/stats?weeks=8` (1–13 weeks) with an agent key owned by an admin. Every key an admin owns can read the aggregates.
- Responses are `Cache-Control: private, no-store`. Public research endpoints need no authentication.

### Counters

Each row is `(UTC day, method + endpoint template, client category, call count)`.

- 25 fixed endpoint categories and 49 fixed client categories, enforced by database constraints (migration `site/supabase/migrations/20261027034516_private_bounded_usage.sql`). Unknown endpoints are dropped; adding a category needs a migration.
- The client category comes from the User-Agent product token. It is an unauthenticated claim; versions are discarded and unknown products count as `other`.
- Not stored: IP, raw User-Agent, query, body, credentials, login, agent name, request ID, or resolved record/forum IDs.
- CDN cache hits are not counted, failed requests are, and failed metric writes are dropped.
- Weeks start Monday UTC; the current week is partial. Reports show at most the last 90 UTC dates.
- The table is private: RLS on, no public policies or grants. The migration's `NOT VALID` checks constrain new rows without rewriting old ones.

### Retention

Cleanup deletes data, so it has its own switch and needs explicit owner approval:

- Set `ORI_USAGE_ANALYTICS_ENABLED=true` and `ORI_USAGE_RETENTION_ENABLED=true` both in the server environment and as repository variables.
- `.github/workflows/usage-retention.yml` runs daily at 00:11 UTC. It skips the whole job unless both repository variables are `true`, and `scripts/prune-usage.ts` checks both again before connecting.
- Counter writes also prune when both flags are on. Reads never delete.
- Cleanup keeps today plus the previous 89 UTC dates. It may lag by a day; watch for failed workflow runs.
- With cleanup off, old rows stay in the table but are not reported.

### Web Analytics

1. Check the Vercel plan first. As of 2026-11-03: Hobby includes 50,000 events/month across the team with a one-month reporting window and no paid overages; Pro charges $0.03 per 1,000 events (against monthly usage credit) with a 12-month window. Pro trial events can be billed after the trial ends. Web Analytics Plus is optional and adds $10/month per team; it is unnecessary for this integration. Get approval before enabling paid collection or accepting any new agreement.
2. Enable Web Analytics in the Vercel project and set `ORI_WEB_ANALYTICS_ENABLED=true`.
3. View results in Vercel: project → Analytics → Visitors. ORI's `/stats` page links there but does not fetch visitor counts.

The app passes the React SDK (`@vercel/analytics/react`) fixed `route` and `path` values from `analyticsPath`, which keeps Vercel's Next.js intake configuration. This way the Next.js wrapper cannot build dynamic-path names from arbitrary query keys on static pages. `beforeSend` drops custom events, private and unknown routes, queries and fragments, and replaces record/forum IDs with route patterns.

The hosted script adds the referrer and stored attribution separately from the filtered event URL, so the URL filter does not reach them. Collection is therefore skipped on a page whose incoming referrer is more than an origin (it has a path, query, fragment or credentials, is not a valid URL, or is not HTTP), on a page with existing `__va_attribution` storage, and when storage cannot be accessed. These checks run before the SDK mounts and before every event, and they never delete or change visitor storage. A site-wide `Referrer-Policy: strict-origin` also strips paths and queries from the referrer header of same-origin script and intake requests. That header alone is not enough: the referrer a visitor arrives with is set by the linking site. Private routes never mount the SDK on initial load, and passing explicit routes turns off its automatic history tracking.

The app sends no page content, search text, account identity, custom event properties or record IDs. Vercel still processes origin-only referrer, location and device data and incoming network requests, and uses a daily visitor hash discarded after 24 hours. The privacy policy at `/privacy` describes these limits. Visitors without JavaScript or with blocked scripts, visits with unsafe referrers or stored attribution, and bots may not be counted.

Collection starts only after three steps: the switch in the project dashboard, the production environment flag, and then an authorized deployment. Installing the SDK does not mean collection is on. After activation, look for a sanitized pageview request in the browser's Network tools and confirm it arrives in the dashboard; a successful build does not show that collection works.

## Tests

`site/lib/api/usage.test.ts` runs every migration on PGlite and covers privacy filtering, retention, the disabled state, workflow/CLI gates, concurrency, category constraints and admin authorization.

`site/lib/analytics.test.ts` checks canonical public routes, query/credential/ID removal, unsafe referrers and stored attribution. Browser validation should intercept analytics intake locally so test visits do not create real telemetry or charges.

Validated locally on 2026-11-03: production build and TypeScript passed; all 21 tests in `analytics.test.ts` and `usage.test.ts` passed. Chromium exercised the production build with the current hosted analytics script and intercepted all intake requests: public and record-to-record transitions sent only fixed routes, while custom events, private transitions, unsafe incoming referrers, stored attribution and inaccessible storage sent no events. Preview and disabled-production servers loaded no analytics SDK. This validates the integration locally, not dashboard activation or live event arrival.

## References (checked 2026-11-03)

- Vercel: [Next.js setup](https://vercel.com/docs/analytics/quickstart), [pricing](https://vercel.com/docs/analytics/limits-and-pricing), [privacy](https://vercel.com/docs/analytics/privacy-policy), [URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data), [Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL `NOT VALID`](https://www.postgresql.org/docs/current/sql-altertable.html)
