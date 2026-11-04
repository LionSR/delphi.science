import { strict as assert } from 'node:assert';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { HomeOrder } from '../app/home-order.ts';

test('homepage order exposes ranking and chronological choices and marks the active one', () => {
	const top = renderToStaticMarkup(createElement(HomeOrder, { q: '', sort: 'week' }));
	assert.match(top, /aria-label="Order results"/);
	assert.match(top, /href="\/\?sort=week" aria-current="page">Top this week/);
	assert.match(top, /href="\/\?sort=newest">Newest/);

	const newest = renderToStaticMarkup(createElement(HomeOrder, { q: 'cat:math.NT', sort: 'newest' }));
	assert.match(newest, /href="\/\?q=cat%3Amath.NT&amp;sort=week">Top this week/);
	assert.match(newest, /href="\/\?q=cat%3Amath.NT&amp;sort=newest" aria-current="page">Newest/);
	assert.doesNotMatch(newest, /cursor=/, 'changing order starts at the first page');
});
