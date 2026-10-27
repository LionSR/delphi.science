# Usage analytics

The browser SDK and API counters already existed on main. This change makes collection opt-in,
constrains the stored categories, bounds retention, and restricts statistics to administrators.
No migration, production deployment, dashboard setting, billing change or new credential was
applied while preparing this PR.

## Activation after review

1. Review and apply `site/supabase/migrations/20261027034516_private_bounded_usage.sql` using the
   normal migration process. It deletes old counters and rows with arbitrary legacy client/endpoint
   names, which could contain identifiers, before adding fixed-category checks. Keep the table
   private with RLS and no public policies or grants. Do not run an app version that admits arbitrary
   categories against the new constraints. This migration affects metrics only.
2. Configure `ORI_STATS_ADMINS` as a comma-separated list of approved GitHub logins on the server.
   Empty configuration denies everyone. Signed-in admins read `/stats`; API admins send an existing
   agent key owned by an approved account to `GET /api/v1/stats?weeks=8`. All such keys owned by an
   admin can read these aggregates, so approve that access when choosing the list. Responses must
   never be shared-cached. Read-only research endpoints remain available without authentication.
3. Set `ORI_USAGE_ANALYTICS_ENABLED=true` to count origin calls. Preview deployments skip counting.
   It stores only `(UTC day, fixed method + endpoint template, fixed client category, integer calls)`.
   Product tokens are claims from an untrusted User-Agent, not authenticated identity. Versions and
   arbitrary products are discarded; unknown products become `other`. No IP, raw UA, query, body,
   credential, login, agent name, request ID or resolved record/forum/sitemap ID is stored.
4. Verify the daily `Usage retention` workflow can use the **existing** `SUPABASE_DB_URL` secret.
   It runs at 00:11 UTC independently of harvesting/labeling. Old rows are also deleted on counter
   writes and stats reads. Retain today plus the preceding 89 UTC dates; daily cleanup may lag by
   up to a day, and scheduler outages can delay physical deletion. Monitor failed workflow runs.
   No backups or vendor log-retention settings are changed by this code.
5. For visitors, review the Vercel project's **current plan and existing analytics setting** first.
   The official pricing page checked 27 October 2026 lists Hobby at 50,000 events/month with a
   one-month reporting window; Pro lists no included events and $0.03/1,000 events (subject to
   monthly usage credit), with a 12-month reporting window. Plus is $10/month and is unnecessary
   for this implementation. Do not enable paid collection, purchase an upgrade, or add credentials
   without approval. Once authorized, enable Web Analytics in the existing project dashboard and
   set `ORI_WEB_ANALYTICS_ENABLED=true` for a reviewed production deployment. It is off by default,
   and only mounts in `VERCEL_ENV=production`.
6. In Vercel, open the project → Analytics → Visitors → last 7 days. ORI's admin page links to the
   dashboard and **does not fetch visitor counts**. A supported Web Analytics API now exists, but
   needs a Vercel token/project scope; this PR does not create credentials or request account access.
   JavaScript-disabled clients, blocked scripts and bots may not appear; API calls are measured
   separately and include failures, exclude CDN hits, and may undercount failed metric writes.

## Privacy and bounds

There are 49 fixed client categories and 25 fixed endpoint categories (110,250 possible rows in
90 UTC dates). Database constraints make this bound independent of concurrent callers. Unknown
endpoints are dropped before any query. Additions require an explicit migration and code review.
Weekly tables start Monday UTC, with the current week partial; up to 13 weeks are available.

Browser pageviews use the official `@vercel/analytics/next` SDK. `beforeSend` drops custom events,
private/unknown routes, queries and fragments, and substitutes route patterns for record/forum IDs.
It keeps only the origin and approved public route pattern in the event URL. Vercel may separately
process referrer, location and device/browser data as described in its policy; this hook controls the
event URL, not all vendor processing. Cookie-free does not mean the hosting provider never processes
IPs. Vercel documents a request-derived daily visitor hash discarded after 24 hours. No Vercel
retention claim beyond the current plan's reporting window is implied.

Support address `texra-ai@outlook.com` is verified from PR #28, which is otherwise separate. This PR
removes the outdated Anthropic privacy sentence without merging the DeepSeek labeler changes.
Review the final policy against the final deployed labeler before release; issue #6 still needs
owner policy approval and live verification.

## Verification

Run `npm test`, `npx tsc --noEmit -p .`, and `npm run build` in `site` after producing the fixture index
as documented in CI. The usage tests execute every migration in local PGlite, verify privacy,
retention, concurrency, category constraints and admin authorization. UI review covers anonymous,
admin, empty and populated views at desktop and mobile widths. No production data is required.

Official references checked 27 October 2026:

- [Next.js setup](https://vercel.com/docs/analytics/quickstart)
- [Web Analytics pricing](https://vercel.com/docs/analytics/limits-and-pricing)
- [Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy)
- [Sensitive URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data)
- [Supported Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api)
- [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security)
