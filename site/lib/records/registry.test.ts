// Submitting links and the forum, on real Postgres (PGlite) with the migrations as written. Sources are
// faked, so this needs no network and no build of the index.
import { createHash } from 'node:crypto';
import { publicWebTarget, readPublicWeb, type SourceTransport } from '#lib/moderation/source-fetch.ts';
import { strict as assert } from 'node:assert';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { comment as actualComment, post as actualPost } from '#lib/posts/comments.ts';
import { accept, activity, startTopic as actualStartTopic, topic, topics, topicWithPosts, votePost } from '#lib/posts/forum.ts';
import { screen, type Moderator } from '#lib/moderation/moderate.ts';
import { load } from './load.ts';
import { get } from './query.ts';
import { detect, itemOf, resolve } from './resolve.ts';
import { submit as actualSubmit } from './submit.ts';
import { createAgentKey, voterFromKey } from '#lib/accounts/keys.ts';
import { migratedDb } from '#lib/testing.ts';

const yes: Moderator = async () => ({ decision: 'ACCEPT', reason: 'Test fixture only.', verification_needed: false });
const comment: typeof actualComment = (db, id, voter, c, moderate = yes) => actualComment(db, id, voter, c, moderate);
const post: typeof actualPost = (db, place, voter, c, moderate = yes) => actualPost(db, place, voter, c, moderate);
const startTopic: typeof actualStartTopic = (db, voter, t, moderate = yes) => actualStartTopic(db, voter, t, moderate);
const submit: typeof actualSubmit = (db, link, voter, fetcher, moderate = yes, transport) => actualSubmit(db, link, voter, fetcher, moderate, transport);

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<title>arXiv Query</title><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
<title>Attention Is All
  You Need</title><summary>The dominant sequence transduction models are based on complex recurrent &amp; convolutional networks.</summary>
<author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
<arxiv:primary_category term="cs.CL"/><category term="cs.CL"/><category term="cs.LG"/></entry></feed>`;
const REPO = { full_name: 'karpathy/nanoGPT', html_url: 'https://github.com/karpathy/nanoGPT', name: 'nanoGPT', owner: { login: 'karpathy' },
	description: 'The simplest, fastest repository for training/finetuning medium-sized GPTs.', topics: ['gpt'], created_at: '2022-12-28T00:00:00Z',
	stargazers_count: 40000, private: false };

/** A fetch that answers from a table of URLs, and 404 for anything else. Counts its calls. */
function fake(table: Record<string, string | object>) {
	const f = async (url: string | URL | Request) => {
		f.calls++;
		const body = table[String(url)];
		if (body === undefined) return new Response('not found', { status: 404 });
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
	};
	f.calls = 0;
	return f as typeof f & typeof fetch;
}
const SOURCES = fake({
	'https://export.arxiv.org/api/query?id_list=1706.03762': ATOM,
	'https://api.github.com/repos/karpathy/nanoGPT': REPO,
	'https://api.github.com/repos/karpathy/nanoGPT/contents/': [{ name: 'README.md' }, { name: 'AGENTS.md' }],
	'https://api.github.com/repos/someone/tiny': { ...REPO, full_name: 'someone/tiny', html_url: 'https://github.com/someone/tiny', name: 'tiny', stargazers_count: 0 },
	'https://api.github.com/repos/someone/tiny/contents/': [{ name: 'README.md' }],
	'https://api.github.com/repos/someone/cited': { ...REPO, full_name: 'someone/cited', html_url: 'https://github.com/someone/cited', name: 'cited', stargazers_count: 3 },
	'https://api.github.com/repos/someone/cited/contents/': [{ name: 'CITATION.cff' }],
});

describe('reading a link', () => {
	test('ids match the harvester (sources.py)', () => {
		const id = (u: string) => { const h = detect(u); return h && `${h.source.name}/${h.key}`; };
		assert.equal(id('https://arxiv.org/abs/1706.03762v7'), 'arxiv/1706.03762');
		assert.equal(id('arXiv:2406.01234'), 'arxiv/2406.01234');
		assert.equal(id('github.com/owner/repo.git'), 'github/owner__repo');
		assert.equal(id('https://github.com/o/r/tree/main/src'), 'github/o__r');
		assert.equal(id('10.1038/nature14539'), 'doi/10.1038__nature14539');
		assert.equal(id('10.5281/zenodo.123456'), 'zenodo/123456');
		// The harvester's own adapters read these, so the site does not.
		assert.equal(id('https://github.com/openai/math/blob/main/preprints/X/paper.pdf'), null);
		assert.equal(id('PALOMAR-2026-10-17-000014'), null);
	});
	test('metadata comes from the source', async () => {
		const e = (await resolve('https://arxiv.org/abs/1706.03762v7', SOURCES))!;
		assert.deepEqual([e.source, e.key, e.title, e.authors, e.domain, e.published],
			['arxiv', '1706.03762', 'Attention Is All You Need', ['Ashish Vaswani', 'Noam Shazeer'], 'cs.CL', '2017-06-12']);
		assert.match(String(e.summary), /recurrent & convolutional/);
		const it = itemOf(e); // as index.py to_item serves an entry not labelled yet
		assert.deepEqual([it.id, it.subject, it.division, it.category, 'key' in it], ['arxiv/1706.03762', 'cs.CL', 'cs', 'research', false]);
		const repo = itemOf((await resolve('karpathy/nanoGPT', SOURCES))!);
		assert.deepEqual([repo.id, repo.title, repo.repo, repo.agent_ready], ['github/karpathy__nanoGPT', 'nanoGPT', REPO.html_url, true]);
		await assert.rejects(resolve('https://arxiv.org/abs/2999.99999', SOURCES), /2999/);
	});
});

describe('submitting and the forum, on Postgres', () => {
	let db: PGlite;
	const ada = { login: 'ada', agent: '' }, bot = { login: 'ada', agent: 'Claude Code' }, bo = { login: 'bo', agent: 'Codex' }, cy = { login: 'cy', agent: '' };
	before(async () => {
		db = await migratedDb();
		await load(db, [{ id: 'app/APP-1', source: 'app', url: 'https://agenticpapers.app/papers/APP-1/', repo: 'https://github.com/someone/paper', title: 'An APP paper' }]);
	});

	test('a link the site reads is listed at once, with its metadata', async () => {
		const r = await submit(db, 'https://arxiv.org/abs/1706.03762v7', bot, SOURCES);
		assert.equal(r.status, 'listed');
		const rec = await get(db, 'arxiv/1706.03762');
		assert.equal(rec?.title, 'Attention Is All You Need');
		assert.equal((await get(db, 'github/karpathy__nanoGPT')), null);
		assert.equal((await submit(db, 'karpathy/nanoGPT', ada, SOURCES)).status, 'listed');
		const last = (await db.query<{ record_id: string; voter: string }>('SELECT record_id, voter FROM open_index.submissions ORDER BY id DESC LIMIT 1')).rows[0];
		assert.deepEqual([last.record_id, last.voter], ['github/karpathy__nanoGPT', 'ada']);
		// Stored as an entry, as index.py add stores one, so the daily pull labels and refreshes it.
		const { entry } = (await db.query<{ entry: Record<string, unknown> }>("SELECT entry FROM open_index.entries WHERE id = 'github/karpathy__nanoGPT'")).rows[0];
		assert.deepEqual([entry.key, entry.source, entry.added_by, entry.added], ['karpathy__nanoGPT', 'github', 'ada', new Date().toISOString().slice(0, 10)]);
		assert.equal((await submit(db, 'someone/tiny', ada, SOURCES)).status, 'listed');
		assert.equal((await submit(db, 'someone/cited', ada, SOURCES)).status, 'listed', 'a citable repository is listed whatever its stars');
	});

	test('a public blog uses the existing moderation gate and one attempt, including failed checks', async () => {
		const url = 'https://xiaoliangqi.github.io/blog/posts/what-is-life/', who = { login: 'blog-submitter', agent: '' };
		const html = '<title>What Is Life? -- Question Revisited in the AI Era</title><meta name="description" content="A research essay about physical descriptions of living systems."><meta name="citation_publication_date" content="2026/10/30"><script>' + 'inert theme padding '.repeat(4000) + '</script>';
		const transport: SourceTransport = async t => ({ status: 200, url: t.requestUrl, headers: { 'content-type': 'text/html' }, body: new TextEncoder().encode(html) });
		assert.equal(detect(url)?.source.name, 'web');
		assert.equal(publicWebTarget(url).canonical, url);
		const fetched = await readPublicWeb(url, transport);
		assert.doesNotMatch(JSON.stringify(fetched), /inert theme/);
		assert.equal(fetched.published, '2026-10-30');
		await assert.rejects(submit(db, url, who, SOURCES, async () => ({ decision: 'REQUEST_REVISION', reason: 'Clarify the research scope.', fix: 'Describe the finite model.', verification_needed: false }), transport), /REQUEST_REVISION/);
		const id = 'web/' + createHash('sha1').update(url).digest('hex').slice(0, 12);
		assert.equal(await get(db, id), null);
		assert.equal((await submit(db, url, who, SOURCES, yes, transport)).status, 'listed');
		assert.match(String((await get(db, id))!.title), /What Is Life/);
		assert.equal((await submit(db, url, who, SOURCES, yes, async () => { throw new Error('duplicate must not fetch'); })).status, 'already_listed');
		assert.equal((await db.query('SELECT id FROM open_index.moderations WHERE voter=$1', [who.login])).rows.length, 2);
		const used = (await db.query<{id:number}>('SELECT id FROM open_index.moderations WHERE voter=$1 AND publish', [who.login])).rows[0].id;
		await assert.rejects(screen(db, who, { kind: 'submission', on: 'test', body: 'No reusable reservation.' }, yes, false, undefined, used), /reservation is unavailable/);
	});
	test('thirty failed source requests exhaust the shared budget before any further fetch or model call', async () => {
		const who = { login: 'failed-web-budget', agent: '' }, url = 'https://example.org/missing-research'; let calls = 0;
		const missing: SourceTransport = async t => { calls++; return { status: 404, url: t.requestUrl, headers: {}, body: new Uint8Array() }; };
		const noModel: Moderator = async () => { throw new Error('missing source must not reach moderation'); };
		for (let i = 0; i < 30; i++) await assert.rejects(submit(db, url, who, SOURCES, noModel, missing), /not found/);
		await assert.rejects(submit(db, url, who, SOURCES, noModel, missing), /30 check\/submission attempts/);
		assert.equal(calls, 30);
		assert.equal((await db.query('SELECT id FROM open_index.moderations WHERE voter=$1', [who.login])).rows.length, 30);
		const racing = { login: 'racing-web-budget', agent: '' };
		await db.query("INSERT INTO open_index.moderations (voter,agent,kind,publish,reason) SELECT $1,'','submission',false,'Previous failure' FROM generate_series(1,29)", [racing.login]);
		await Promise.allSettled([1, 2].map(() => submit(db, url, racing, SOURCES, noModel, missing)));
		assert.equal(calls, 31, 'only one concurrent request can use the final attempt');
	});

	test('a record already listed is found by id, URL or repository, without reading the source', async () => {
		const calls = SOURCES.calls;
		assert.deepEqual(await submit(db, 'arXiv:1706.03762', bo, SOURCES), { status: 'already_listed', id: 'arxiv/1706.03762', message: 'already listed as arxiv/1706.03762' });
		assert.equal(SOURCES.calls, calls);
		assert.equal((await submit(db, 'https://github.com/someone/paper', bo, SOURCES)).status, 'already_listed');
	});

	test('links the site cannot read, blocked venues and missing records are refused; 20 a day', async () => {
		await assert.rejects(submit(db, 'https://github.com/owner', bo, SOURCES), /cannot read this link/);
		await assert.rejects(submit(db, 'https://jaigp.org/paper/105', bo, SOURCES), /venue is not listed/);
		await assert.rejects(submit(db, 'https://arxiv.org/abs/2999.99999', bo, SOURCES), /not found or is not public/);
		await assert.rejects(submit(db, 'two words', bo, SOURCES), /one link/);
		// Links added with index.py add count too: one cap per person.
		await db.query(`INSERT INTO open_index.entries (id, entry) SELECT 'web/x' || g, jsonb_build_object('key', 'x' || g, 'source', 'web', 'added_by', 'cy', 'added', $1::text)
			FROM generate_series(1, 20) g`, [new Date().toISOString().slice(0, 10)]);
		await assert.rejects(submit(db, 'arXiv:1801.00001', { login: 'cy', agent: '' }, SOURCES), /20 links today/);
	});

	test('a record labelled harmful is not listed again by submitting it', async () => {
		await db.query(`INSERT INTO open_index.entries (id, entry) VALUES ('arxiv/1706.99999', '{"key": "1706.99999", "source": "arxiv", "review": {"category": "harmful"}}')`);
		assert.equal((await submit(db, 'arXiv:1706.99999', bo, SOURCES)).status, 'already_listed');
		assert.equal(await get(db, 'arxiv/1706.99999'), null);
	});

	test('questions, answers and comments; mentions of records; latest activity', async () => {
		const t = await startTopic(db, bot, { title: '  Reproducing  arxiv/1706.03762 ', body: 'Who has rerun table 2 of arxiv/1706.03762?' });
		assert.equal(t.title, 'Reproducing arxiv/1706.03762');
		assert.deepEqual(t.question.mentions, ['arxiv/1706.03762']);
		const first = await post(db, { topic: t.id }, bo, { body: 'Yes, with github/karpathy__nanoGPT.' });
		assert.deepEqual(first.mentions, ['github/karpathy__nanoGPT']);
		const second = await post(db, { topic: t.id }, cy, { body: 'Table 2 reruns within a point on one GPU.' });
		await post(db, { topic: t.id }, ada, { body: 'Which tokenizer?', parent: Number(first.id) });
		await comment(db, 'arxiv/1706.03762', ada, { body: 'A review.', review: true });
		const full = (await topicWithPosts(db, t.id))!;
		assert.deepEqual(full.answers.map((a) => a.id), [first.id, second.id].map(Number), 'oldest first while scores tie');
		assert.deepEqual(full.answers[0].comments.map((c) => c.body), ['Which tokenizer?']);
		assert.deepEqual([(await topics(db)).questions[0].answers, (await topics(db)).questions[0].score], [2, 0]);
		const latest = (await activity(db, { limit: 3 })).posts;
		assert.deepEqual(latest.map((p) => p.title), ['Attention Is All You Need', t.title, t.title]);
		assert.deepEqual([(await get(db, 'arxiv/1706.03762'))?.mentions, (await get(db, 'arxiv/1706.03762'))?.comments], [1, 1]);
	});

	test('answers are voted on and sorted by score; the asker accepts one, and it goes first', async () => {
		const t = (await topics(db)).questions[0];
		const [first, second] = (await topicWithPosts(db, t.id))!.answers;
		assert.deepEqual(await votePost(db, t.id, second.id, ada, 1), { post: second.id, score: 1 });
		await votePost(db, t.id, second.id, bot, -1); // ada's agent: the same person, so it replaces ada's vote
		assert.equal((await topicWithPosts(db, t.id))!.answers[1].score, -1);
		await votePost(db, t.id, second.id, ada, 1);
		await assert.rejects(votePost(db, t.id, first.id, bo, 1), /own post/);
		assert.deepEqual((await topicWithPosts(db, t.id))!.answers.map((a) => a.id), [second.id, first.id], 'higher score first');
		await assert.rejects(accept(db, t.id, first.id, bo), /only the asker/);
		await accept(db, t.id, first.id, ada);
		const after = (await topicWithPosts(db, t.id))!;
		assert.deepEqual([after.accepted_id, after.answers[0].id, after.answers[0].accepted], [first.id, first.id, true], 'accepted first');
		await votePost(db, t.id, after.question.id, cy, 1);
		assert.equal((await topic(db, t.id))?.score, 1, 'a vote on the question is the question\'s score, kept on the topic');
		await votePost(db, t.id, after.question.id, cy, 0);
		assert.equal((await topic(db, t.id))?.score, 0);
		await accept(db, t.id, first.id, ada);
		assert.equal((await topic(db, t.id))?.accepted_id, null, 'accepting again takes it back');
		await assert.rejects(accept(db, t.id, after.question.id, ada), /not an answer/);
	});

	test('moderation: a refusal tells the author the reason', async () => {
		const refuse: Moderator = async () => ({ decision: 'REQUEST_REVISION', reason: 'Say what you checked.', fix: 'Add the check.', verification_needed: false });
		await assert.rejects(startTopic(db, bo, { title: 'Thoughts?', body: 'Some text about it.' }, refuse), /not posted: REQUEST_REVISION: Say what you checked/);
	});

	test('search, pages, and a feed of what is new', async () => {
		const asked = [];
		for (const w of ['spectral gaps', 'Ramsey numbers', 'Lean coercions']) asked.push(await startTopic(db, { login: `asker-${w}`, agent: '' }, { title: `What is known about ${w}?`, body: `Context on ${w}.` }));
		await post(db, { topic: asked[0].id }, bo, { body: 'See the survey on expander graphs.' });
		const ids = (r: { questions: { id: number }[] }) => r.questions.map((q) => q.id);
		assert.deepEqual(ids(await topics(db, { q: 'Ramsey' })), [asked[1].id]);
		assert.deepEqual(ids(await topics(db, { q: 'expander' })), [asked[0].id], 'answers are searched too');
		assert.deepEqual(ids(await topics(db, { q: '"no such words"' })), []);
		const all = ids(await topics(db));
		const one = await topics(db, { limit: 2 });
		const two = await topics(db, { limit: 2, cursor: one.next_cursor });
		assert.deepEqual([...ids(one), ...ids(two)], all.slice(0, 4), 'pages follow on without gaps or repeats');
		const second = await topics(db, { limit: 2, page: 2 });
		assert.deepEqual([ids(second), second.total, second.page, second.pages], [ids(two), all.length, 2, 2], 'a numbered page matches the cursor page');
		const middle = await topics(db, { limit: 1, page: 2 });
		assert.deepEqual(ids(await topics(db, { limit: 1, cursor: middle.next_cursor })), all.slice(2, 3), 'and its cursor goes on from it');
		const found = await topics(db, { q: 'Lean OR Ramsey', limit: 1, page: 2 });
		assert.deepEqual([found.total, found.page, found.pages, found.next_cursor], [2, 2, 2, null], 'a search pages the same way');
		await assert.rejects(topics(db, { cursor: 'nonsense!' }), /cursor is not valid/);
		const feed = await activity(db, { limit: 100 });
		const mark = feed.since;
		await post(db, { topic: asked[2].id }, bo, { body: 'Coercions insert ↑ casts; see Mathlib.' });
		const fresh = await activity(db, { since: mark });
		assert.deepEqual([fresh.posts.map((p) => p.body), fresh.since > mark], [['Coercions insert ↑ casts; see Mathlib.'], true]);
		assert.deepEqual((await activity(db, { since: fresh.since })).posts, [], 'nothing new since');
	});

	test('a person may post 30 times a day, agents and refused posts included', async () => {
		const dee = { login: 'dee', agent: '' }, deebot = { login: 'dee', agent: 'Claude Code' };
		await startTopic(db, dee, { title: 'A question', body: 'Specific details.' });
		const t = (await topics(db)).questions[0].id;
		const no: Moderator = async () => ({ decision: 'REJECT', reason: 'No.', verification_needed: false });
		await assert.rejects(post(db, { topic: t }, deebot, { body: 'x' }, no), /not posted/);
		for (let i = 2; i < 30; i++) await post(db, { topic: t }, i % 2 ? dee : deebot, { body: `Answer ${i}` });
		await assert.rejects(post(db, { topic: t }, deebot, { body: 'One more.' }), /used 30 check\/submission attempts today, agents included/);
	});

	test('bad questions and replies are refused, and leave nothing behind', async () => {
		const n = (await topics(db)).questions.length;
		await assert.rejects(startTopic(db, bo, { title: '', body: 'x' }), /needs a title/);
		const key = await createAgentKey(db, 'bo', 'Codex');
		await assert.rejects(startTopic(db, bo, { title: 'my key', body: `here: ${key}` }), /contains an agent key/);
		assert.equal(await voterFromKey(db, key), null);
		assert.equal((await topics(db)).questions.length, n, 'the refused question was removed');
		await assert.rejects(post(db, { topic: 999 }, bo, { body: 'x' }), /no topic 999/);
		await assert.rejects(post(db, { topic: NaN }, bo, { body: 'x' }), /no topic/);
		await assert.rejects(post(db, { topic: (await topics(db)).questions[0].id }, bo, { body: 'x', parent: 999 }), /no comment 999/);
	});
});
