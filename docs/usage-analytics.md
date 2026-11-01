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

1. Check the Vercel plan first. As of 2026-10-27: Hobby includes 50,000 events/month with a one-month reporting window; Pro charges $0.03 per 1,000 events (against monthly usage credit) with a 12-month window. Get approval before enabling paid collection.
2. Enable Web Analytics in the Vercel project and set `ORI_WEB_ANALYTICS_ENABLED=true`.
3. View results in Vercel: project → Analytics → Visitors. ORI's `/stats` page links there but does not fetch visitor counts.

The SDK (`@vercel/analytics/next`) uses `beforeSend` to drop custom events, private and unknown routes, queries and fragments, and to replace record/forum IDs with route patterns. This controls only the event URL: Vercel may still process referrer, location, device data and IP addresses, and uses a daily visitor hash discarded after 24 hours. Clients without JavaScript, with blocked scripts, or bots may not appear.

## Tests

`site/lib/usage.test.ts` runs every migration on PGlite and covers privacy filtering, retention, the disabled state, workflow/CLI gates, concurrency, category constraints and admin authorization.

## References (checked 2026-10-27)

- Vercel: [Next.js setup](https://vercel.com/docs/analytics/quickstart), [pricing](https://vercel.com/docs/analytics/limits-and-pricing), [privacy](https://vercel.com/docs/analytics/privacy-policy), [URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data), [Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL `NOT VALID`](https://www.postgresql.org/docs/current/sql-altertable.html)
