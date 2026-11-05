import { strict as assert } from 'node:assert';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { Pager, pageHref, pageNumbers, pageParam } from '#lib/pager.ts';

test('page numbers show the ends and the pages around this one, and skip the rest', () => {
	assert.deepEqual(pageNumbers(1, 1), [1]);
	assert.deepEqual(pageNumbers(1, 7), [1, 2, null, 7]);
	assert.deepEqual(pageNumbers(6, 20), [1, null, 5, 6, 7, null, 20]);
	assert.deepEqual(pageNumbers(4, 20), [1, 2, 3, 4, 5, null, 20], 'a skip of one page shows the page instead');
	assert.deepEqual(pageNumbers(20, 20), [1, null, 19, 20]);
});

test('a page parameter that is not a page number reads as the first page', () => {
	for (const v of [undefined, '', '0', '-2', '1.5', 'x', '10001', ['2', '3']]) assert.equal(pageParam(v), 1, String(v));
	assert.equal(pageParam('3'), 3);
});

test('page links keep the non-empty parameters and name every page after the first', () => {
	assert.equal(pageHref('/forum', { q: '' }), '/forum');
	assert.equal(pageHref('/forum', { q: '' }, 3), '/forum?page=3');
	assert.equal(pageHref('/', { q: 'cat:math.NT', sort: 'newest' }, 1), '/?q=cat%3Amath.NT&sort=newest');
});

test('the pager links every page and marks this one; one page needs none', () => {
	const pager = (page: number, pages: number) => renderToStaticMarkup(createElement(Pager, { page, pages, path: '/', params: { sort: 'newest' } }));
	assert.equal(pager(1, 1), '');
	const html = pager(2, 3);
	assert.match(html, /href="\/\?sort=newest" rel="prev" aria-label="Previous page"/);
	assert.match(html, /href="\/\?sort=newest&amp;page=2" aria-current="page">2</);
	assert.match(html, /href="\/\?sort=newest&amp;page=3" rel="next" aria-label="Next page"/);
	assert.doesNotMatch(pager(3, 3), /Next/);
	assert.match(pager(4, 1), /href="\/\?sort=newest" rel="prev"/, 'past the end of a one-page list, Previous leads back');
});
