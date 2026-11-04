// /stats: aggregate API usage for administrators (the same numbers as /api/v1/stats).
import { db } from '#lib/db.ts';
import { collectionEnabled, retentionEnabled, USAGE_NOTE, usage } from '#lib/api/usage.ts';
import { date, NAME } from '#lib/view.ts';
import { me } from '#lib/accounts/session.ts';
import { canReadUsage } from '#lib/api/usage-admin.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Usage statistics · ${NAME}`, description: 'Administrator access to aggregate API counts and claimed user-agent products.' };

const n = (x: number) => x.toLocaleString('en');

export default async function Stats() {
	const who = await me();
	if (!canReadUsage(who)) {
		return (
			<article>
				<h1>Usage statistics</h1>
				<p>Usage statistics are available to administrators.</p>
				{!who && <p><a href="/auth/github?next=/stats">Sign in with GitHub</a></p>}
			</article>
		);
	}
	const u = await usage(await db(), 8);
	return (
		<article>
			<h1>Usage statistics</h1>
			<p>Admin access. {collectionEnabled() ? 'API counting is enabled.' : 'API counting is disabled; any saved counts are historical.'} {retentionEnabled() ? 'Retention cleanup is enabled.' : 'Retention cleanup is disabled; viewing this page does not delete saved counts.'}</p>
			<h2>Weekly visitors</h2>
			<p>Open the <a href="https://vercel.com/dashboard">Vercel project dashboard</a>, select Analytics, and choose the last 7 days. This page does not fetch visitor counts. Web Analytics must be enabled in Vercel and deployed with the collection flag; blocked scripts and clients without JavaScript may not appear.</p>
			<p className="count">{USAGE_NOTE} For JSON, send an administrator&apos;s agent key to <code>GET /api/v1/stats</code>.</p>

			<h2>API calls per week</h2>
			<table className="stats">
				<thead><tr><th>Week of (UTC)</th><th className="num">Calls</th><th className="num">Claiming AI products</th></tr></thead>
				<tbody>{u.weekly.map((w) => <tr key={w.week}><td>{date(w.week)}</td><td className="num">{n(w.calls)}</td><td className="num">{n(w.ai)}</td></tr>)}</tbody>
			</table>

			<h2>Top endpoints</h2>
			{u.endpoints.length === 0 ? <p className="count">No calls counted yet.</p> : (
				<table className="stats">
					<thead><tr><th>Endpoint</th><th className="num">Calls</th></tr></thead>
					<tbody>{u.endpoints.map((e) => <tr key={e.endpoint}><td><code>{e.endpoint}</code></td><td className="num">{n(e.calls)}</td></tr>)}</tbody>
				</table>
			)}

			<h2>Top claimed user-agent products</h2>
			{u.clients.length === 0 ? <p className="count">No calls counted yet.</p> : (
				<table className="stats">
					<thead><tr><th>Client</th><th>Kind</th><th className="num">Calls</th></tr></thead>
					<tbody>{u.clients.map((c) => <tr key={c.client}><td><code>{c.client}</code></td><td>{c.kind}</td><td className="num">{n(c.calls)}</td></tr>)}</tbody>
				</table>
			)}
			<p className="count">Since {date(u.since)}. Kinds: ai (claimed AI products), search (search engines), bot (other crawlers), tool (HTTP libraries and command-line tools), browser.</p>
		</article>
	);
}
