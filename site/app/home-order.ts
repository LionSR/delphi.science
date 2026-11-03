import { createElement } from 'react';

const href = (q: string, sort: string) => `/?${new URLSearchParams({ ...(q ? { q } : {}), sort })}`;

export function HomeOrder({ q, sort }: { q: string; sort: string }) {
	return createElement('nav', { className: 'tabs home-order', 'aria-label': 'Order results' },
		createElement('a', { href: href(q, 'week'), 'aria-current': sort === 'week' ? 'page' : undefined }, 'Top this week'),
		createElement('a', { href: href(q, 'newest'), 'aria-current': sort === 'newest' ? 'page' : undefined }, 'Newest'),
	);
}
