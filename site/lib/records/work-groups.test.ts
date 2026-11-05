import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { migratedDb, allowRouteImports, useDb } from '#lib/testing.ts';
import { check, type Item } from '#lib/api/schema.ts';
import { load } from './load.ts';
import { compact, get, search, sourceCounts, SORTS } from './query.ts';
import { mainRecordOf, publicationOf, responseUrl, workOf, workTitleOf, WORK_GROUPS } from './work-groups.ts';
import { vote } from './votes.ts';
import { comment, comments } from '#lib/posts/comments.ts';
import { handle as mcp } from '#lib/api/mcp.ts';

const paper = 'hexagon/2610.00577', repo = 'lean/anthropics__formal-math__eth';
const other = 'openai-math/ETH', unrelated = 'arxiv/paging';
const fixtures: Item[] = [
	{ id: paper, source: 'hexagon', title: 'A 2^o(n) Time Algorithm for 3-SAT', url: 'https://hexagonmath.org/2610.00577v1', published: '2026-10-27', formalized: false, verified: false, authors: ['Claude'], discussion: [
		{ kind: 'web', url: 'https://example.org/response?utm_source=paper', title: 'Response', stance: 'confirms', date: '2026-10-28' },
		{ kind: 'x', url: 'https://twitter.com/person/status/123?s=20' },
	] },
	{ id: repo, source: 'lean', title: 'A 2^o(n) Time Algorithm for 3-SAT — Lean repository', url: 'https://github.com/anthropics/formal-math/tree/main/eth', published: '2026-08-06', formalized: true, verified: false, authors: ['Anthropic'], discussion: [
		{ kind: 'web', url: 'https://EXAMPLE.org:443/response', title: 'Different source title', stance: 'questions', date: '2026-10-29' },
		{ kind: 'x', url: 'https://x.com/another/status/123' },
		{ kind: 'web', url: 'https://example.org/response?utm_medium=repeat' },
		{ kind: 'web', url: 'https://example.org/unique', stance: 'extends' },
	] },
	{ id: other, source: 'openai-math', title: 'A 2^o(n) Time Algorithm for 3-SAT', url: 'https://openai.com/eth', published: '2026-09-01' },
	{ id: unrelated, source: 'arxiv', title: 'Pagination control', url: 'https://arxiv.org/abs/1', published: '2026-10-01' },
];
const accept = async () => ({ decision: 'ACCEPT' as const, reason: 'Fixture', verification_needed: false });

test('URL identity keeps meaningful distinctions and handles tracking, ports and X aliases without conflating response fragments', () => {
	assert.equal(responseUrl('https://EXAMPLE.org:443/a?b=2&utm_campaign=x&a=1#c'), 'https://example.org/a?a=1&b=2#c');
	assert.notEqual(responseUrl('https://mathoverflow.net/questions/42/topic#101'), responseUrl('https://mathoverflow.net/questions/42/topic#102'));
	assert.notEqual(responseUrl('https://github.com/org/repo/issues/1#issuecomment-10'), responseUrl('https://github.com/org/repo/issues/1#issuecomment-11'));
	assert.equal(responseUrl('https://twitter.com/name/status/123?s=20'), responseUrl('https://x.com/i/web/status/123'));
	for (const url of ['https://example.org/A', 'https://example.org/a/', 'https://example.org/a?answer=2', 'https://example.org/a?answer=1']) assert.notEqual(responseUrl(url), 'https://example.org/a');
});

describe('curated work projection on Postgres', () => {
	let db: PGlite;
	before(async () => { db = await migratedDb(); });
	after(async () => { useDb(); await db.close(); });
	beforeEach(async () => { await db.exec('TRUNCATE open_index.records CASCADE'); await load(db, fixtures); });

	test('one work in search, both original identities on exact reads, unrelated ETH stays separate', async () => {
		const found = await search(db, 'ti:algorithm', { fields: 'full' });
		assert.equal(found.total, 2);
		assert.equal(found.count, 2);
		assert.equal(found.results.filter((r) => workOf(r)).length, 1);
		assert.ok(found.results.some((r) => r.id === other && !r.work));
		for (const id of [paper, repo]) {
			const r = (await get(db, id))!;
			assert.equal(r.id, id);
			assert.equal(r.url, fixtures.find((f) => f.id === id)!.url);
			assert.equal(workOf(r)!.sources.length, 2);
			check('Record', r, id);
		}
		check('SearchResult', found, 'grouped search');
	});

	test('canonical main is the official repository independently of ranking, filters and requested source view', async () => {
		assert.equal(WORK_GROUPS[0].main_record_id, repo);
		const views = [];
		for (const sort of SORTS) {
			const r = (await search(db, 'source:lean OR source:hexagon', { sort, fields: 'full' })).results[0];
			views.push(r.id);
			assert.equal(workOf(r)!.main_record_id, repo);
			assert.equal(workOf(r)!.view_record_id, r.id);
			assert.equal(mainRecordOf(r).id, repo);
			assert.equal(mainRecordOf(r).title, fixtures[1].title);
		}
		assert.ok(views.includes(paper) && views.includes(repo), 'ranked source view can vary while canonical main remains stable');
		const exact = (await search(db, `id:${paper}`)).results[0];
		assert.equal(exact.id, paper);
		assert.equal(workOf(exact)!.main_record_id, repo);
		assert.equal(workOf((await get(db, repo))!)!.view_record_id, repo);
		await db.query('DELETE FROM open_index.records WHERE id = $1', [repo]);
		const survivor = (await get(db, paper))!;
		assert.equal(workOf(survivor)!.main_record_id, repo, 'missing main does not silently promote an alternative');
		assert.equal(mainRecordOf(survivor).id, paper, 'available-source display fallback avoids a dead title link');
	});

	test('official-main title preserves its exponent while citation publication never uses repository creation', async () => {
		for (const id of [repo, paper]) {
			const r = (await get(db, id))!;
			assert.equal(workTitleOf(r), 'A 2^{o(n)} Time Algorithm for 3-SAT');
			assert.equal(mainRecordOf(r).id, repo);
			assert.equal(mainRecordOf(r).published, '2026-08-06', 'raw repository creation date retained');
			assert.equal(publicationOf(r)?.published, '2026-10-27', 'citation and JSON-LD publication date comes from paper');
			assert.equal(mainRecordOf(r).title, fixtures[1].title, 'raw title is retained beside corrected display title');
		}
		await db.query('DELETE FROM open_index.records WHERE id = $1', [paper]);
		assert.equal(publicationOf((await get(db, repo))!), undefined, 'omit publication metadata when paper is unavailable, never substitute repo creation');
	});

	test('filters apply to the same source row before grouping, including OR, NOT, IDs and conflicting flags/dates', async () => {
		for (const [q, id] of [
			['source:lean', repo], ['source:hexagon', paper], [`id:${repo}`, repo], [`id:${paper}`, paper],
			['source:lean NOT is:verified', repo], ['is:formalized', repo], ['source:hexagon NOT is:formalized', paper],
			['source:lean published:2026-08', repo], ['source:hexagon published:2026-10', paper],
		] as const) {
			const result = await search(db, q);
			assert.deepEqual(result.results.map((r) => r.id), [id], q);
			assert.equal(result.total, 1, q);
			assert.equal(workOf(result.results[0])!.sources.length, 2, 'other source is visible as context');
		}
		assert.equal((await search(db, 'source:hexagon is:formalized')).total, 0, 'assertions from different members cannot satisfy a conjunction');
		assert.equal((await search(db, 'source:hexagon OR source:lean')).total, 1);
		assert.equal((await search(db, `NOT id:${paper} NOT source:openai-math NOT source:arxiv`)).results[0].id, repo);
		assert.deepEqual((await sourceCounts(db)).map((s) => s.n), [1, 1, 1, 1], 'source inventories stay raw');
	});

	test('all sort modes group before count, numbered pages and cursors; no missing or repeated work', async () => {
		for (const sort of SORTS) {
			const full = await search(db, '', { sort, limit: 20 });
			assert.equal(full.total, 3, sort);
			assert.equal(full.results.length, 3, sort);
			let cursor: string | null | undefined;
			for (let page = 1; page <= 3; page++) {
				const numbered = await search(db, '', { sort, limit: 1, page });
				const next = await search(db, '', { sort, limit: 1, cursor });
				assert.equal(numbered.total, 3, sort);
				assert.equal(numbered.pages, 3, sort);
				assert.deepEqual(numbered.results, full.results.slice(page - 1, page), sort);
				assert.deepEqual(next.results, numbered.results, sort);
				cursor = next.next_cursor;
			}
			assert.equal(cursor, null);
		}
	});

	test('URL union retains all original source assertions and conflicting metadata without changing either record', async () => {
		const r = (await get(db, repo))!, work = workOf(r)!;
		assert.equal(work.discussed, 3, '6 source links, 3 distinct responses');
		assert.equal(work.discussion!.length, 3);
		const shared = work.discussion!.find((l) => responseUrl(l.url).includes('example.org/response'))!;
		assert.equal(shared.assertions.length, 3, 'repeated source links also retain provenance');
		assert.deepEqual(shared.assertions.filter((a) => a.record_id === repo).map((a) => a.link.stance), ['questions', undefined]);
		assert.deepEqual(shared.assertions.filter((a) => a.record_id === paper).map((a) => a.link.stance), ['confirms']);
		assert.equal((r.discussion as unknown[]).length, 4, 'root stays raw/source-bound');
		assert.deepEqual([paper, repo].map((id) => { const r = work.sources.find((s) => s.id === id)!.record; return [r.published, r.formalized, r.authors]; }), [
			['2026-10-27', false, ['Claude']], ['2026-08-06', true, ['Anthropic']],
		]);
		assert.match(work.sources.find((s) => s.id === repo)!.date_meaning, /not paper publication/);
		const short = compact(r);
		assert.equal(workOf(short)!.discussed, 3);
		assert.equal(workOf(short)!.discussion, undefined);
		assert.equal(workOf(short)!.sources.find((s) => s.id === paper)!.record.formalized, false, 'compact sources preserve explicit conflicting assertions');
		assert.ok(workOf(short)!.sources.every((s) => !s.record.work));
		check('Record', short, 'compact group');
	});

	test('absent member never hides its surviving source or produces a phantom record', async () => {
		await db.query('DELETE FROM open_index.records WHERE id = $1', [paper]);
		assert.equal(await get(db, paper), null);
		const found = await search(db, 'ti:algorithm', { sort: 'newest', fields: 'full' });
		assert.equal(found.total, 2);
		const r = found.results.find((r) => r.id === repo)!;
		assert.deepEqual(workOf(r)!.sources.map((s) => s.id), [repo]);
		assert.equal(workOf(r)!.discussed, 3);
		assert.equal((await search(db, 'source:hexagon')).total, 0);
	});

	test('one human interacting on both IDs stays separate; group ranking picks best source, never sums', async () => {
		const who = { login: 'reader', agent: '' };
		for (const id of [paper, repo]) {
			await vote(db, id, who, { value: 1 }, accept);
			await comment(db, id, who, { body: 'Checked this source.', review: true }, accept);
		}
		const before = (await get(db, repo))!;
		const found = await search(db, 'source:hexagon OR source:lean', { sort: 'score', fields: 'full' });
		const r = found.results[0], work = workOf(r)!;
		assert.equal(found.total, 1);
		assert.equal(r.score, 1);
		assert.equal(r.comments, 1);
		assert.deepEqual(work.sources.map((s) => [s.record.score, s.record.comments, s.record.reviews]), [[1, 1, 1], [1, 1, 1]]);
		assert.equal(work.discussed, 3);
		assert.equal((await comments(db, paper)).length, 1);
		assert.equal((await comments(db, repo)).length, 1);
		assert.deepEqual(await get(db, repo), before, 'search makes no writes');
		assert.equal((await db.query('SELECT id FROM open_index.records')).rows.length, 4);
	});

	test('keyword and hybrid relevance preserve matching identities and group pagination', async () => {
		const vector = (i: number) => Array.from({ length: 1024 }, (_, j) => Number(i === j));
		for (const [i, id] of [repo, paper, other].entries()) await db.query('UPDATE open_index.records SET embedding = $1::extensions.vector WHERE id = $2', [`[${vector(i)}]`, id]);
		for (const embedding of [undefined, vector(0)]) {
			const result = await search(db, 'ti:algorithm', { embedding, limit: 1 });
			assert.equal(result.total, 2);
			const page = await search(db, 'ti:algorithm', { embedding, limit: 1, cursor: result.next_cursor });
			assert.notEqual(workOf(result.results[0])?.id ?? result.results[0].id, workOf(page.results[0])?.id ?? page.results[0].id);
			assert.equal(page.next_cursor, null);
		}
		assert.equal((await search(db, `id:${repo}`, { embedding: vector(1) })).results[0].id, repo);
	});

	test('hybrid totals group matching sources even when neither or only one reaches the 200-candidate window', async () => {
		const unit = Array.from({ length: 1024 }, (_, i) => Number(i === 0));
		const controls = Array.from({ length: 201 }, (_, i) => ({ id: `arxiv/control-${String(i).padStart(3, '0')}`, source: 'arxiv', title: 'Control', url: `https://arxiv.org/abs/control-${i}` }));
		await load(db, controls);
		await db.query('UPDATE open_index.records SET embedding = $1::extensions.vector', [`[${unit}]`]);
		const expected = fixtures.length + controls.length - 1;
		const outside = await search(db, '', { sort: 'relevance', embedding: unit, limit: 100 });
		assert.equal(outside.total, expected, 'both members outside candidate window still count as one work');
		assert.ok(outside.results.every((r) => !r.work), 'controls fill the first candidate page');
		await db.query('UPDATE open_index.records SET embedding = NULL WHERE id = ANY($1::text[])', [controls.slice(0, 3).map((r) => r.id)]);
		const oneInside = await search(db, '', { sort: 'relevance', embedding: unit, limit: 100 });
		assert.equal(oneInside.total, expected, 'only one member in candidate window still counts as one work');
		const second = await search(db, '', { sort: 'relevance', embedding: unit, limit: 100, page: 2 });
		assert.equal(second.results.filter((r) => r.work).length, 1);
	});

	test('REST, original redirects and MCP expose group membership while preserving requested source IDs', async () => {
		allowRouteImports(); useDb(db);
		const { GET } = await import('../../app/api/v1/records/[prefix]/[suffix]/route.ts');
		const { GET: redirect } = await import('../../app/id/[prefix]/[suffix]/route.ts');
		const { GET: searchRoute } = await import('../../app/api/v1/search/route.ts');
		const markdown = await (await searchRoute(new Request('http://localhost/api/v1/search?q=source:lean&format=md'))).text();
		assert.ok(markdown.includes(paper) && markdown.includes(repo));
		assert.match(markdown, /3 distinct external responses/);
		assert.match(markdown, /Repository creation; not paper publication/);
		for (const id of [paper, repo]) {
			const [prefix, suffix] = id.split('/');
			const ctx = { params: Promise.resolve({ prefix, suffix }) };
			const res = await GET(new Request(`http://localhost/api/v1/records/${id}`), ctx);
			assert.equal(res.status, 200);
			const json = await res.json();
			assert.equal(json.id, id);
			assert.equal(json.work.sources.length, 2);
			assert.equal((await redirect(new Request(`http://localhost/id/${id}`), ctx)).headers.get('location'), json.url);
		}
		const request = new Request('http://localhost/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { id: repo } } }) });
		const result = (await (await mcp(request, async () => db)).json()).result;
		assert.equal(result.isError, undefined);
		assert.equal(result.structuredContent.id, repo);
		assert.equal(result.structuredContent.work.discussed, 3);
		assert.equal(result.structuredContent.work.main_record_id, repo);
		await db.query('DELETE FROM open_index.records WHERE id = $1', [repo]);
		const fallback = await (await searchRoute(new Request('http://localhost/api/v1/search?q=source:hexagon&format=md'))).text();
		assert.match(fallback, /currently unavailable; showing alternative/);
	});
});
