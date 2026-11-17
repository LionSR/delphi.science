import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { migratedDb } from '#lib/testing.ts';
import { QueryError } from '#lib/errors.ts';
import { SUBSCRIPTION_CATEGORIES } from './subscription-categories.ts';
import { isSubjectCode } from './taxonomy.ts';
import { load } from './load.ts';
import { search, SORTS } from './query.ts';

let db: PGlite;
const selected = ['math', 'math.NT', 'quant-ph']; // overlapping broad and narrow subjects
const expected = ['app/feed-5', 'app/feed-4', 'app/feed-3', 'app/feed-2', 'app/feed-1'];
const ids = (res: Awaited<ReturnType<typeof search>>) => res.results.map((r) => String(r.id));

before(async () => {
	db = await migratedDb();
	await load(db, ['math.NT', 'math.AG', 'quant-ph', 'math.NT', 'quant-ph', 'cs.LG'].map((subject, i) => ({
		id: `app/feed-${i + 1}`, source: 'app', url: `https://example.org/feed-${i + 1}`,
		title: 'Boundary calculation', subject, division: subject.startsWith('math') ? 'math' : subject === 'quant-ph' ? 'physics' : 'cs',
		published: `2026-10-0${i + 1}`, tags: ['quant-ph', 'math.NT'],
	})));
	// Put a selected and an out-of-scope record into the ranked hot branch.
	await db.query("INSERT INTO open_index.votes (record_id, voter, value) VALUES ('app/feed-1', 'ada', 1), ('app/feed-6', 'ada', 1)");
	await db.query("UPDATE open_index.records SET mentions_count = 1 WHERE id IN ('app/feed-2', 'app/feed-6')");
});
after(() => db.close());

test('the complete category catalog is compatible with existing subject search', () => {
	for (const code of Object.keys(SUBSCRIPTION_CATEGORIES)) assert.ok(isSubjectCode(code), code);
});

test('multi-category union deduplicates overlaps; counts and pages stay scoped', async () => {
	const first = await search(db, '', { categories: selected, sort: 'newest', limit: 2 });
	assert.equal(first.total, 5); assert.equal(first.pages, 3);
	assert.deepEqual(ids(first), expected.slice(0, 2));
	const second = await search(db, '', { categories: selected, sort: 'newest', limit: 2, page: 2 });
	assert.deepEqual(ids(second), expected.slice(2, 4));
	assert.deepEqual(ids(await search(db, '', { categories: selected, sort: 'newest', limit: 2, page: 3 })), expected.slice(4));
	assert.equal(new Set([...ids(first), ...ids(second)]).size, 4);
});

test('OR searches intersect subscriptions; malformed parentheses cannot escape the scope', async () => {
	const query = 'id:app/feed-1 OR source:app';
	assert.deepEqual(ids(await search(db, query, { categories: selected, sort: 'newest' })), expected);
	assert.equal((await search(db, 'cat:cs.LG', { categories: selected })).total, 0);
	await assert.rejects(search(db, 'id:app/feed-1) OR (source:app', { categories: selected }), QueryError);
	assert.equal((await search(db, '', { categories: [], sort: 'week' })).total, 0);
	assert.equal((await search(db, '', { sort: 'week' })).total, 6);
});

test('all sorts retain scope, with consistent counts and no duplication through ranked hot/cold pages', async () => {
	for (const sort of SORTS) {
		const all = await search(db, 'ti:boundary', { categories: selected, sort });
		assert.equal(all.total, 5, sort);
		assert.deepEqual([...ids(all)].sort(), [...expected].sort(), sort);
		const paged: string[] = [];
		for (let page = 1; page <= 3; page++) paged.push(...ids(await search(db, 'ti:boundary', { categories: selected, sort, limit: 2, page })));
		assert.deepEqual(paged, ids(all), sort);
	}
	assert.equal(ids(await search(db, '', { categories: selected, sort: 'week' }))[0], 'app/feed-1');
	assert.equal(ids(await search(db, '', { categories: selected, sort: 'mentions' }))[0], 'app/feed-2');
	assert.deepEqual(ids(await search(db, '', { categories: selected, sort: 'oldest' })), [...expected].reverse());
});

test('cross-list tags alone do not match; non-arXiv records use their indexed subject', async () => {
	assert.deepEqual(ids(await search(db, '', { categories: ['quant-ph'], sort: 'newest' })), ['app/feed-5', 'app/feed-3']);
	assert.equal((await search(db, '', { categories: ['physics.optics'] })).total, 0);
});

test('arXiv primary and secondary categories match, deduplicate, and support broad divisions; arbitrary tags do not', async () => {
	await load(db, [
		{ id: 'arxiv/2611.00001', source: 'arxiv', title: 'Cross-listed fixture', url: 'https://arxiv.org/abs/2611.00001', subject: 'math.NT', division: 'math', arxiv_categories: ['math.NT', 'quant-ph'] },
		{ id: 'arxiv/2611.00002', source: 'arxiv', title: 'Freeform tags fixture', url: 'https://arxiv.org/abs/2611.00002', subject: 'math.AG', division: 'math', tags: ['quant-ph', 'physics.optics'] },
		{ id: 'app/cross-fake', source: 'app', title: 'Non-arXiv tags fixture', url: 'https://example.org/fake', subject: 'cs.LG', arxiv_categories: ['quant-ph'] },
	]);
	const q = 'source:arxiv OR id:app/cross-fake';
	for (const categories of [['quant-ph'], ['physics'], ['math.NT', 'quant-ph']]) {
		assert.deepEqual(ids(await search(db, q, { categories })), ['arxiv/2611.00001']);
	}
	assert.deepEqual(ids(await search(db, `${q} cat:physics`, { categories: ['quant-ph'] })), ['arxiv/2611.00001']);
	assert.equal((await search(db, 'source:arxiv cat:quant-ph')).total, 1);
	assert.deepEqual(ids(await search(db, 'source:arxiv NOT cat:quant-ph')), ['arxiv/2611.00002'], 'Missing dedicated metadata is false, not SQL NULL, under NOT');
	assert.equal((await search(db, '', { categories: ['physics.optics'] })).total, 0);
});

test('equal relevance and dates have a deterministic ID order over repeated pages', async () => {
	await load(db, Array.from({ length: 5 }, (_, i) => ({ id: `app/tied-${i}`, source: 'app', title: 'Tied evidence', url: `https://example.org/tied-${i}`, subject: 'math.NT', published: '2026-11-01' })));
	for (let repeat = 0; repeat < 2; repeat++) {
		const found: string[] = [];
		for (let page = 1; page <= 3; page++) found.push(...ids(await search(db, 'ti:tied', { categories: ['math.NT'], sort: 'relevance', page, limit: 2 })));
		assert.deepEqual(found, Array.from({ length: 5 }, (_, i) => `app/tied-${i}`));
	}
});
