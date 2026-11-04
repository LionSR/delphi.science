// Numbered page links under a list: Previous, the first and last pages, the pages around this one, and Next.
// Plain createElement, so lib/pager.test.ts runs without a JSX build.
import { createElement as h } from 'react';

/** The highest page a link may ask for; deeper offsets would overflow the queries' int parameters. */
const MAX_PAGE = 1_000_000;

/** A ?page= value as a page number: a whole number from 1, else the first page. */
export function pageParam(value: string | string[] | undefined): number {
	const n = Number(value);
	return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
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

/** Links to every page of `total` items, `size` to a page; nothing when they fit on one. */
export function Pager({ page, total, size, href }: { page: number; total: number; size: number; href: (page: number) => string }) {
	const last = Math.ceil(total / size);
	if (last <= 1) return null;
	return h('nav', { className: 'pager', 'aria-label': 'Pages' },
		page > 1 && h('a', { href: href(Math.min(page - 1, last)), rel: 'prev' }, 'Previous'),
		...pageNumbers(page, last).map((p, i) => p === null ? h('span', { key: `gap-${i}` }, '…')
			: h('a', { key: p, href: href(p), 'aria-current': p === page ? 'page' : undefined }, p)),
		page < last && h('a', { href: href(page + 1), rel: 'next' }, 'Next'));
}
