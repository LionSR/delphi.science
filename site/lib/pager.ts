// Numbered page links under the website's lists (paging is described in lib/paging.ts): Previous, the first and last
// pages, the pages next to the current one, and Next. Uses createElement instead of JSX so lib/pager.test.ts runs
// without a JSX build.
import { createElement as h } from 'react';
import { MAX_PAGE } from './paging.ts';

/** How many items the website's lists show to a page. */
export const PAGE_SIZE = 50;

/** A ?page= value as a page number: a whole number from 1 to MAX_PAGE, else the first page. */
export function pageParam(value: string | string[] | undefined): number {
	const n = Number(value);
	return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}

/** `path` with the non-empty `params`, plus ?page= for any page after the first. */
export function pageHref(path: string, params: Record<string, string>, page = 1): string {
	const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
	if (page > 1) query.set('page', String(page));
	return query.size ? `${path}?${query}` : path;
}

/** The pages to link, in order, with null for each run of skipped pages: 1 … 5 6 7 … 20. A run of one page is shown
 * rather than skipped. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
	const near = (p: number) => p === 1 || p === pages || Math.abs(p - page) <= 1;
	const out: (number | null)[] = [];
	for (let p = 1; p <= pages; p++) {
		if (near(p) || (near(p - 1) && near(p + 1))) out.push(p);
		else if (out.at(-1) !== null) out.push(null);
	}
	return out;
}

const chevron = (d: string) => h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
	h('path', { d, fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }));

/**
 * Links to each page of a list at `path` with `params`. Nothing when the list fits on its first page; past the end,
 * Previous leads back to the last page.
 */
export function Pager({ page, pages, path, params }: { page: number; pages: number; path: string; params: Record<string, string> }) {
	if (pages <= 1 && page === 1) return null;
	const href = (p: number) => pageHref(path, params, p);
	return h('nav', { className: 'pager', 'aria-label': 'Pages' },
		page > 1 && h('a', { href: href(Math.min(page - 1, pages)), rel: 'prev', 'aria-label': 'Previous page' },
			chevron('M10 3.5 5.5 8l4.5 4.5'), h('span', null, 'Previous')),
		...pageNumbers(page, pages).map((p, i) => p === null ? h('span', { key: `gap-${i}`, className: 'gap' }, '…')
			: h('a', { key: p, href: href(p), 'aria-current': p === page ? 'page' : undefined }, p)),
		page < pages && h('a', { href: href(page + 1), rel: 'next', 'aria-label': 'Next page' },
			h('span', null, 'Next'), chevron('M6 3.5 10.5 8 6 12.5')));
}
