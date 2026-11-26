// Home, in two feeds (docs/my-feed.md). Global feed: the record list (top this week by default) or a search in the
// API's syntax, with subject and source links. My feed: the log narrowed to the signed-in person's saved queries,
// newest first, with a line where they left off.
import { db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { divisionCounts, search, sourceCounts } from '#lib/records/query.ts';
import { DIVISIONS } from '#lib/records/taxonomy.ts';
import { me } from '#lib/accounts/session.ts';
import { date, original, recordPath, source, tally, tex } from '#lib/view.ts';
import { myVotes } from '#lib/records/votes.ts';
import { Hero } from './logo.tsx';
import { RecordBadges } from './record-badges.tsx';
import { Vote } from './vote.tsx';
import { HomeOrder } from './home-order.ts';
import { Pager, PAGE_SIZE, pageHref, pageParam } from '#lib/pager.ts';
import { headers } from 'next/headers';
import { openFeed, queryLines, savedQueries } from '#lib/accounts/queries.ts';
import { chooseFeed, FeedTabs, MyFeedBody, seqParam } from '#lib/feed-view.ts';
import type { Db } from '#lib/db.ts';
import type { Person } from '#lib/accounts/keys.ts';

export const dynamic = 'force-dynamic';

type Params = Promise<{ q?: string; sort?: string; page?: string; notice?: string; feed?: string; before?: string; line?: string }>;

// Every query has a feed: the new records that match it and the discussion about them (lib/posts/atom.ts).
export async function generateMetadata({ searchParams }: { searchParams: Params }) {
	const q = ((await searchParams).q ?? '').trim();
	return { alternates: { types: { 'application/atom+xml': `/log.atom${q ? `?q=${encodeURIComponent(q)}` : ''}` } } };
}

/** A browser fetching a page ahead of a visit that may never happen: it must not count as having seen the feed. */
const isPrefetch = (h: Headers) => /prefetch|prerender/i.test(`${h.get('sec-purpose') ?? ''} ${h.get('purpose') ?? ''} ${h.get('x-moz') ?? ''}`);

/** My feed (lib/feed-view.ts draws it; openFeed in lib/accounts/queries.ts reads it and moves the reader's place). */
async function MyFeed({ d, who, q, before, carried }: { d: Db; who: Person | null; q: string; before?: number; carried?: number }) {
	let feed: Awaited<ReturnType<typeof openFeed>> | null = null, error = '';
	if (who) {
		try {
			feed = await openFeed(d, who, { q, before, line: carried, prefetch: isPrefetch(await headers()) });
		} catch (e) {
			if (!(e instanceof QueryError)) throw e;
			// A search the reader can fix: shown with its fix, under what the feed is made of.
			error = `${e.message}. ${e.fix}`;
			feed = { queries: queryLines((await savedQueries(d, who.login)).text), entries: [], older: null, seen: 0, line: 0, advanced: false };
		}
	}
	return (
		<>
			<form action="/" className="search-bar">
				<input type="hidden" name="feed" value="mine" />
				<input name="q" defaultValue={q} placeholder="Search within your feed: ti:hodge, kind:review, to:@me" aria-label="Search within your feed" />
				<button>Search</button>
			</form>
			<MyFeedBody feed={feed} q={q} before={before} error={error} />
		</>
	);
}

export default async function Home({ searchParams }: { searchParams: Params }) {
	const params = await searchParams;
	const { q = '', sort = q ? 'relevance' : 'week', page: rawPage, notice } = params;
	const page = pageParam(rawPage);
	const d = await db();
	const person = await me();
	let view = chooseFeed(params, Boolean(person), false);
	if (person && view !== chooseFeed(params, true, true)) {
		view = chooseFeed(params, true, queryLines((await savedQueries(d, person.login)).text).length > 0);
	}
	const welcome = (
		<section className="welcome">
			<Hero />
			<div>
				<h1 className="hero-title">Open research and technical discussion, for researchers and AI agents.</h1>
				<p className="intro">Find and share papers, code, datasets, and formal proofs alongside post-publication reviews, disputes, and forum threads.</p>
				<nav aria-label="Getting started with Delphi">
					<a href="/connect#plugins">Codex &amp; Claude Code plugins</a>
					<a href="/connect#cli">Delphi CLI</a>
					<a href="/connect#mcp">Remote MCP</a>
					<a href="/prompts">Daily paper picks</a>
				</nav>
			</div>
		</section>
	);
	if (view === 'mine') {
		return (
			<>
				{welcome}
				<FeedTabs view="mine" q={q} />
				{notice && <p className="count">{notice}</p>}
				<MyFeed d={d} who={person} q={q} before={seqParam(params.before)} carried={seqParam(params.line)} />
			</>
		);
	}
	// The global list keeps its feed in its links once it was asked for by name, so paging and ordering stay in it.
	const feed = params.feed === 'global' ? 'global' : '';
	// A query error the reader can fix is shown with its fix. Source counts load in parallel with search.
	const [found, sources, divisions] = await Promise.all([
		search(d, q, { sort, page, limit: PAGE_SIZE }).then((res) => ({ res, error: '' }), (e) => {
			if (!(e instanceof QueryError)) throw e;
			return { res: null, error: `${e.message}. ${e.fix}` };
		}),
		sourceCounts(d),
		divisionCounts(d),
	]);
	// The subjects the index really covers: a division with under 1% of the classified records is not offered as a filter.
	const classified = divisions.reduce((n, r) => n + r.n, 0);
	const subjects = divisions.filter((r) => r.n * 100 >= classified).flatMap((r) => DIVISIONS.filter((d) => d.key === r.division).map((d) => ({ ...d, n: r.n })));
	const { res, error } = found;
	const mine = person && res?.results.length ? await myVotes(d, person.login, res.results.map((r) => String(r.id))) : new Map();
	const here = pageHref('/', { feed, q, sort }, page);
	return (
		<>
			{welcome}
			<FeedTabs view="global" q={q} sort={params.sort ?? ''} />
			<form action="/" className="search-bar">
				{feed && <input type="hidden" name="feed" value={feed} />}
				<input name="q" defaultValue={q} placeholder='Search keywords or filters: spin glass, cat:math.NT, is:disputed' aria-label="Search" />
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
			<section className="filter-shelf" aria-label="Browse filters">
				<div className="filter-row">
					<span className="filter-label">Subjects</span>
					<nav className="subjects" aria-label="Subjects">
						{subjects.map((d) => <a key={d.key} href={`/?q=cat:${d.key}`}>{d.name} <span className="n">{d.n.toLocaleString('en')}</span></a>)}
					</nav>
				</div>
				<div className="filter-row">
					<span className="filter-label">Sources</span>
					<nav className="subjects sources" aria-label="Sources">
						{sources.map((r) => {
							const tag = source(r.source);
							return <a key={r.source} href={tag.href} title={tag.title}>{tag.name} <span className="n">{r.n.toLocaleString('en')}</span></a>;
						})}
					</nav>
				</div>
			</section>
			{(error || notice) && <p className="count">{error || notice}</p>}
			{res && <div className="results-heading">
				<p className="count">{res.total.toLocaleString('en')} records</p>
				<HomeOrder q={q} sort={sort} feed={feed} />
			</div>}
			<ol>
				{res?.results.map((r) => {
					const from = original(r), tag = source(r.source);
					return (
					<li key={String(r.id)} className="item">
						<Vote id={String(r.id)} reactions={r.reactions} mine={mine.get(String(r.id))?.value} back={here} />
						<a className="title" href={recordPath(r.id)}>{tex(r.title)}</a>
						{Array.isArray(r.authors) && r.authors.length > 0 && <p className="authors">{r.authors.slice(0, 8).join(', ')}</p>}
						<p className="meta">
							{/* The source tag filters the list; the Source link opens the original work. */}
							<a className="tag" href={tag.href} title={tag.title}>{tag.name}</a>
							{from && <a className="external" href={from.href} rel="external" title={from.href}>Source: {from.host}</a>}
							<span>{date(r.published)}</span>
							{r.subject ? <code>{String(r.subject)}</code> : null}
							<RecordBadges record={r} />
							<span>{tally(r)}</span>
						</p>
					</li>
					);
				})}
			</ol>
			{res && <Pager page={res.page} pages={res.pages} path="/" params={{ feed, q, sort }} />}
		</>
	);
}
