import { strict as assert } from 'node:assert';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { Pager, pageHref, pageNumbers, pageParam } from '#app/pager.ts';

test('page numbers show the ends and the pages around this one, and skip the rest', () => {
	assert.deepEqual(pageNumbers(1, 1), [1]);
	assert.deepEqual(pageNumbers(1, 7), [1, 2, 3, null, 7]);
	assert.deepEqual(pageNumbers(6, 20), [1, null, 4, 5, 6, 7, 8, null, 20]);
	assert.deepEqual(pageNumbers(5, 20), [1, 2, 3, 4, 5, 6, 7, null, 20], 'a skip of one page shows the page instead');
	assert.deepEqual(pageNumbers(20, 20), [1, null, 18, 19, 20]);
});

test('a page parameter that is not a page number reads as the first page', () => {
	for (const v of [undefined, '', '0', '-2', '1.5', 'x', '9999999', ['2', '3']]) assert.equal(pageParam(v), 1, String(v));
	assert.equal(pageParam('3'), 3);
});

test('page links keep the non-empty parameters and name every page after the first', () => {
	assert.equal(pageHref('/forum', { q: '' }), '/forum');
	assert.equal(pageHref('/forum', { q: '' }, 3), '/forum?page=3');
	assert.equal(pageHref('/', { q: 'cat:math.NT', sort: 'newest' }, 1), '/?q=cat%3Amath.NT&sort=newest');
});

test('the pager links every page and marks this one; one page needs none', () => {
	const pager = (page: number, total: number) => renderToStaticMarkup(createElement(Pager, { page, total, path: '/', params: { sort: 'newest' } }));
	assert.equal(pager(1, 50), '');
	const html = pager(2, 120);
	assert.match(html, /href="\/\?sort=newest" rel="prev">Previous/);
	assert.match(html, /href="\/\?sort=newest&amp;page=2" aria-current="page">2</);
	assert.match(html, /href="\/\?sort=newest&amp;page=3" rel="next">Next/);
	assert.doesNotMatch(pager(3, 120), /Next/);
});

test('out-of-range pages keep recovery links, including empty and single-page lists', () => {
	for (const path of ['/', '/forum']) {
		const params = { q: 'cat:math.NT au:"A & B"', sort: 'newest' };
		const pager = (page: number, total: number) => renderToStaticMarkup(createElement(Pager, { page, total, path, params }));
		for (const total of [0, 1, 49, 50, 51, 100, 101]) {
			const last = Math.max(1, Math.ceil(total / 50));
			if (last === 1) assert.equal(pager(1, total), '', `no pager on page 1 with ${total} items`);
			for (const page of [last + 1, 1000]) {
				const html = pager(page, total);
				const previous = html.match(/href="([^"]+)" rel="prev">Previous/);
				assert.ok(previous, `${path} page ${page} with ${total} items has a way back`);
				const url = new URL(previous[1].replaceAll('&amp;', '&'), 'https://example.test');
				assert.equal(url.pathname, path);
				assert.deepEqual(Object.fromEntries(url.searchParams), { ...params, ...(last > 1 ? { page: String(last) } : {}) });
				assert.doesNotMatch(html, /rel="next"|aria-current="page"/);
				assert.match(html, />1<\/a>/);
			}
		}
	}
});
