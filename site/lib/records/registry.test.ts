// Submitting links and the forum, on real Postgres (PGlite) with the migrations as written. Sources are
// faked, so this needs no network and no build of the index.
import { strict as assert } from 'node:assert';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { comment as actualComment, post as actualPost } from '#lib/posts/comments.ts';
import { accept, activity, startTopic as actualStartTopic, topic, topics, topicWithPosts, votePost } from '#lib/posts/forum.ts';
import { type Moderator } from '#lib/moderation/moderate.ts';
import { load } from './load.ts';
import { get } from './query.ts';
import { detect, itemOf, resolve } from './resolve.ts';
import { submit as actualSubmit } from './submit.ts';
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

	test('questions, answers and comments; mentions of records; latest activity', async () => {
		const t = await startTopic(db, bot, { title: '  Reproducing  arxiv/1706.03762 ', body: 'Who has rerun table 2 of arxiv/1706.03762?' });
		assert.equal(t.title, 'Reproducing arxiv/1706.03762');
		assert.deepEqual(t.question.mentions, ['arxiv/1706.03762']);
		const first = await post(db, { topic: t.id }, bo, { body: 'Yes, with github/karpathy__nanoGPT.' });
		assert.deepEqual(first.mentions, ['github/karpathy__nanoGPT']);
		const second = await post(db, { topic: t.id }, cy, { body: 'Table 2 reruns within a point on one GPU.' });
		await post(db, { topic: t.id }, ada, { body: 'Which tokenizer?', parent: Number(first.id) });
		await comment(db, 'arxiv/1706.03762', ada, { body: 'A review.', review: true });
		const full = (await topicWithPosts(db, t.id, null))!;
		assert.deepEqual(full.answers.map((a) => a.id), [first.id, second.id].map(Number), 'oldest first while scores tie');
		assert.deepEqual(full.answers[0].comments.map((c) => c.body), ['Which tokenizer?']);
		assert.deepEqual([(await topics(db, null)).questions[0].answers, (await topics(db, null)).questions[0].score], [2, 0]);
		const latest = (await activity(db, { limit: 3 })).posts;
		assert.deepEqual(latest.map((p) => p.title), ['Attention Is All You Need', t.title, t.title]);
		assert.deepEqual([(await get(db, 'arxiv/1706.03762'))?.mentions, (await get(db, 'arxiv/1706.03762'))?.comments], [1, 1]);
	});

	test('answers are voted on and sorted by score; the asker accepts one, and it goes first', async () => {
		const t = (await topics(db, null)).questions[0];
		const [first, second] = (await topicWithPosts(db, t.id, null))!.answers;
		assert.deepEqual(await votePost(db, t.id, second.id, ada, 1), { post: second.id, score: 1 });
		await votePost(db, t.id, second.id, bot, -1); // ada's agent: the same person, so it replaces ada's vote
		assert.equal((await topicWithPosts(db, t.id, null))!.answers[1].score, -1);
		await votePost(db, t.id, second.id, ada, 1);
		await assert.rejects(votePost(db, t.id, first.id, bo, 1), /own post/);
		assert.deepEqual((await topicWithPosts(db, t.id, null))!.answers.map((a) => a.id), [second.id, first.id], 'higher score first');
		await assert.rejects(accept(db, t.id, first.id, bo), /only the asker/);
		await accept(db, t.id, first.id, ada);
		const after = (await topicWithPosts(db, t.id, null))!;
		assert.deepEqual([after.accepted_id, after.answers[0].id, after.answers[0].accepted], [first.id, first.id, true], 'accepted first');
		await votePost(db, t.id, after.question.id, cy, 1);
		assert.equal((await topic(db, t.id, null))?.score, 1, 'a vote on the question is the question\'s score, kept on the topic');
		await votePost(db, t.id, after.question.id, cy, 0);
		assert.equal((await topic(db, t.id, null))?.score, 0);
		await accept(db, t.id, first.id, ada);
		assert.equal((await topic(db, t.id, null))?.accepted_id, null, 'accepting again takes it back');
		await assert.rejects(accept(db, t.id, after.question.id, ada), /not an answer/);
	});

});
