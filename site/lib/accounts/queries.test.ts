// Saved queries, My feed and the read position (docs/my-feed.md).
import { strict as assert } from 'node:assert';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { handle } from '#lib/api/mcp.ts';
import { logTool } from '#lib/api/mcp-tools.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { comment, post } from '#lib/posts/comments.ts';
import { startTopic } from '#lib/posts/forum.ts';
import { head, log } from '#lib/posts/log.ts';
import { load, type Item } from '#lib/records/load.ts';
import { allowRouteImports, migratedDb } from '#lib/testing.ts';
import { addMember, createSpace } from '#lib/posts/spaces.ts';
import { createAgentKey, createSession } from './keys.ts';
import { formText, saveForm, type QueriesFormState } from './queries-form.ts';
import { addQueries, joined, myFeed, openFeed, replaceQueries, savedQueries } from './queries.ts';

allowRouteImports();

const yes: Moderator = async () => ({ decision: 'ACCEPT', reason: 'Private fixture accepted.', verification_needed: false, fix: '' });
const item = (id: string, more: Partial<Item> = {}): Item => ({ id, source: id.split('/')[0], title: `On ${id}`, url: `https://example.org/${id}`,
	summary: 'We bound the endpoint terms of an open chain.', published: '2026-11-01', ...more });
const QP = item('arxiv/2611.00001', { title: 'Entanglement in open chains', subject: 'quant-ph', division: 'physics' });
const NT = item('arxiv/2611.00002', { title: 'Zero-free regions for L-functions', subject: 'math.NT', division: 'math' });
const CO = item('app/APP-1', { title: 'A verified lemma', subject: 'math.CO', division: 'math' });
const ada = { login: 'Ada', agent: '' }, bob = { login: 'bob', agent: 'Codex' }, eve = { login: 'eve', agent: '' };

/** Three records, a review and a reply on the quant-ph one, a forum topic about the number theory one with an answer. */
async function site() {
	const db = await migratedDb();
	await load(db, [QP, NT, CO]); // seq 1, 2, 3
	const review = await comment(db, QP.id, ada, { body: 'Section 2 holds for open boundary conditions only.', review: true }, yes); // 4
	const reply = await comment(db, QP.id, bob, { body: 'With periodic ones the constant doubles.', parent: review.id }, yes); // 5
	const topic = await startTopic(db, ada, { title: 'Does the endpoint term vanish?', body: `It does in ${NT.id}, but why?` }, yes); // 6
	const answer = await post(db, { topic: topic.id }, bob, { body: 'By the symmetry of the chain.' }, yes); // 7
	return { db, review, reply, topic, answer };
}
const seqs = (entries: { seq: number }[]) => entries.map((e) => e.seq);

/** Runs `run` with the MCP server open to spaces and me/queries (ORI_MCP_PRIVATE), or closed to both as it is by
 * default, and puts the switch back. */
async function withMcp<T>(open: boolean, run: () => Promise<T>): Promise<T> {
	const prior = process.env.ORI_MCP_PRIVATE;
	if (open) process.env.ORI_MCP_PRIVATE = 'true'; else delete process.env.ORI_MCP_PRIVATE;
	try { return await run(); } finally { if (prior === undefined) delete process.env.ORI_MCP_PRIVATE; else process.env.ORI_MCP_PRIVATE = prior; }
}

const mcpAsSet = async (db: PGlite, key: string | undefined, name: string, args: object) => {
	const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
	return (await (await handle(req, async () => db)).json()).result as { isError?: boolean; structuredContent?: Record<string, any>; content: { text: string }[]; _meta?: object };
};

/** One MCP tool call with the server open to me/queries, as it is after the release that opens spaces to it. */
const mcp = (db: PGlite, key: string | undefined, name: string, args: object) => withMcp(true, () => mcpAsSet(db, key, name, args));

describe('saved queries belong to the account', () => {
	test('one person\'s queries are not another\'s, a login is one account whatever its case, and nobody has the empty text at revision 0', async () => {
		const db = await migratedDb();
		assert.deepEqual(await savedQueries(db, 'ada'), { text: '', revision: '0', at: null, seen: 0 });
		const saved = await replaceQueries(db, ada, 'cat:quant-ph\nto:@me\n');
		assert.deepEqual([saved.text, saved.revision], ['cat:quant-ph\nto:@me', '1']);
		assert.equal((await savedQueries(db, 'ADA')).text, 'cat:quant-ph\nto:@me');
		assert.equal((await savedQueries(db, 'bob')).text, '');
		await replaceQueries(db, bob, 'cat:math');
		assert.equal((await savedQueries(db, 'ada')).text, 'cat:quant-ph\nto:@me');
		assert.equal((await savedQueries(db, 'bob')).text, 'cat:math');
		assert.equal((await db.query('SELECT 1 FROM open_index.saved_queries')).rows.length, 2);
		await db.close();
	});

	test('any agent key of the person reads, replaces and adds to them over MCP, with the tools as they are; another person\'s key reaches only its own', async () => {
		const { db } = await site();
		const [claude, codex, session, other] = [await createAgentKey(db, 'Ada', 'Claude Code'), await createAgentKey(db, 'Ada', 'Codex'), await createSession(db, 'Ada'), await createAgentKey(db, 'eve', 'Claude Code')];
		// Nobody signed in is asked to sign in, by each verb.
		for (const [name, args] of [['get', { id: 'me/queries' }], ['log', { path: 'me/queries' }], ['post', { id: 'me/queries', body: 'cat:math' }], ['edit', { id: 'me/queries', body: 'cat:math', revision: '0' }]] as const) {
			const r = await mcp(db, undefined, name, args);
			assert.ok(r.isError && r._meta, `${name} without a token`);
		}
		const empty = await mcp(db, claude, 'get', { id: 'me/queries' });
		assert.deepEqual(empty.structuredContent, { id: 'me/queries', login: 'Ada', body: '', revision: '0' });
		// edit replaces the whole text, under the revision get gave.
		const first = await mcp(db, claude, 'edit', { id: 'me/queries', body: '# physics\ncat:quant-ph', revision: '0' });
		assert.deepEqual(first.structuredContent, { id: 'me/queries', body: '# physics\ncat:quant-ph', revision: '1' });
		// Another agent of the same person, and the person's browser session, read the same text.
		for (const key of [codex, session]) assert.equal((await mcp(db, key, 'get', { id: 'me/queries' })).structuredContent!.body, '# physics\ncat:quant-ph');
		// post only adds: a line that is new goes to the end, one that is there already changes nothing.
		const added = await mcp(db, codex, 'post', { id: 'me/queries', body: 'to:@me\ncat:quant-ph' });
		assert.equal(added.structuredContent!.body, '# physics\ncat:quant-ph\nto:@me');
		assert.equal(added.structuredContent!.revision, '2');
		assert.equal((await mcp(db, codex, 'post', { id: 'me/queries', body: 'to:@me' })).structuredContent!.revision, '2');
		// A stale revision is refused and nothing changes; the current one works; the same text again is a safe retry.
		const stale = await mcp(db, claude, 'edit', { id: 'me/queries', body: 'cat:math', revision: '1' });
		assert.ok(stale.isError);
		assert.match(stale.content[0].text, /^edit_conflict: The saved queries changed since you read them\. Nothing was saved\./);
		assert.equal((await savedQueries(db, 'ada')).text, '# physics\ncat:quant-ph\nto:@me');
		assert.equal((await mcp(db, claude, 'edit', { id: 'me/queries', body: 'cat:math', revision: '2' })).structuredContent!.revision, '3');
		assert.equal((await mcp(db, claude, 'edit', { id: 'me/queries', body: 'cat:math', revision: '2' })).structuredContent!.revision, '3');
		// Another person's key sees and changes its own, which is empty, and nothing of Ada's.
		assert.equal((await mcp(db, other, 'get', { id: 'me/queries' })).structuredContent!.body, '');
		assert.deepEqual((await mcp(db, other, 'log', { path: 'me/queries' })).structuredContent!.entries, []);
		await mcp(db, other, 'edit', { id: 'me/queries', body: 'cat:quant-ph', revision: '0' });
		assert.equal((await savedQueries(db, 'ada')).text, 'cat:math');
		assert.equal((await savedQueries(db, 'eve')).text, 'cat:quant-ph');
		await db.close();
	});
});

describe('saving', () => {
	test('the web form: the category boxes only write cat: lines into the text, and a refusal keeps what was sent', async () => {
		const db = await migratedDb();
		assert.equal(formText('cat:math\n', ['quant-ph', 'math', ' hep-th ', '']), 'cat:math\ncat:quant-ph\ncat:hep-th');
		const idle: QueriesFormState = { status: 'idle', text: '', revision: '0', n: 0 };
		const saved = await saveForm(db, 'ada', idle, { text: '# mine\nto:@me', categories: ['quant-ph'], revision: '0' });
		assert.deepEqual(saved, { status: 'saved', text: '# mine\nto:@me\ncat:quant-ph', revision: '1', n: 1, count: 2 });
		assert.equal((await savedQueries(db, 'ada')).text, '# mine\nto:@me\ncat:quant-ph');
		// A bad line, typed or from the box: the form gets its text back and each line's fix, and the stored text stays.
		const failed = await saveForm(db, 'ada', saved, { text: 'kind:paper', categories: ['not a code'], revision: '1' });
		assert.equal(failed.status, 'failed');
		assert.equal(failed.text, 'kind:paper\ncat:not a code');
		assert.deepEqual(failed.problems!.map((p) => p.line), [1]);
		assert.equal((await savedQueries(db, 'ada')).revision, '1');
		// Changed by an agent since the page was opened: the form says so and does not overwrite.
		await addQueries(db, ada, 'cat:math');
		const late = await saveForm(db, 'ada', saved, { text: 'cat:hep-th', categories: [], revision: '1' });
		assert.deepEqual([late.status, late.conflict, late.text], ['failed', true, 'cat:hep-th']);
		assert.equal((await savedQueries(db, 'ada')).text, '# mine\nto:@me\ncat:quant-ph\ncat:math');
		await db.close();
	});
});

test('overlapping section and subject subscriptions page the public thread once, including replies without links', async () => {
	const { db, topic, answer } = await site();
	try {
		const space = await createSpace(db, ada, { title: 'Notebook', about: '' });
		const privateTopic = await startTopic(db, ada, { title: 'Private math question', body: `Compare ${NT.id}`, space: space.id }, yes);
		const privatePath = `ws/${space.id}/${privateTopic.id}/${privateTopic.question.id}`;
		const nested = await post(db, { topic: topic.id }, eve, { body: `Compare ${NT.id} and ${CO.id}`, parent: answer.id }, yes);
		const later = await post(db, { topic: topic.id }, bob, { body: 'This also follows by induction.', parent: nested.id }, yes);
		const expected = [topic.question.id, answer.id, nested.id, later.id].map(id => `forum/${topic.id}/${id}`);
		const lines = ['section:general cat:math', 'section:general by:@bob'];
		await replaceQueries(db, ada, lines.join('\n'));
		await assert.rejects(replaceQueries(db, ada, 'section:methods\nsection:absent'), /line 2.*unknown forum section/);
		assert.deepEqual((await savedQueries(db, ada.login)).text, lines.join('\n'));

		const all = await logTool(db, { q: joined(lines), since: 0 }, ada, 'rest');
		assert.deepEqual(all.entries.map(e => e.path), expected);
		const publicLog = await mcpAsSet(db, undefined, 'log', { q: joined(lines), since: 0 });
		assert.deepEqual(publicLog.structuredContent!.entries, JSON.parse(JSON.stringify(all.entries)));
		assert.deepEqual(all.entries.map(e => e.mentions), [[NT.id], [], [CO.id, NT.id], []]);
		assert.deepEqual((await myFeed(db, ada)).entries.map(e => e.seq), seqs(all.entries).reverse());
		const first = await logTool(db, { path: 'me/queries', since: 0, limit: 2 }, ada, 'rest');
		const next = await logTool(db, { path: 'me/queries', since: first.since, limit: 2 }, ada, 'rest');
		assert.deepEqual([...first.entries, ...next.entries], all.entries);
		const end = await logTool(db, { path: 'me/queries', since: next.since }, ada, 'rest');
		assert.deepEqual([end.entries, end.since], [[], all.since]);
		// The nested comment links a math.CO paper. Its own reply inherits only the opening question's math.NT.
		assert.deepEqual((await log(db, null, {}, { q: 'section:general cat:math.CO' })).entries.map(e => e.path), [expected[2]]);

		assert.ok((await log(db, ada.login)).entries.some(e => e.path === privatePath));
		for (const reader of [null, eve.login, ada.login]) {
			assert.deepEqual((await log(db, reader, {}, { q: 'section:general', since: 0 })).entries.map(e => e.path), expected);
			assert.deepEqual((await log(db, reader, { section: 'general' }, { since: 0 })).entries.map(e => e.path), expected);
		}
		assert.ok(!(await log(db, eve.login, {}, { q: 'section:general OR kind:question' })).entries.some(e => e.path === privatePath));
	} finally { await db.close(); }
});

describe('My feed', () => {
	let s: Awaited<ReturnType<typeof site>>;
	before(async () => { s = await site(); });

	test('is the log for the same queries: what delphi log -f sends as one q, read as the same person', async () => {
		const { db } = s;
		for (const queries of [['cat:quant-ph'], ['cat:quant-ph', 'kind:question'], ['to:@me', 'source:app'], ['re:arxiv/2611.00002', 'kind:record cat:math', 'by:@bob'], ['NOT cat:math']]) {
			await replaceQueries(db, ada, queries.join('\n'));
			const feed = await myFeed(db, ada);
			// The command line joins a file's lines as (a) OR (b) and sends that as q (cli/delphi.mjs queries).
			const asFile = await logTool(db, { q: joined(queries), limit: 50 }, ada, 'rest');
			assert.deepEqual(seqs(feed.entries), seqs(asFile.entries), queries.join(' | '));
			assert.ok(feed.entries.length > 0 && feed.entries.length < 7, `${queries.join(' | ')} narrows the log`);
			assert.deepEqual(seqs((await logTool(db, { path: 'me/queries' }, ada, 'rest')).entries), seqs(feed.entries));
			assert.deepEqual(feed.queries, queries);
		}
		assert.deepEqual(seqs((await myFeed(db, ada)).entries), [5, 4, 1], 'NOT cat:math excludes replies to the math question');
		// Notes and blank lines in the text are not queries.
		await replaceQueries(db, ada, '# what I follow\n\ncat:quant-ph\n');
		assert.deepEqual(seqs((await myFeed(db, ada)).entries), [5, 4, 1]);
	});
});

describe('the read position', () => {
	test('the advance rule: the plain first page of My feed moves it to the end of the log; nothing else does', async () => {
		const { db, topic } = await site();
		await replaceQueries(db, ada, 'cat:quant-ph');
		assert.equal(await head(db), 7);
		// A search, an older page, a link that carries the line, and a browser's prefetch all leave it where it was.
		for (const opts of [{ q: 'kind:review' }, { before: 5 }, { line: 3 }, { prefetch: true }]) {
			assert.equal((await openFeed(db, ada, opts)).advanced, false, JSON.stringify(opts));
			assert.equal((await savedQueries(db, 'ada')).seen, 0);
		}
		// The first plain visit: no line yet (nothing to compare with), and the place moves to the end of the whole log,
		// not to the newest entry of the feed (5): what the person did not follow is not new to them later.
		const first = await openFeed(db, ada);
		assert.deepEqual([first.line, first.advanced, seqs(first.entries)], [0, true, [5, 4, 1]]);
		assert.equal((await savedQueries(db, 'ada')).seen, 7);
		// Something happens: one post in the feed, one outside it.
		await comment(db, QP.id, eve, { body: 'The bound is sharp for N = 2.' }, yes); // 8
		await post(db, { topic: topic.id }, eve, { body: 'Only for even length.' }, yes); // 9
		// The next visit draws the line where the last one ended, and moves the place once it has read the page.
		const second = await openFeed(db, ada);
		assert.deepEqual([second.line, second.advanced, seqs(second.entries)], [7, true, [8, 5, 4, 1]]);
		assert.equal((await savedQueries(db, 'ada')).seen, 9);
		// Opened again, nothing is new; and the place never moves back.
		const third = await openFeed(db, ada);
		assert.deepEqual([third.line, seqs(third.entries)], [9, [8, 5, 4, 1]]);
		await db.close();
	});
});

describe('My feed and private spaces', () => {
	const SECRET = 'the sharper constant is 7/4';
	/** The public site, plus a private space of Ada and Bob with a topic and a reply. Eve is in no space. */
	async function withSpace() {
		const s = await site();
		const space = await createSpace(s.db, ada, { title: 'Draft bound' });
		await addMember(s.db, space.id, ada, 'bob', 'come and check this');
		await addMember(s.db, space.id, bob, 'bob');
		const topic = await startTopic(s.db, ada, { title: 'A sharper endpoint constant?', body: `Unpublished: ${SECRET}.`, space: space.id }, yes);
		const reply = await post(s.db, { topic: topic.id, space: space.id }, bob, { body: `I get the same: ${SECRET}.` }, yes);
		for (const who of [ada, bob, eve]) await replaceQueries(s.db, who, 'kind:question\nby:@bob');
		return { ...s, space: space.id, privateTopic: topic, privateReply: reply };
	}
	const paths = (entries: { path: string }[]) => entries.map((e) => e.path);
	const isPrivate = (path: string) => path.startsWith('ws/');

	test('on the web, over REST and on the command line a member sees their spaces\' posts in My feed; somebody else with the same queries does not', async () => {
		const { db, space, privateTopic, privateReply } = await withSpace();
		const question = `ws/${space}/${privateTopic.id}/${privateTopic.question.id}`, answer = `ws/${space}/${privateTopic.id}/${privateReply.id}`;
		for (const member of [ada, bob]) {
			const feed = await myFeed(db, member);
			assert.deepEqual(paths(feed.entries).filter(isPrivate), [answer, question], member.login);
			// The same entries as log for the same queries, read as the same person through the REST door.
			assert.deepEqual(paths((await logTool(db, { q: joined(feed.queries) }, member, 'rest')).entries), paths(feed.entries));
			assert.deepEqual(paths((await logTool(db, { path: 'me/queries' }, member, 'rest')).entries), paths(feed.entries));
		}
		const outside = await myFeed(db, eve);
		assert.deepEqual(paths(outside.entries).filter(isPrivate), []);
		assert.ok(outside.entries.length > 0 && !JSON.stringify(outside.entries).includes(SECRET));
		// The public part of the feed is the same for all three.
		assert.deepEqual(paths((await myFeed(db, ada)).entries).filter((x) => !isPrivate(x)), paths(outside.entries));
		await db.close();
	});
});
