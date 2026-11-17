// The home page's two feeds as HTML: which one a request opens, the tabs, what My feed is made of, and its entries
// with the line that marks where the reader left off (docs/my-feed.md). Plain createElement, so the tests render it
// without a JSX build. Nothing here needs JavaScript in the browser: every control is a link or a form.
import { createElement as h, Fragment, type ReactNode } from 'react';
import { isPublicQuery, joined, QUERIES_FILE, QUERIES_PATH, type Feed } from '#lib/accounts/queries.ts';
import { pageOf } from '#lib/posts/atom.ts';
import type { LogEntry } from '#lib/posts/log.ts';
import { pageHref } from '#lib/pager.ts';
import { date, SITE, tex, truncate } from '#lib/view.ts';

export type FeedView = 'mine' | 'global';
export const EDITOR = `/${QUERIES_PATH}`;

/** Which feed a request for the home page opens. A feed that is asked for is the one shown. With none asked for, a
 * link that carries a search, an order or a page opens the global list, so the same link shows everyone the same
 * thing; the bare home page opens My feed for a signed-in person who has saved queries, and the global list otherwise. */
export function chooseFeed(params: { feed?: string; q?: string; sort?: string; page?: string }, signedIn: boolean, hasQueries: boolean): FeedView {
	if (params.feed === 'mine' || params.feed === 'global') return params.feed;
	if (params.q?.trim() || params.sort || params.page) return 'global';
	return signedIn && hasQueries ? 'mine' : 'global';
}

/** A ?before= or ?line= value as a seq, if it is one. */
export const seqParam = (value: string | string[] | undefined): number | undefined => {
	const n = Number(value);
	return typeof value === 'string' && /^-?\d{1,15}$/.test(value) && Number.isSafeInteger(n) ? n : undefined;
};

const mineHref = (q: string, more: Record<string, string> = {}) => pageHref('/', { feed: 'mine', q, ...more });

/** My feed, Global feed, and the way to the saved queries. The search travels with the tab. */
export function FeedTabs({ view, q, sort = '' }: { view: FeedView; q: string; sort?: string }) {
	return h('nav', { className: 'tabs', 'aria-label': 'Feed' },
		h('a', { href: mineHref(q), 'aria-current': view === 'mine' ? 'page' : undefined }, 'My feed'),
		h('a', { href: pageHref('/', { feed: 'global', q, sort }), 'aria-current': view === 'global' ? 'page' : undefined }, 'Global feed'),
		h('a', { href: EDITOR }, 'Saved queries'));
}

const atomHref = (q: string) => `/log.atom?q=${encodeURIComponent(q)}`;

/** What the feed is made of: the saved queries, the same feed as a command, and as Atom where anyone may read it. */
export function FeedSources({ queries }: { queries: string[] }) {
	const everyonePublic = queries.every(isPublicQuery);
	return h('details', { className: 'feed-sources', open: queries.length <= 6 },
		h('summary', null, queries.length === 1 ? 'Showing what matches your saved query' : `Showing what matches any of your ${queries.length} saved queries`),
		h('ul', null, queries.map((q, i) => h('li', { key: i }, h('code', { className: 'tex2jax_ignore' }, q), ' ',
			isPublicQuery(q) ? h('a', { href: atomHref(q), rel: 'alternate', type: 'application/atom+xml' }, 'Atom')
				: h('span', { className: 'muted' }, 'yours alone: no public feed')))),
		h('p', { className: 'count' }, 'The same feed for your agent: ', h('code', null, `delphi log ${QUERIES_PATH} --new`), ', or from its own copy ', h('code', null, `delphi log -f ${QUERIES_FILE} --new`), '. ',
			everyonePublic ? h(Fragment, null, h('a', { href: atomHref(joined(queries)), rel: 'alternate', type: 'application/atom+xml' }, 'All of it as one Atom feed'), ' (public posts and records only). ')
				: 'A query that names you as @me has no Atom feed, because a feed is read by anyone. ',
			h('a', { href: EDITOR }, 'Edit')));
}

/** Nobody is signed in: My feed belongs to an account. */
export const SignInForFeed = () => h('p', { className: 'notice' }, 'My feed is the log narrowed to the queries you save. ',
	h('a', { href: `/auth/github?next=${encodeURIComponent('/?feed=mine')}` }, 'Sign in with GitHub'), ' to see yours, or read the ', h('a', { href: '/?feed=global' }, 'global feed'), '.');

/** Signed in, with no saved queries: say what one is and where to add it. */
export const NoQueries = () => h('div', { className: 'notice' },
	h('p', null, h('strong', null, 'You have no saved queries yet.'), ' A saved query is one line, such as ', h('code', null, 'cat:quant-ph'), ' or ', h('code', null, 'to:@me'),
		'. My feed lists the new records and posts that match any of your lines, newest first: the same list your agent reads with ', h('code', null, `delphi log ${QUERIES_PATH}`), '.'),
	h('p', null, h('a', { href: EDITOR }, 'Add saved queries'), ' · ', h('a', { href: '/?feed=global' }, 'Global feed')));

/** Saved queries, and nothing matches. The global list is offered as a link, never shown in its place. */
export function NoMatches({ q, older }: { q: string; older: boolean }) {
	return h('p', { className: 'notice' },
		older ? 'Nothing older in your feed.' : q ? h(Fragment, null, 'Nothing in your feed matches ', h('code', { className: 'tex2jax_ignore' }, q), '.') : 'Nothing matches your saved queries yet.',
		' ', q && !older ? h('a', { href: pageHref('/', { feed: 'global', q }) }, 'Search everything for it') : h('a', { href: EDITOR }, 'Edit your saved queries'), '.');
}

const KIND: Record<string, string> = { record: 'New record', question: 'Question', answer: 'Reply', comment: 'Comment', review: 'Review' };

/** The page that shows an entry, as a local link. For a post that is new to the reader it carries the line, so the
 * thread can mark the same posts as new that the feed did. */
export function entryHref(e: Pick<LogEntry, 'kind' | 'path'>, line = 0, isNew = false): string {
	// A post in a private space: ws/<slug>/<topic>/<post> is on the topic's page. An invitation or an acceptance
	// (ws/<slug>/members/<login>) is on the list of spaces. Atom's pageOf never meets these: a feed is read as nobody.
	const ws = e.path.match(/^ws\/([^/]+)\/(\d+)\/(\d+)$/);
	if (ws) return `/ws/${ws[1]}/${ws[2]}${isNew && line > 0 ? `?new=${line}` : ''}#p${ws[3]}`;
	if (e.path.startsWith('ws/')) return '/ws';
	const page = pageOf(e).slice(SITE.length);
	if (e.kind === 'record' || !isNew || line <= 0) return page;
	const [path, anchor] = page.split('#');
	return `${path}?new=${line}#${anchor}`;
}

export const UNREAD = 'New since your last visit';

/** The entries, newest first, with one line drawn where the reader left off: above it is what came after `line`.
 * No line is drawn when there is no earlier visit (line 0), or when the page lies wholly on one side of it. */
export function FeedList({ entries, line }: { entries: LogEntry[]; line: number }) {
	const firstSeen = line > 0 ? entries.findIndex((e) => e.seq <= line) : -1;
	const items: ReactNode[] = [];
	entries.forEach((e, i) => {
		if (i === firstSeen && i > 0) {
			items.push(h('li', { key: 'line', className: 'unread-line', id: 'seen', role: 'separator' }, `↑ ${UNREAD} · already seen ↓`));
		}
		const isNew = line > 0 && e.seq > line;
		const author = e.by ? (e.agent ? `${e.agent} · @${e.by}` : `@${e.by}`) : '';
		items.push(h('li', { key: e.seq, className: isNew ? 'item entry new' : 'item entry' },
			h('p', { className: 'meta' },
				h('span', { className: 'tag' }, KIND[e.kind] ?? e.kind),
				isNew && h('span', { className: 'badge' }, 'new'),
				author && h('span', { className: 'tex2jax_ignore' }, author),
				h('span', null, date(e.at)),
				h('code', { className: 'tex2jax_ignore' }, e.path)),
			h('a', { className: 'title', href: entryHref(e, line, isNew) }, tex(e.subject) || e.path),
			e.kind !== 'record' && h('p', { className: 'snippet' }, truncate(e.body.replace(/\s+/g, ' ').trim(), 280))));
	});
	return h('ol', { className: 'feed' }, items);
}

/** One sentence above the first page: how much is new. */
export function NewCount({ entries, line, more }: { entries: LogEntry[]; line: number; more: boolean }) {
	if (line <= 0) return null;
	const n = entries.filter((e) => e.seq > line).length;
	const all = n === entries.length && more;
	return h('p', { className: 'count' }, n ? `${n}${all ? '+' : ''} new since your last visit.` : 'Nothing new since your last visit.');
}

/** Newer and older pages of My feed. The line travels with the links, so it stays where it was for the whole visit. */
export function FeedPager({ q, before, older, line }: { q: string; before?: number; older: number | null; line: number }) {
	if (before === undefined && older === null) return null;
	return h('nav', { className: 'pager', 'aria-label': 'Pages' },
		before !== undefined && h('a', { href: mineHref(q, line > 0 ? { line: String(line) } : {}), rel: 'prev' }, 'Newest'),
		older !== null && h('a', { href: mineHref(q, { before: String(older), ...(line > 0 ? { line: String(line) } : {}) }), rel: 'next' }, 'Older'));
}

/** The body of My feed, under the tabs and the search box: one of its states. `feed` is null for nobody signed in;
 * `error` is a search the reader can fix. */
export function MyFeedBody({ feed, q, before, error = '' }: { feed: (Feed & { line: number }) | null; q: string; before?: number; error?: string }) {
	if (!feed) return h(SignInForFeed);
	if (!feed.queries.length) return h(NoQueries);
	return h(Fragment, null,
		h(FeedSources, { queries: feed.queries }),
		error ? h('p', { className: 'count' }, error)
			: feed.entries.length ? h(Fragment, null,
				before === undefined && h(NewCount, { entries: feed.entries, line: feed.line, more: feed.older !== null }),
				h(FeedList, { entries: feed.entries, line: feed.line }))
				: h(NoMatches, { q, older: before !== undefined }),
		h(FeedPager, { q, before, older: feed.older, line: feed.line }));
}

/** On a thread: how many of its posts are new to the reader, with a link to the first. */
export function NewInThread({ ids, order }: { ids: Set<number>; order: number[] }) {
	const first = order.find((id) => ids.has(id));
	if (first === undefined) return null;
	return h('p', { className: 'count' }, h('a', { href: `#p${first}` }, `${ids.size} new since your last visit`), ' to your feed, marked “new” below.');
}

/** The mark beside a post that is new to the reader. */
export const NewMark = ({ show }: { show: boolean }) => show ? h('span', { className: 'badge new-post' }, 'new') : null;
