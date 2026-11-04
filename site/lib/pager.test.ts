import { strict as assert } from 'node:assert';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { Pager, pageNumbers, pageParam } from '#app/pager.ts';

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

test('the pager links every page and marks this one; one page needs none', () => {
	const href = (p: number) => `/?page=${p}`;
	assert.equal(renderToStaticMarkup(createElement(Pager, { page: 1, total: 50, size: 50, href })), '');
	const html = renderToStaticMarkup(createElement(Pager, { page: 2, total: 120, size: 50, href }));
	assert.match(html, /href="\/\?page=1" rel="prev">Previous/);
	assert.match(html, /href="\/\?page=2" aria-current="page">2</);
	assert.match(html, /href="\/\?page=3" rel="next">Next/);
	const last = renderToStaticMarkup(createElement(Pager, { page: 3, total: 120, size: 50, href }));
	assert.doesNotMatch(last, /Next/);
});
