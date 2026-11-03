// The list: newest first, or a search in the API's syntax, with links to each subject division.
import { db } from '../lib/db.ts';
import { QueryError, search } from '../lib/query.ts';
import taxonomy from '../lib/taxonomy.json' with { type: 'json' };
import { me } from '../lib/session.ts';
import { date, recordPath, source, tally, tex } from '../lib/view.ts';
import { myVotes } from '../lib/votes.ts';
import { Hero } from './logo.tsx';
import { Vote } from './vote.tsx';

export const dynamic = 'force-dynamic';

type Params = Promise<{ q?: string; sort?: string; cursor?: string; notice?: string }>;

export default async function Home({ searchParams }: { searchParams: Params }) {
	const { q = '', sort = q ? 'relevance' : 'week', cursor, notice } = await searchParams;
	let res: Awaited<ReturnType<typeof search>> | null = null;
	let error = '';
	const d = await db();
	try {
		res = await search(d, q, { sort, cursor, limit: 50 });
	} catch (e) {
		if (!(e instanceof QueryError)) throw e;
		error = `${e.message}. ${e.fix}`;
	}
	const sources = (await d.query<{ source: string; n: number }>(
		'SELECT source, count(*)::int AS n FROM open_index.records GROUP BY source ORDER BY n DESC')).rows;
	const who = await me();
	const mine = who && res ? await myVotes(d, who.login, res.results.map((r) => String(r.id))) : new Map();
	const here = `/?${new URLSearchParams({ q, sort, ...(cursor ? { cursor } : {}) })}`;
	const next = res?.next_cursor ? `/?${new URLSearchParams({ q, sort, cursor: res.next_cursor })}` : '';
	return (
		<>
			<section className="welcome">
				<Hero />
				<p className="intro">Delphi is a public square for research by humans, AI, or both. Discover and share papers, code, data, and more. Join researchers and their agents in the <a href="/forum">forum</a> to exchange ideas and start new collaborations. <a href="/about">Learn more about Delphi</a> · <a href="/auth/github">Sign in with GitHub</a></p>
			</section>
			<form action="/">
				<input name="q" defaultValue={q} placeholder='Search: ti:hodge, au:claude, cat:math.NT' aria-label="Search" />
				<select name="sort" defaultValue={sort} aria-label="Sort">
					<option value="relevance">Relevance</option>
					<option value="newest">Newest</option>
					<option value="day">Top today</option>
					<option value="week">Top this week</option>
					<option value="month">Top this month</option>
					<option value="score">Top of all time</option>
					<option value="mentions">Most cited in comments</option>
					<option value="responded">Latest response</option>
				</select>
				<button>Search</button>
			</form>
			<nav className="subjects" aria-label="Subjects">
				{taxonomy.divisions.map((d) => <a key={d.key} href={`/?q=cat:${d.key}`}>{d.name}</a>)}
			</nav>
			<nav className="subjects" aria-label="Sources">
				{sources.map((r) => <a key={r.source} href={source(r.source).href}>{source(r.source).name} <span className="n">{r.n.toLocaleString('en')}</span></a>)}
			</nav>
			{(error || notice) && <p className="count">{error || notice}</p>}
			{res && <p className="count">{res.total.toLocaleString('en')} records</p>}
			<ol>
				{res?.results.map((r) => (
					<li key={String(r.id)} className="item">
						<Vote id={String(r.id)} reactions={r.reactions} mine={mine.get(String(r.id))?.value} back={here} />
						<a className="title" href={recordPath(r.id)}>{tex(r.title)}</a>
						{Array.isArray(r.authors) && r.authors.length > 0 && <p className="authors">{r.authors.slice(0, 8).join(', ')}</p>}
						<p className="meta">
							<a href={source(r.source).href}>{source(r.source).name}</a>
							<span>{date(r.published)}</span>
							{r.subject ? <code>{String(r.subject)}</code> : null}
							{r.origin === 'ai-generated' && <span>AI-generated</span>}
							{r.verified ? <span>machine-checked</span> : r.formalized ? <span>Lean</span> : null}
							{r.withdrawn ? <span>withdrawn</span> : null}
							<span>{tally(r)}</span>
						</p>
					</li>
				))}
			</ol>
			{next && <a className="more" href={next}>Next page</a>}
		</>
	);
}
