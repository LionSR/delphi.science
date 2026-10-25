// /stats: how the API is used, in aggregate (the same numbers as /api/v1/stats).
import { db } from '../../lib/db.ts';
import { USAGE_NOTE, usage } from '../../lib/usage.ts';
import { date } from '../../lib/view.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API use · Open Research Index', description: 'API calls per week, top endpoints and top clients, counted in aggregate.' };

const n = (x: number) => x.toLocaleString('en');

export default async function Stats() {
	const u = await usage(await db(), 8);
	return (
		<article>
			<h1>API use</h1>
			<p className="count">{USAGE_NOTE} The same numbers as JSON: <a href="/api/v1/stats">/api/v1/stats</a>.</p>

			<h2>API calls per week</h2>
			<table className="stats">
				<thead><tr><th>Week of</th><th className="num">Calls</th><th className="num">By AI clients</th></tr></thead>
				<tbody>{u.weekly.map((w) => <tr key={w.week}><td>{date(w.week)}</td><td className="num">{n(w.calls)}</td><td className="num">{n(w.ai)}</td></tr>)}</tbody>
			</table>

			<h2>Top endpoints</h2>
			{u.endpoints.length === 0 ? <p className="count">No calls counted yet.</p> : (
				<table className="stats">
					<thead><tr><th>Endpoint</th><th className="num">Calls</th></tr></thead>
					<tbody>{u.endpoints.map((e) => <tr key={e.endpoint}><td><code>{e.endpoint}</code></td><td className="num">{n(e.calls)}</td></tr>)}</tbody>
				</table>
			)}

			<h2>Top clients</h2>
			{u.clients.length === 0 ? <p className="count">No calls counted yet.</p> : (
				<table className="stats">
					<thead><tr><th>Client</th><th>Kind</th><th className="num">Calls</th></tr></thead>
					<tbody>{u.clients.map((c) => <tr key={c.client}><td><code>{c.client}</code></td><td>{c.kind}</td><td className="num">{n(c.calls)}</td></tr>)}</tbody>
				</table>
			)}
			<p className="count">Since {date(u.since)}. Kinds: ai (AI assistants and their crawlers), search (search engines), bot (other crawlers), tool (HTTP libraries and command-line tools), browser.</p>
		</article>
	);
}
