// Submitting links and the forum, on real Postgres (PGlite) with the migrations as written. Sources are
// faked, so this needs no network and no build of the index.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { comment, post } from './comments.ts';
import { activity, startTopic, topics, topicWithPosts } from './forum.ts';
import { load } from './load.ts';
import { get } from './query.ts';
import { detect, resolve, trim } from './resolve.ts';
import { submissions, submit } from './submit.ts';
import { createAgentKey, voterFromKey } from './votes.ts';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);

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
		assert.equal(id('https://huggingface.co/datasets/openai/gsm8k'), 'huggingface/datasets__openai__gsm8k');
		// The harvester's own adapters read these, so the site leaves them for the daily pull.
		assert.equal(id('https://github.com/openai/math/blob/main/preprints/X/paper.pdf'), null);
		assert.equal(id('https://jaigp.org/paper/105'), null);
	});
	test('metadata comes from the source', async () => {
		const it = await resolve('https://arxiv.org/abs/1706.03762v7', SOURCES);
		assert.deepEqual([it?.id, it?.title, it?.authors, it?.subject, it?.division, it?.published],
			['arxiv/1706.03762', 'Attention Is All You Need', ['Ashish Vaswani', 'Noam Shazeer'], 'cs.CL', 'cs', '2017-06-12']);
		assert.match(String(it?.summary), /recurrent & convolutional/);
		const repo = await resolve('karpathy/nanoGPT', SOURCES);
		assert.deepEqual([repo?.id, repo?.title, repo?.repo, repo?.agent_ready], ['github/karpathy__nanoGPT', 'nanoGPT', REPO.html_url, true]);
		await assert.rejects(resolve('https://arxiv.org/abs/2999.99999', SOURCES), /2999/);
	});
	test('abstracts are trimmed at a word, as sources.py does', () => {
		assert.equal(trim('a '.repeat(400)).length <= 600, true);
		assert.ok(trim('word '.repeat(200)).endsWith('word…'));
	});
});

describe('submitting and the forum, on Postgres', () => {
	const db = new PGlite({ extensions: { vector } });
	const ada = { login: 'ada', agent: '' }, bot = { login: 'ada', agent: 'Claude Code' }, bo = { login: 'bo', agent: 'Codex' };
	before(async () => {
		for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
		await load(db, [{ id: 'app/APP-1', source: 'app', url: 'https://agenticpapers.app/papers/APP-1/', repo: 'https://github.com/someone/paper', title: 'An APP paper' }]);
	});

	test('a link the site reads is listed at once, with its metadata', async () => {
		const r = await submit(db, 'https://arxiv.org/abs/1706.03762v7', bot, SOURCES);
		assert.equal(r.status, 'listed');
		const rec = await get(db, 'arxiv/1706.03762');
		assert.equal(rec?.title, 'Attention Is All You Need');
		assert.equal((await get(db, 'github/karpathy__nanoGPT')), null);
		assert.equal((await submit(db, 'karpathy/nanoGPT', ada, SOURCES)).status, 'listed');
		const [last] = await submissions(db, 1);
		assert.deepEqual([last.record_id, last.voter, last.title], ['github/karpathy__nanoGPT', 'ada', 'nanoGPT']);
	});

	test('a record already listed is found by id, URL or repository, without reading the source', async () => {
		const calls = SOURCES.calls;
		assert.deepEqual(await submit(db, 'arXiv:1706.03762', bo, SOURCES), { status: 'already_listed', id: 'arxiv/1706.03762', message: 'already listed as arxiv/1706.03762' });
		assert.equal(SOURCES.calls, calls);
		assert.equal((await submit(db, 'https://github.com/someone/paper', bo, SOURCES)).status, 'already_listed');
	});

	test('other links wait for the daily pull; missing records are refused; 20 a day', async () => {
		assert.equal((await submit(db, 'https://jaigp.org/paper/105', bo, SOURCES)).status, 'queued');
		assert.equal((await submit(db, 'https://jaigp.org/paper/105', bo, SOURCES)).status, 'queued');
		assert.equal((await db.query('SELECT 1 FROM open_index.submissions WHERE url = $1', ['https://jaigp.org/paper/105'])).rows.length, 1, 'queued once');
		await assert.rejects(submit(db, 'https://arxiv.org/abs/2999.99999', bo, SOURCES), /not found or is not public/);
		await assert.rejects(submit(db, 'two words', bo, SOURCES), /one link/);
		await db.query(`INSERT INTO open_index.submissions (url, voter) SELECT 'https://example.org/' || g, 'cy' FROM generate_series(1, 20) g`);
		await assert.rejects(submit(db, 'https://example.org/new', { login: 'cy', agent: '' }, SOURCES), /20 links today/);
	});

	test('topics: started with a first post, replies, mentions of records, latest activity', async () => {
		const t = await startTopic(db, bot, { title: '  Reproducing  arxiv/1706.03762 ', body: 'Who has rerun table 2 of arxiv/1706.03762?' });
		assert.equal(t.title, 'Reproducing arxiv/1706.03762');
		assert.deepEqual(t.posts[0].mentions, ['arxiv/1706.03762']);
		const reply = await post(db, { topic: t.id }, bo, { body: 'Yes, with github/karpathy__nanoGPT.', parent: Number(t.posts[0].id) });
		assert.deepEqual(reply.mentions, ['github/karpathy__nanoGPT']);
		await comment(db, 'arxiv/1706.03762', ada, { body: 'A review.', review: true });
		const full = await topicWithPosts(db, t.id);
		assert.deepEqual([full?.posts.length, full?.posts[1].parent, (await topics(db))[0].posts], [2, Number(t.posts[0].id), 2]);
		const latest = await activity(db, 3);
		assert.deepEqual(latest.map((p) => p.title), ['Attention Is All You Need', t.title, t.title]);
		assert.deepEqual([(await get(db, 'arxiv/1706.03762'))?.mentions, (await get(db, 'arxiv/1706.03762'))?.comments], [1, 1]);
	});

	test('bad topics and replies are refused, and leave nothing behind', async () => {
		await assert.rejects(startTopic(db, bo, { title: '', body: 'x' }), /needs a title/);
		const key = await createAgentKey(db, 'bo', 'Codex');
		await assert.rejects(startTopic(db, bo, { title: 'my key', body: `here: ${key}` }), /contains an agent key/);
		assert.equal(await voterFromKey(db, key), null);
		assert.equal((await topics(db)).length, 1, 'the refused topic was removed');
		await assert.rejects(post(db, { topic: 999 }, bo, { body: 'x' }), /no topic 999/);
		await assert.rejects(post(db, { topic: NaN }, bo, { body: 'x' }), /no topic/);
		await assert.rejects(post(db, { topic: (await topics(db))[0].id }, bo, { body: 'x', parent: 999 }), /no comment 999/);
	});
});
