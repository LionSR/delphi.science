// The list: newest first, or a search in the API's syntax, with links to each subject division.
import { db } from '../lib/db.ts';
import { QueryError, search } from '../lib/query.ts';
import taxonomy from '../lib/taxonomy.json' with { type: 'json' };
import { date, recordPath, tally, tex } from '../lib/view.ts';

export const dynamic = 'force-dynamic';

type Params = Promise<{ q?: string; sort?: string; cursor?: string }>;

export default async function Home({ searchParams }: { searchParams: Params }) {
	const { q = '', sort = q ? 'relevance' : 'newest', cursor } = await searchParams;
	let res: Awaited<ReturnType<typeof search>> | null = null;
	let error = '';
	try {
		res = await search(await db(), q, { sort, cursor, limit: 50 });
	} catch (e) {
		if (!(e instanceof QueryError)) throw e;
		error = `${e.message}. ${e.fix}`;
	}
	const next = res?.next_cursor ? `/?${new URLSearchParams({ q, sort, cursor: res.next_cursor })}` : '';
	return (
		<>
			<form action="/">
				<input name="q" defaultValue={q} placeholder='Search: ti:hodge, au:claude, cat:math.NT' aria-label="Search" />
				<select name="sort" defaultValue={sort} aria-label="Sort">
					<option value="relevance">Relevance</option>
					<option value="newest">Newest</option>
					<option value="score">Score</option>
					<option value="mentions">Mentions</option>
				</select>
				<button>Search</button>
			</form>
			<nav className="subjects" aria-label="Subjects">
				{taxonomy.divisions.map((d) => <a key={d.key} href={`/?q=cat:${d.key}`}>{d.name}</a>)}
			</nav>
			{error && <p className="count">{error}</p>}
			{res && <p className="count">{res.total.toLocaleString('en')} records</p>}
			<ol>
				{res?.results.map((r) => (
					<li key={String(r.id)} className="item">
						<a className="title" href={recordPath(r.id)}>{tex(r.title)}</a>
						{Array.isArray(r.authors) && r.authors.length > 0 && <p className="authors">{r.authors.slice(0, 8).join(', ')}</p>}
						<p className="meta">
							<code>{String(r.source)}</code>
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
