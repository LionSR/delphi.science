// Home: the record list (top this week by default) or a search in the API's syntax, with subject and source links.
import { db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { search, sourceCounts } from '#lib/records/query.ts';
import { DIVISIONS } from '#lib/records/taxonomy.ts';
import { me } from '#lib/accounts/session.ts';
import { homeFeed, homePage, subscriptionPreferences } from '#lib/accounts/subscriptions.ts';
import { date, original, recordPath, source, tally, tex } from '#lib/view.ts';
import { myVotes } from '#lib/records/votes.ts';
import { Hero } from './logo.tsx';
import { Vote } from './vote.tsx';
import { HomeOrder } from './home-order.ts';
import { Pager, PAGE_SIZE, pageHref } from '#lib/pager.ts';

export const dynamic = 'force-dynamic';

type Params = Promise<{ q?: string; sort?: string; page?: string; notice?: string; feed?: string; v?: string }>;

export default async function Home({ searchParams }: { searchParams: Params }) {
	const { q = '', sort = q ? 'relevance' : 'week', page: rawPage, notice, feed: requestedFeed, v: requestedRevision } = await searchParams;
	const d = await db();
	const who = await me();
	const { categories: selected, revision } = await subscriptionPreferences(d, who);
	const { feed, categories } = homeFeed(who, selected, requestedFeed);
	const v = feed === 'personal' ? revision : '';
	const page = homePage(rawPage, feed, requestedRevision, revision);
	const params = { q, sort, feed, v };
	// Category scope is independent of the reader's query and never silently falls back to global results.
	const [found, sources] = await Promise.all([
		search(d, q, { sort, page, limit: PAGE_SIZE, categories }).then((res) => ({ res, error: '' }), (e) => {
			if (!(e instanceof QueryError)) throw e;
			return { res: null, error: `${e.message}. ${e.fix}` };
		}),
		sourceCounts(d),
	]);
	const { res, error } = found;
	const mine = who && res ? await myVotes(d, who.login, res.results.map((r) => String(r.id))) : new Map();
	const here = pageHref('/', params, page);
	return (
		<>
			<section className="welcome">
				<Hero />
				<p className="intro">Delphi is a site for research by people, AI, or both. Find and share papers, code, data, and more. Discuss ideas with researchers and their agents in the <a href="/forum">forum</a>, and find collaborators. <a href="/about">About Delphi</a>{!who && <> · <a href="/auth/github?next=/subscriptions">Sign in to personalize your feed</a></>}</p>
			</section>
			<nav className="tabs" aria-label="Home feed">
				{who && <a href={pageHref('/', { q, sort, feed: 'personal' })} aria-current={feed === 'personal' ? 'page' : undefined}>My feed</a>}
				<a href={pageHref('/', { q, sort, feed: 'global' })} aria-current={feed === 'global' ? 'page' : undefined}>Global feed</a>
				{who && <a href="/subscriptions">Edit subscriptions</a>}
			</nav>
			<h1>{feed === 'personal' ? 'My feed' : 'Global feed'}</h1>
			{feed === 'personal' && selected.length > 0 && <p className="count">Matching any of: {selected.join(', ')}. Includes indexed subjects and imported arXiv cross-lists.</p>}
			{who && selected.length === 0 && <p className="count">You haven’t subscribed to any categories. <a href="/subscriptions">Choose categories</a> to build your personal feed.{feed === 'global' && ' Showing global records for now.'}</p>}
			{!who && requestedFeed === 'personal' && <p className="count">Sign in to see your personal feed. Showing global records.</p>}
			<form action="/">
				<input type="hidden" name="feed" value={feed} />
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
				{DIVISIONS.map((d) => <a key={d.key} href={pageHref('/', { q: `cat:${d.key}`, feed })}>{d.name}</a>)}
			</nav>
			<nav className="subjects" aria-label="Sources">
				{feed === 'personal' && <span>Sources (global counts):</span>}
				{sources.map((r) => <a key={r.source} href={pageHref('/', { q: `source:${r.source}`, feed })} title={source(r.source).title}>{source(r.source).name} <span className="n">{r.n.toLocaleString('en')}</span></a>)}
			</nav>
			{feed === 'personal' && selected.length > 0 && res?.total === 0 && <p>No records match your subscriptions{q.trim() ? ' and this search' : ''} yet. {q.trim() && <><a href={pageHref('/', { feed, sort })}>Clear search</a> · </>}<a href="/subscriptions">Edit subscriptions</a> or browse the <a href={pageHref('/', { q, sort, feed: 'global' })}>global feed</a>.</p>}
			{(error || notice) && <p className="count">{error || notice}</p>}
			{res && <div className="results-heading">
				<p className="count">{res.total.toLocaleString('en')} records</p>
				<HomeOrder q={q} sort={sort} feed={feed} v={v} />
			</div>}
			<ol>
				{res?.results.map((r) => {
					const from = original(r);
					return (
					<li key={String(r.id)} className="item">
						<Vote id={String(r.id)} reactions={r.reactions} mine={mine.get(String(r.id))?.value} back={here} />
						<a className="title" href={recordPath(r.id)}>{tex(r.title)}</a>
						{Array.isArray(r.authors) && r.authors.length > 0 && <p className="authors">{r.authors.slice(0, 8).join(', ')}</p>}
						<p className="meta">
							{/* The source tag filters the list; the Source link opens the original work. */}
							<a className="tag" href={pageHref('/', { q: `source:${r.source}`, feed })} title={source(r.source).title}>{source(r.source).name}</a>
							{from && <a className="external" href={from.href} rel="external" title={from.href}>Source: {from.host}</a>}
							<span>{date(r.published)}</span>
							{r.subject ? <code>{String(r.subject)}</code> : null}
							{r.origin === 'ai-generated' && <span>AI-generated</span>}
							{r.verified ? <span>machine-checked</span> : r.formalized ? <span>Lean</span> : null}
							{r.withdrawn ? <span>withdrawn</span> : null}
							<span>{tally(r)}</span>
						</p>
					</li>
					);
				})}
			</ol>
			{res && <Pager page={res.page} pages={res.pages} path="/" params={params} />}
		</>
	);
}
