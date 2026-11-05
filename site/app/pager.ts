// Numbered page links under the website's lists: Previous, the first and last pages, the pages around this one, and
// Next. Plain createElement, so lib/pager.test.ts runs without a JSX build.
import { createElement as h } from 'react';

/** How many items the website's lists show to a page. */
export const PAGE_SIZE = 50;

/** The highest page a link may ask for; deeper offsets would overflow the queries' int parameters. */
const MAX_PAGE = 1_000_000;

/** A ?page= value as a page number: a whole number from 1, else the first page. */
export function pageParam(value: string | string[] | undefined): number {
	const n = Number(value);
	return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}

/** Where a page starts in its list. */
export const pageOffset = (page: number) => (page - 1) * PAGE_SIZE;

/** `path` with the non-empty `params`, plus ?page= for any page after the first. */
export function pageHref(path: string, params: Record<string, string>, page = 1): string {
	const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
	if (page > 1) query.set('page', String(page));
	return query.size ? `${path}?${query}` : path;
}

/** The pages to link, in order, with null for each run of skipped pages: 1 … 4 5 6 7 8 … 20. A run of one page is
 * shown rather than skipped. */
export function pageNumbers(page: number, last: number): (number | null)[] {
	const near = (p: number) => p === 1 || p === last || Math.abs(p - page) <= 2;
	const out: (number | null)[] = [];
	for (let p = 1; p <= last; p++) {
		if (near(p) || (near(p - 1) && near(p + 1))) out.push(p);
		else if (out.at(-1) !== null) out.push(null);
	}
	return out;
}

/** Links to pages of a list; hide a single page only when already on it, keeping a way back from past the end. */
export function Pager({ page, total, path, params }: { page: number; total: number; path: string; params: Record<string, string> }) {
	const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
	if (last === 1 && page === 1) return null;
	const href = (p: number) => pageHref(path, params, p);
	return h('nav', { className: 'pager', 'aria-label': 'Pages' },
		page > 1 && h('a', { href: href(Math.min(page - 1, last)), rel: 'prev' }, 'Previous'),
		...pageNumbers(page, last).map((p, i) => p === null ? h('span', { key: `gap-${i}` }, '…')
			: h('a', { key: p, href: href(p), 'aria-current': p === page ? 'page' : undefined }, p)),
		page < last && h('a', { href: href(page + 1), rel: 'next' }, 'Next'));
}
