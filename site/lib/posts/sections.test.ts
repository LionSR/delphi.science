import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { emptyDb, migrations, migratedDb, allowRouteImports, useDb } from '#lib/testing.ts';
import { startTopic, topics, activity, topicWithPosts, votePost, accept } from './forum.ts';
import { post, comment } from './comments.ts';
import { submitPostForm } from './form-submit.ts';
import { SECTION_IDS } from './sections.ts';
import { load } from '#lib/records/load.ts';
import { check } from '#lib/api/schema.ts';
import { createAgentKey } from '#lib/accounts/keys.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { resolve } from '#lib/api/paths.ts';
import { getTool, logTool, postTool } from '#lib/api/mcp-tools.ts';
import { createSpace } from './spaces.ts';

const yes: Moderator = async () => ({ decision: 'ACCEPT', reason: 'Test fixture.', verification_needed: false });
const who = { login: 'section-author', agent: 'test' };
allowRouteImports();

test('migration assigns old topics to General and old inserts still work; DB rejects invalid membership', async () => {
	const db = emptyDb();
	try {
		const all = migrations();
		for (const m of all.filter(m => !m.name.endsWith('_forum_sections.sql'))) await db.exec(m.sql);
		await db.query("INSERT INTO open_index.topics(title,voter,agent) VALUES ('Legacy','old','')");
		await db.exec(all.find(m => m.name.endsWith('_forum_sections.sql'))!.sql);
		await db.query("INSERT INTO open_index.topics(title,voter,agent) VALUES ('Old client','old','')");
		assert.deepEqual((await db.query('SELECT section FROM open_index.topics')).rows, [{ section: 'general' }, { section: 'general' }]);
		await db.query("UPDATE open_index.topics SET section='agents' WHERE title='Legacy'");
		for (const section of ['hidden', '', null]) await assert.rejects(db.query('UPDATE open_index.topics SET section=$1', [section]));
	} finally { await db.close(); }
});

test('section reads, search counts, pages, activity and moderation retain their contracts', async () => {
	const db = await migratedDb(); useDb(db);
	try {
		const legacy = await startTopic(db, who, { title: 'Spectral legacy', body: 'Background.' }, yes);
		assert.equal(legacy.section, 'general');
		const created = [];
		for (const section of SECTION_IDS) for (let i = 0; i < 3; i++) created.push(await startTopic(db, who, { title: `Spectral ${section} ${i}`, body: 'Specific context.', section }, yes));
		const methods = created.filter(t => t.section === 'methods');
		const answer = await post(db, { topic: methods[0].id }, { login: 'responder', agent: '' }, { body: 'A unique eigenvalue computation.' }, yes);
		await votePost(db, methods[0].id, answer.id, who, 1);
		await accept(db, methods[0].id, answer.id, who);
		const detail = await topicWithPosts(db, methods[0].id, null);
		assert.equal(detail!.section, 'methods'); assert.equal(detail!.answers[0].accepted, true); assert.equal(detail!.answers[0].score, 1);
		for (const q of ['', 'spectral']) {
			const first = await topics(db, null, { section: 'methods', q, limit: 2 });
			assert.equal(first.total, 3); assert.equal(first.pages, 2); assert.equal(first.questions.length, 2);
			const second = await topics(db, null, { section: 'methods', q, limit: 2, cursor: first.next_cursor });
			const numbered = await topics(db, null, { section: 'methods', q, limit: 2, page: 2 });
			assert.deepEqual(second.questions, numbered.questions); assert.equal(second.next_cursor, null);
			assert.equal(new Set([...first.questions, ...second.questions].map(t => t.id)).size, 3);
			assert.ok([...first.questions, ...second.questions].every(t => t.section === 'methods'));
			assert.equal((await topics(db, null, { section: 'methods', q, page: 3, limit: 2 })).questions.length, 0);
		}
		assert.equal((await topics(db, null, { section: 'methods', q: 'eigenvalue' })).total, 1);
		assert.equal((await topics(db, null, { section: 'results', q: 'eigenvalue' })).total, 0);
		assert.equal((await topics(db, null)).total, 1 + 3 * SECTION_IDS.length);
		await load(db, [{ id: 'arxiv/1706.03762', source: 'arxiv', url: 'https://arxiv.org/abs/1706.03762', title: 'Record' }]);
		const record = await comment(db, 'arxiv/1706.03762', who, { body: 'Record comment.' }, yes);
		assert.ok((await activity(db)).posts.some(p => p.id === record.id));
		const feed = await activity(db, { section: 'methods', since: 0, limit: 2 });
		const next = await activity(db, { section: 'methods', since: feed.since });
		const posts = [...feed.posts, ...next.posts];
		assert.equal(posts.length, 4); assert.ok(posts.every(p => p.section === 'methods' && p.record_id === null));
		assert.deepEqual(posts.map(p => p.id), posts.map(p => p.id).sort((a,b) => a-b));
		assert.equal((await activity(db, { section: 'methods', since: next.since })).since, next.since);
		const totalBefore = (await topics(db, null)).total;
		for (const section of ['hidden', '', 'cs.AI', 'GENERAL']) {
			await assert.rejects(startTopic(db, who, { title: 'Invalid', body: 'Body', section }, yes), /unknown forum section/);
			await assert.rejects(topics(db, null, { section }), /unknown forum section/);
			await assert.rejects(activity(db, { section }), /unknown forum section/);
		}
		const no: Moderator = async () => ({ decision: 'REJECT', reason: 'Test refusal.', verification_needed: false });
		await assert.rejects(startTopic(db, who, { title: 'Refused', body: 'Body', section: 'methods' }, no), /not posted/);
		assert.equal((await topics(db, null)).total, totalBefore);
		const { GET, POST } = await import('#app/api/v1/forum/route.ts');
		for (const section of SECTION_IDS) {
			const response = await GET(new Request(`http://localhost/api/v1/forum?section=${section}&q=spectral&limit=2`));
			assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control')!, /s-maxage/);
			const page = await response.json(); check('ForumPage', page, 'section route');
			assert.ok(page.questions!.every((t) => t.section === section));
			assert.ok(page.latest_posts!.every((p) => p.section === section));
		}
		assert.equal((await GET(new Request('http://localhost/api/v1/forum?section=hidden'))).status, 400);
		const key = await createAgentKey(db, who.login, 'section-test');
		const invalid = await POST(new Request('http://localhost/api/v1/forum', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Bad', body: 'Body', section: 'hidden' }) }));
		assert.equal(invalid.status, 400);
	} finally { useDb(); await db.close(); }
});

test('form retries include section; omitted sections remain General', async () => {
	const db = await migratedDb();
	try {
		const input = { kind: 'question' as const, title: 'Same title', body: 'Same body', review: false };
		const general = await submitPostForm(db, who, input, yes);
		assert.equal(await submitPostForm(db, who, { ...input, section: 'general' }, yes), general);
		const methods = await submitPostForm(db, who, { ...input, section: 'methods' }, yes);
		assert.notEqual(methods, general);
		assert.equal(await submitPostForm(db, who, { ...input, section: 'methods' }, yes), methods);
		await assert.rejects(submitPostForm(db, who, { ...input, section: 'hidden' }, yes), /unknown forum section/);
	} finally { await db.close(); }
});

test('the agents section has a path: post, log and the form reach it, and a private space has no sections', async () => {
	const db = await migratedDb(); useDb(db);
	const oldFetch = globalThis.fetch, oldKey = process.env.DEEPSEEK_API_KEY;
	try {
		process.env.DEEPSEEK_API_KEY = 'offline-fixture-never-sent';
		globalThis.fetch = (async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: 'ACCEPT', reason: 'Offline fixture.', fix: '', verification_needed: false }) } }] })) as typeof fetch;
		assert.ok(SECTION_IDS.includes('agents'));
		assert.deepEqual(await resolve(db, 'forum/agents', null), { kind: 'forum', section: 'agents' });
		await assert.rejects(resolve(db, 'forum/hidden', null), /no forum\/hidden/);
		const voter = { login: who.login, agent: 'test' };
		const made = await postTool(db, { id: 'forum/agents', title: 'How should an agent cite a failed reproduction?', body: 'Context and what was tried.' }, voter, 'rest');
		const id = Number(String(made.id).split('/')[1]);
		assert.equal((await topicWithPosts(db, id, null))!.section, 'agents');
		const elsewhere = await postTool(db, { id: 'forum', title: 'A general topic', body: 'Context.' }, voter, 'rest');
		assert.equal((await topicWithPosts(db, Number(String(elsewhere.id).split('/')[1]), null))!.section, 'general');
		const inAgents = await logTool(db, { path: 'forum/agents' }, null, 'rest');
		assert.deepEqual(inAgents.entries.map((e) => e.path), [`forum/${id}/${(await topicWithPosts(db, id, null))!.question.id}`]);
		assert.equal((await logTool(db, { path: 'forum' }, null, 'rest')).entries.length, 2);
		assert.equal((await logTool(db, { path: 'forum/methods' }, null, 'rest')).entries.length, 0);
		await assert.rejects(getTool(db, { id: 'forum/agents' }, null, 'rest'), /is a list/);
		const space = await createSpace(db, voter, { title: 'Notebook', about: '' });
		await assert.rejects(startTopic(db, voter, { title: 'Private', body: 'Body', space: space.id, section: 'agents' }, yes), /sections are the public forum/);
		assert.equal((await startTopic(db, voter, { title: 'Private', body: 'Body', space: space.id }, yes)).section, 'general');
		assert.equal((await topics(db, null, { section: 'general' })).total, 1);
	} finally {
		globalThis.fetch = oldFetch;
		if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey;
		useDb(); await db.close();
	}
});
