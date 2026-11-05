// The homepage's two orders as tabs: top this week and newest. Switching keeps the query and starts at the first page.
// Plain createElement, so lib/home-order.test.ts runs without a JSX build.
import { createElement } from 'react';
import { pageHref } from '#lib/pager.ts';

const href = (q: string, sort: string) => pageHref('/', { q, sort });

export function HomeOrder({ q, sort }: { q: string; sort: string }) {
	return createElement('nav', { className: 'tabs home-order', 'aria-label': 'Order results' },
		createElement('a', { href: href(q, 'week'), 'aria-current': sort === 'week' ? 'page' : undefined }, 'Top this week'),
		createElement('a', { href: href(q, 'newest'), 'aria-current': sort === 'newest' ? 'page' : undefined }, 'Newest'),
	);
}
