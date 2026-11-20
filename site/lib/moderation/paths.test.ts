// Moderation on the posting paths, on ephemeral Postgres with scripted verdicts.
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { comment } from '#lib/posts/comments.ts';
import { startTopic } from '#lib/posts/forum.ts';
import { load } from '#lib/records/load.ts';
import type { Moderator, Verdict } from './moderate.ts';
import { submit } from '#lib/records/submit.ts';
import { vote } from '#lib/records/votes.ts';
import { migratedDb } from '#lib/testing.ts';
const ada = { login: 'quality-ada', agent: 'Codex test' };
const accepted: Verdict = { decision: 'ACCEPT', reason: 'Specific checkable research contribution.', verification_needed: false };
const reject: Moderator = async () => ({ decision: 'REJECT', reason: 'Give the missing argument before publication.', verification_needed: false });
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title><summary>A source-fetched research description.</summary><author><name>Ashish Vaswani</name></author><arxiv:primary_category term="cs.CL"/><category term="cs.CL"/></entry></feed>`;
const source: typeof fetch = async () => new Response(ATOM);

describe('publication paths through the shared gate', () => {
	let db: PGlite;
	const count = async (table: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.${table}`)).rows[0].n);
	const counts = (...tables: string[]) => Promise.all(tables.map(count));
	before(async () => {
		db = await migratedDb();
		await load(db, [{ id: 'app/quality-test', source: 'app', url: 'https://example.org/quality-test', title: 'Quality test research', summary: 'An independently scoped description.', repo: 'https://github.com/other/research' }]);
	});
	after(async () => { await db.close(); });
	test('a refused submission, question and comment are not stored and return the moderation error', async () => {
		const before = await counts('entries', 'records', 'submissions', 'topics', 'comments');
		await assert.rejects(submit(db, 'arXiv:1706.03762', ada, source, reject), /not posted: REJECT/);
		await assert.rejects(startTopic(db, ada, { title: 'Boundary terms on an open chain', body: 'Which boundary conditions are assumed?' }, reject), /not posted: REJECT/);
		await assert.rejects(comment(db, 'app/quality-test', ada, { body: 'Which boundary conditions are assumed?' }, reject), /not posted: REJECT/);
		assert.deepEqual(await counts('entries', 'records', 'submissions', 'topics', 'comments'), before);
	});
	test('an accepted submission is stored', async () => {
		const id = 'arxiv/1706.03762';
		const before = await counts('entries', 'records', 'submissions');
		const result = await submit(db, 'arXiv:1706.03762', ada, source, async () => accepted);
		assert.equal(result.status, 'listed'); assert.equal(result.id, id);
		assert.deepEqual(await counts('entries', 'records', 'submissions'), before.map((n) => n + 1));
		assert.equal((await db.query<{ title: string }>('SELECT title FROM open_index.records WHERE id = $1', [id])).rows[0]?.title, 'Attention Is All You Need');
	});
	test('the 31st attempt in a day is refused without a model call', async () => {
		const who = { login: 'budget-user', agent: 'Codex test' };
		await db.query("INSERT INTO open_index.moderations (voter, agent, kind, publish, reason) SELECT $1, $2, 'comment', false, 'REVIEW_NEEDED: previous attempt' FROM generate_series(1, 30)", [who.login, who.agent]);
		let modelCalls = 0;
		await assert.rejects(comment(db, 'app/quality-test', who, { body: 'A bounded technical observation.' }, async () => { modelCalls++; return accepted; }), /used 30 /);
		assert.equal(modelCalls, 0);
	});
	test('development without credentials holds submissions, questions, comments and vote notes', async () => {
		const key = process.env.DEEPSEEK_API_KEY, mode = process.env.NODE_ENV; delete process.env.DEEPSEEK_API_KEY; (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
		try {
			const before = await counts('entries', 'records', 'topics', 'comments', 'votes'), who = { login: 'no-credential', agent: 'Codex test' };
			await assert.rejects(submit(db, 'arXiv:1706.03763', who, async () => new Response(ATOM.replaceAll('1706.03762', '1706.03763'))), /REVIEW_NEEDED/);
			await assert.rejects(startTopic(db, who, { title: 'A held question', body: 'Specific research context.' }), /REVIEW_NEEDED/);
			await assert.rejects(comment(db, 'app/quality-test', who, { body: 'A held comment.' }), /REVIEW_NEEDED/);
			await assert.rejects(vote(db, 'app/quality-test', who, { value: 1, note: 'A held note.' }), /REVIEW_NEEDED/);
			assert.deepEqual(await counts('entries', 'records', 'topics', 'comments', 'votes'), before);
		} finally {
			if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key;
			if (mode === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string | undefined>).NODE_ENV = mode;
		}
	});
});
