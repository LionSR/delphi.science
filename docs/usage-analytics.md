# Usage analytics

Two independent, opt-in mechanisms, both off by default:

- **API call counters** stored in Postgres (`site/lib/usage.ts`), readable by administrators.
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

Cleanup is destructive, so it is separately gated and needs explicit owner approval:

- Set `ORI_USAGE_ANALYTICS_ENABLED=true` and `ORI_USAGE_RETENTION_ENABLED=true` both in the server environment and as repository variables.
- `.github/workflows/usage-retention.yml` runs daily at 00:11 UTC. It skips the whole job unless both repository variables are `true`, and `scripts/prune-usage.ts` checks both again before connecting.
- Counter writes also prune when both flags are on. Reads never delete.
- Cleanup keeps today plus the previous 89 UTC dates. It may lag by a day; watch for failed workflow runs.
- With cleanup off, old rows stay in the table but are not reported.

### Web Analytics

1. Check the Vercel plan first. As of 2026-11-03: Hobby includes 50,000 events/month across the team with a one-month reporting window and no paid overages; Pro charges $0.03 per 1,000 events (against monthly usage credit) with a 12-month window. Pro trial events can be billed after the trial ends. Web Analytics Plus is optional and adds $10/month per team; it is unnecessary for this integration. Get approval before enabling paid collection or accepting any new agreement.
2. Enable Web Analytics in the Vercel project and set `ORI_WEB_ANALYTICS_ENABLED=true`.
3. View results in Vercel: project → Analytics → Visitors. ORI's `/stats` page links there but does not fetch visitor counts.

The SDK (`@vercel/analytics/react`) receives explicit fixed `route` and `path` values from `analyticsPath`, preserving Vercel's Next.js intake configuration. This avoids the Next wrapper deriving dynamic-path names from arbitrary query keys on static pages. `beforeSend` drops custom events, private and unknown routes, queries and fragments, and replaces record/forum IDs with route patterns.

The hosted script adds referrer and stored attribution separately from the filtered event URL. Collection therefore skips documents with a non-origin incoming referrer (path, query, fragment, credentials, invalid URL or non-HTTP scheme), existing `__va_attribution` storage, or inaccessible storage. Checks run before mounting and before every event; no visitor storage is deleted or modified by these checks. A site-wide `Referrer-Policy: strict-origin` also strips paths and queries from same-origin script/intake request headers. Incoming referrers are controlled by their source, so the response header alone is insufficient. Private routes never mount the SDK initially, and explicit routes disable its automatic history tracking.

No page content, search text, account identity, custom event properties, or record IDs are supplied by the app. Vercel still processes origin-only referrer, location and device data and incoming network requests, and uses a daily visitor hash discarded after 24 hours. The privacy policy at `/privacy` discloses these limits. Clients without JavaScript, with blocked scripts, unsafe referrers or stored attribution, or bots may not appear.

Activation still requires the project dashboard switch, the production environment flag, and a subsequent authorized deployment. Installing the SDK does not prove collection is active. Verify a sanitized pageview request in browser Network tools and its arrival in the dashboard after activation; do not infer success from a successful build.

## Tests

`site/lib/usage.test.ts` runs every migration on PGlite and covers privacy filtering, retention, the disabled state, workflow/CLI gates, concurrency, category constraints and admin authorization.

`site/lib/analytics.test.ts` checks canonical public routes, query/credential/ID removal, unsafe referrers and stored attribution. Browser validation should intercept analytics intake locally so test visits do not create real telemetry or charges.

Validated locally on 2026-11-03: production build and TypeScript passed; all 21 tests in `analytics.test.ts` and `usage.test.ts` passed. Chromium exercised the production build with the current hosted analytics script and intercepted all intake requests: public and record-to-record transitions sent only fixed routes, while custom events, private transitions, unsafe incoming referrers, stored attribution and inaccessible storage sent no events. Preview and disabled-production servers loaded no analytics SDK. This validates the integration locally, not dashboard activation or live event arrival.

## References (checked 2026-11-03)

- Vercel: [Next.js setup](https://vercel.com/docs/analytics/quickstart), [pricing](https://vercel.com/docs/analytics/limits-and-pricing), [privacy](https://vercel.com/docs/analytics/privacy-policy), [URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data), [Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL `NOT VALID`](https://www.postgresql.org/docs/current/sql-altertable.html)
