// Saved queries, My feed and the read position (docs/my-feed.md): the private table, who may read and replace the
// queries, all-or-nothing saving, the feed as `log -f` of the same queries, the reader's search inside the saved scope,
// the two empty states, which feed a link opens, the unread line and the rule that moves it, and the frozen tool list.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { handle } from '#lib/api/mcp.ts';
import { logTool } from '#lib/api/mcp-tools.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { comment, post } from '#lib/posts/comments.ts';
import { startTopic } from '#lib/posts/forum.ts';
import { head, log } from '#lib/posts/log.ts';
import { load, type Item } from '#lib/records/load.ts';
import { emptyDb, migratedDb, migrations } from '#lib/testing.ts';
import { chooseFeed, entryHref, FeedTabs, MyFeedBody, NewInThread, UNREAD } from '#lib/feed-view.ts';
import { createAgentKey, createSession } from './keys.ts';
import { formText, saveForm, type QueriesFormState } from './queries-form.ts';
import { addQueries, checkQueries, isPublicQuery, joined, markSeen, MAX_QUERIES_TEXT, myFeed, newInThread, openFeed, QueriesError, queryLines, replaceQueries, savedQueries } from './queries.ts';

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
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const rejects = async (run: () => Promise<unknown>) => { try { await run(); } catch (e) { return e as QueriesError; } throw new Error('it did not refuse'); };

const mcp = async (db: PGlite, key: string | undefined, name: string, args: object) => {
	const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
	return (await (await handle(req, async () => db)).json()).result as { isError?: boolean; structuredContent?: Record<string, any>; content: { text: string }[]; _meta?: object };
};

describe('the table', () => {
	test('is private: row level security with no policy, and no grant to the public or to the Data API roles', async () => {
		// As on Supabase: the roles exist, and new tables in the schema are granted to them by default.
		const db = emptyDb();
		await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA IF NOT EXISTS open_index;
			ALTER DEFAULT PRIVILEGES IN SCHEMA open_index GRANT ALL ON TABLES TO anon, authenticated;`);
		for (const m of migrations()) await db.exec(m.sql);
		const t = (await db.query<{ rls: boolean; policies: number }>(`SELECT c.relrowsecurity AS rls,
			(SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c WHERE c.oid = 'open_index.saved_queries'::regclass`)).rows[0];
		assert.deepEqual(t, { rls: true, policies: 0 });
		const grants = (await db.query<{ grantee: string }>(`SELECT grantee FROM information_schema.role_table_grants
			WHERE table_schema = 'open_index' AND table_name = 'saved_queries' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`)).rows;
		assert.deepEqual(grants, []);
		for (const role of ['anon', 'authenticated']) {
			for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
				assert.equal((await db.query<{ ok: boolean }>('SELECT has_table_privilege($1, \'open_index.saved_queries\', $2) AS ok', [role, privilege])).rows[0].ok, false, `${role} ${privilege}`);
			}
		}
		await db.close();
	});

	test('the migration is the last to apply, after the events it points into, and touches no other table', () => {
		const all = migrations();
		const mine = all.at(-1)!;
		assert.match(mine.name, /^\d{14}_saved_queries\.sql$/);
		assert.ok(all.findIndex((m) => m.name.endsWith('_events.sql')) < all.length - 1);
		assert.equal(new Set(all.map((m) => m.name.slice(0, 14))).size, all.length, 'no two migrations share a version');
		const statements = mine.sql.replace(/--.*$/gm, '');
		assert.deepEqual([...statements.matchAll(/\bopen_index\.(\w+)/g)].map((m) => m[1]).filter((t) => t !== 'saved_queries'), []);
		assert.doesNotMatch(statements, /\b(drop|update|delete|truncate)\b/i);
	});
});

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
		// The feed, for an agent with no file: log at me/queries is the log narrowed to the saved queries, with q inside it.
		const feed = await mcp(db, codex, 'log', { path: 'me/queries' });
		assert.deepEqual(seqs(feed.structuredContent!.entries), seqs((await log(db, {}, { q: 'cat:math' })).entries));
		assert.deepEqual(seqs((await mcp(db, codex, 'log', { path: 'me/queries', since: 3 })).structuredContent!.entries), [6]);
		assert.deepEqual(seqs((await mcp(db, codex, 'log', { path: 'me/queries', q: 'kind:record OR cat:quant-ph' })).structuredContent!.entries), [3, 2]);
		// Another person's key sees and changes its own, which is empty, and nothing of Ada's.
		assert.equal((await mcp(db, other, 'get', { id: 'me/queries' })).structuredContent!.body, '');
		assert.deepEqual((await mcp(db, other, 'log', { path: 'me/queries' })).structuredContent!.entries, []);
		await mcp(db, other, 'edit', { id: 'me/queries', body: 'cat:quant-ph', revision: '0' });
		assert.equal((await savedQueries(db, 'ada')).text, 'cat:math');
		assert.equal((await savedQueries(db, 'eve')).text, 'cat:quant-ph');
		// Nothing else lives under me, and the queries are not voted on.
		assert.ok((await mcp(db, claude, 'get', { id: 'me/other' })).isError);
		assert.match((await mcp(db, claude, 'vote', { id: 'me/queries', value: 1 })).content[0].text, /cannot be voted on/);
		await db.close();
	});

	test('tools/list is what it was before saved queries: names, descriptions, schemas, annotations and security, byte for byte', async () => {
		// lib/api/tools-list.json is the reply of the branch this one starts from (claude/log-events). The plugin
		// directories review that reply; a change to it is a change to ask for, not a side effect.
		const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
			headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } });
		const listed = (await (await handle(req, async () => { throw new Error('no database in this test'); })).json()).result;
		assert.equal(`${JSON.stringify(listed, null, '\t')}\n`, readFileSync(new URL('../api/tools-list.json', import.meta.url), 'utf8'));
	});
});

describe('saving', () => {
	test('each line is checked by the log\'s own compiler; every bad line is reported with its fix, and nothing is saved', async () => {
		const db = await migratedDb();
		await replaceQueries(db, ada, 'cat:quant-ph');
		const e = await rejects(() => replaceQueries(db, ada, 'cat:math\nkind:paper\n# a note\n\nre:\n(cat:hep-th'));
		assert.ok(e instanceof QueriesError);
		assert.deepEqual(e.problems.map((p) => [p.line, p.text]), [[2, 'kind:paper'], [5, 're:'], [6, '(cat:hep-th']]);
		assert.match(e.problems[0].message, /^unknown kind:paper$/);
		assert.match(e.problems[0].fix, /^Use kind:record, /);
		assert.match(e.message, /^line 2 \(kind:paper\): unknown kind:paper \(and 2 more: line 5, line 6\)$/);
		assert.match(e.fix, /Nothing was saved\.$/);
		assert.deepEqual(await savedQueries(db, 'ada').then((s) => [s.text, s.revision]), ['cat:quant-ph', '1'], 'the good first line was not saved either');
		// to:@me is the person's own inbox, so it is a line they can save; nobody could.
		assert.equal(checkQueries('to:@me', 'ada'), 'to:@me');
		assert.equal(isPublicQuery('to:@me'), false);
		assert.equal(isPublicQuery('to:@ada cat:math'), true);
		// The text is kept as written: notes, blank lines between, the person's spacing inside a line.
		assert.equal(checkQueries('\r\n# math\r\ncat:math   \r\n\r\n  ti:"zero free"\r\n\r\n', 'ada'), '# math\ncat:math\n\n  ti:"zero free"');
		assert.deepEqual(queryLines('# math\ncat:math\n\n  ti:"zero free"'), ['cat:math', 'ti:"zero free"']);
		// Limits: the text, and the queries as the one query log takes.
		assert.match((await rejects(() => replaceQueries(db, ada, `# ${'x'.repeat(MAX_QUERIES_TEXT)}`))).message, /more than 4000/);
		const many = Array.from({ length: 150 }, (_, i) => `ti:word${i}`).join('\n');
		assert.match((await rejects(() => replaceQueries(db, ada, many))).message, /as one log query, more than 2000/);
		assert.match((await rejects(() => addQueries(db, ada, '# only a note'))).message, /no query to add/);
		assert.equal((await savedQueries(db, 'ada')).revision, '1');
		// The empty text is a save like any other: it clears the feed.
		assert.deepEqual(await replaceQueries(db, ada, '').then((s) => [s.text, s.revision]), ['', '2']);
		await db.close();
	});

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

describe('My feed', () => {
	let s: Awaited<ReturnType<typeof site>>;
	before(async () => { s = await site(); });

	test('is the log for the same queries: what delphi log -f sends as one q, read as the same person', async () => {
		const { db } = s;
		for (const queries of [['cat:quant-ph'], ['cat:quant-ph', 'kind:question'], ['to:@me', 'source:app'], ['re:arxiv/2611.00002', 'kind:record cat:math', 'by:@bob'], ['NOT cat:math']]) {
			await replaceQueries(db, ada, queries.join('\n'));
			const feed = await myFeed(db, ada);
			// The command line joins a file's lines as (a) OR (b) and sends that as q (cli/delphi.mjs queries).
			const asFile = await logTool(db, { q: joined(queries), limit: 50 }, ada);
			assert.deepEqual(seqs(feed.entries), seqs(asFile.entries), queries.join(' | '));
			assert.ok(feed.entries.length > 0 && feed.entries.length < 7, `${queries.join(' | ')} narrows the log`);
			assert.deepEqual(seqs((await logTool(db, { path: 'me/queries' }, ada)).entries), seqs(feed.entries));
			assert.deepEqual(feed.queries, queries);
		}
		assert.deepEqual(seqs((await myFeed(db, ada)).entries), [7, 5, 4, 1], 'newest first');
		// Notes and blank lines in the text are not queries.
		await replaceQueries(db, ada, '# what I follow\n\ncat:quant-ph\n');
		assert.deepEqual(seqs((await myFeed(db, ada)).entries), [5, 4, 1]);
	});

	test('the reader\'s search is inside the saved scope: an OR in it, parentheses or not, reaches nothing outside', async () => {
		const { db } = s;
		await replaceQueries(db, ada, 'cat:quant-ph');
		const whole = seqs((await myFeed(db, ada)).entries);
		assert.deepEqual(whole, [5, 4, 1]);
		for (const q of ['cat:math OR kind:record', 'kind:record OR cat:math OR kind:question', 'zero OR lemma', '(cat:math) OR (cat:quant-ph)', 'NOT cat:quant-ph OR kind:answer', 'kind:review OR by:@bob']) {
			const found = seqs((await myFeed(db, ada, { q })).entries);
			assert.ok(found.every((seq) => whole.includes(seq)), `${q} stayed inside: ${found}`);
		}
		assert.deepEqual(seqs((await myFeed(db, ada, { q: 'cat:math OR kind:record' })).entries), [1]);
		assert.deepEqual(seqs((await myFeed(db, ada, { q: 'cat:math' })).entries), []);
		// Two saved lines are one scope: the search does not attach to the last of them.
		await replaceQueries(db, ada, 'cat:quant-ph\nkind:question');
		assert.deepEqual(seqs((await myFeed(db, ada, { q: 'kind:record' })).entries), [1]);
		assert.deepEqual(seqs((await myFeed(db, ada, { q: 'kind:answer OR kind:record' })).entries), [1]);
		// A search the reader got wrong is theirs to fix; it is not read as a saved query's fault.
		await assert.rejects(() => myFeed(db, ada, { q: 'kind:paper' }), /unknown kind:paper/);
	});

	test('pages by before, newest first, and says when there is nothing older', async () => {
		const { db } = s;
		await replaceQueries(db, ada, 'NOT kind:record OR kind:record');
		const first = await myFeed(db, ada, { limit: 3 });
		assert.deepEqual([seqs(first.entries), first.older], [[7, 6, 5], 5]);
		const second = await myFeed(db, ada, { limit: 3, before: first.older! });
		assert.deepEqual([seqs(second.entries), second.older], [[4, 3, 2], 2]);
		const last = await myFeed(db, ada, { limit: 3, before: second.older! });
		assert.deepEqual([seqs(last.entries), last.older], [[1], null]);
	});

	test('with no saved queries it is empty and says how to start; with queries that match nothing it is empty and stays empty', async () => {
		const { db } = s;
		// No saved queries: nothing is read from the log, and the page explains and links to the editor.
		const none = await openFeed(db, eve);
		assert.deepEqual([none.queries, none.entries, none.advanced], [[], [], false]);
		const explain = html(createElement(MyFeedBody, { feed: none, q: '' }));
		assert.match(text(explain), /^You have no saved queries yet\. A saved query is one line, such as cat:quant-ph or to:@me \. My feed lists the new records and posts that match any of your lines, newest first/);
		assert.match(explain, /<a href="\/me\/queries">Add saved queries<\/a>/);
		assert.doesNotMatch(explain, /class="feed"/);
		// Saved queries, no matches: a different sentence, the queries named, and no entry of the global log in their place.
		await replaceQueries(db, eve, 'cat:hep-th\nto:@me');
		const quiet = await openFeed(db, eve);
		assert.deepEqual([quiet.queries, quiet.entries], [['cat:hep-th', 'to:@me'], []]);
		const nothing = html(createElement(MyFeedBody, { feed: quiet, q: '' }));
		assert.match(text(nothing), /Showing what matches any of your 2 saved queries cat:hep-th Atom to:@me yours alone: no public feed/);
		assert.match(text(nothing), /Nothing matches your saved queries yet\. Edit your saved queries \./);
		assert.doesNotMatch(nothing, /class="feed"|Entanglement|Zero-free/);
		assert.doesNotMatch(text(nothing), /no saved queries yet/);
		// The same with a search that finds nothing in a feed that has entries: the global search is a link, not a list.
		await replaceQueries(db, eve, 'cat:quant-ph');
		const missed = html(createElement(MyFeedBody, { feed: await openFeed(db, eve, { q: 'zero-free' }), q: 'zero-free' }));
		assert.match(text(missed), /Nothing in your feed matches zero-free \. Search everything for it \./);
		assert.match(missed, /href="\/\?feed=global&amp;q=zero-free"/);
		assert.doesNotMatch(missed, /Zero-free regions/);
		// Nobody signed in has no feed: a sign-in link, and the global feed as a link.
		assert.match(text(html(createElement(MyFeedBody, { feed: null, q: '' }))), /Sign in with GitHub to see yours, or read the global feed/);
	});

	test('says which queries it shows, with the same feed as a command and as Atom only where anyone may read it', async () => {
		const { db } = s;
		await replaceQueries(db, ada, 'cat:quant-ph\nkind:question');
		const open = html(createElement(MyFeedBody, { feed: await openFeed(db, ada, { prefetch: true }), q: '' }));
		assert.match(open, /<code class="tex2jax_ignore">cat:quant-ph<\/code> <a href="\/log\.atom\?q=cat%3Aquant-ph" rel="alternate" type="application\/atom\+xml">Atom<\/a>/);
		assert.match(open, /<code>delphi log me\/queries --new<\/code>/);
		assert.match(open, /<code>delphi log -f ~\/\.delphi\/queries --new<\/code>/);
		assert.match(open, /href="\/log\.atom\?q=\(cat%3Aquant-ph\)%20OR%20\(kind%3Aquestion\)"[^>]*>All of it as one Atom feed/);
		// A query that names the reader has no feed, and then neither has the whole.
		await replaceQueries(db, ada, 'cat:quant-ph\nto:@me');
		const mine = html(createElement(MyFeedBody, { feed: await openFeed(db, ada, { prefetch: true }), q: '' }));
		assert.match(mine, /<code class="tex2jax_ignore">to:@me<\/code> <span class="muted">yours alone: no public feed<\/span>/);
		assert.doesNotMatch(mine, /All of it as one Atom feed/);
		assert.match(text(mine), /A query that names you as @me has no Atom feed, because a feed is read by anyone\./);
		assert.equal((mine.match(/log\.atom/g) ?? []).length, 1);
	});
});

describe('which feed a link opens', () => {
	test('a feed asked for by name is shown; a link with a search and no feed is the global list for everyone', () => {
		type Who = [signedIn: boolean, hasQueries: boolean];
		const signedInWithQueries: Who = [true, true], signedIn: Who = [true, false], nobody: Who = [false, false];
		// The bare home page: My feed for somebody who has one, the global list for everybody else.
		assert.equal(chooseFeed({}, ...signedInWithQueries), 'mine');
		assert.equal(chooseFeed({}, ...signedIn), 'global');
		assert.equal(chooseFeed({}, ...nobody), 'global');
		// A shared link: a search, an order or a page, and no feed. The same list whoever opens it.
		for (const params of [{ q: 'cat:math.NT' }, { q: 'cat:math.NT', sort: 'newest' }, { sort: 'week' }, { page: '2' }, { q: 'ti:hodge', feed: 'nonsense' }]) {
			for (const who of [signedInWithQueries, signedIn, nobody]) assert.equal(chooseFeed(params, ...who), 'global', JSON.stringify(params));
		}
		assert.equal(chooseFeed({ q: '  ' }, ...signedInWithQueries), 'mine', 'an empty search box is no search');
		// Asked for by name, with or without a search, signed in or not (the page then says what is missing).
		for (const who of [signedInWithQueries, signedIn, nobody]) {
			assert.equal(chooseFeed({ feed: 'mine', q: 'cat:math' }, ...who), 'mine');
			assert.equal(chooseFeed({ feed: 'global' }, ...who), 'global');
		}
	});

	test('the tabs keep the search and name their feed, so a link copied from either opens the same one', () => {
		const tabs = html(createElement(FeedTabs, { view: 'mine', q: 'kind:review' }));
		assert.match(tabs, /<a href="\/\?feed=mine&amp;q=kind%3Areview" aria-current="page">My feed<\/a>/);
		assert.match(tabs, /<a href="\/\?feed=global&amp;q=kind%3Areview">Global feed<\/a>/);
		assert.match(tabs, /<a href="\/me\/queries">Saved queries<\/a>/);
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
		const news = await comment(db, QP.id, eve, { body: 'The bound is sharp for N = 2.' }, yes); // 8
		await post(db, { topic: topic.id }, eve, { body: 'Only for even length.' }, yes); // 9
		// The next visit draws the line where the last one ended, and moves the place once it has read the page.
		const second = await openFeed(db, ada);
		assert.deepEqual([second.line, second.advanced, seqs(second.entries)], [7, true, [8, 5, 4, 1]]);
		assert.equal((await savedQueries(db, 'ada')).seen, 9);
		// Opened again, nothing is new; and the place never moves back.
		const third = await openFeed(db, ada);
		assert.deepEqual([third.line, seqs(third.entries)], [9, [8, 5, 4, 1]]);
		await db.query('UPDATE open_index.saved_queries SET seen_seq = 50 WHERE login = $1', ['ada']);
		assert.equal(await markSeen(db, ada), 9);
		assert.equal((await savedQueries(db, 'ada')).seen, 50);
		// It is the web's alone: an agent reading, replacing or following the queries moves nothing, and changing the
		// queries does not touch it; nor does moving it change the queries' revision.
		await db.query('UPDATE open_index.saved_queries SET seen_seq = 7 WHERE login = $1', ['ada']);
		const revision = (await savedQueries(db, 'ada')).revision;
		const key = await createAgentKey(db, 'Ada', 'Claude Code');
		await mcp(db, key, 'get', { id: 'me/queries' });
		await mcp(db, key, 'log', { path: 'me/queries' });
		await mcp(db, key, 'log', { path: 'me/queries', since: 0 });
		await mcp(db, key, 'post', { id: 'me/queries', body: 'kind:question' });
		assert.equal((await savedQueries(db, 'ada')).seen, 7);
		assert.ok(!('seen' in (await mcp(db, key, 'get', { id: 'me/queries' })).structuredContent!), 'the tools do not show it either');
		await openFeed(db, ada);
		assert.equal((await savedQueries(db, 'ada')).revision, String(Number(revision) + 1), 'one more for the added line, none for the visit');
		assert.equal(news.id > 0, true);
		await db.close();
	});

	test('the line is drawn once, between what came after the last visit and what was there before', async () => {
		const { db } = await site();
		await replaceQueries(db, ada, 'cat:quant-ph\nkind:answer');
		await openFeed(db, ada); // seen 7
		await comment(db, QP.id, eve, { body: 'The bound is sharp for N = 2.' }, yes); // 8
		await comment(db, QP.id, bob, { body: 'And for N = 3 by the same count.' }, yes); // 9
		const visit = await openFeed(db, ada);
		const page = html(createElement(MyFeedBody, { feed: visit, q: '' }));
		assert.equal((page.match(/class="unread-line"/g) ?? []).length, 1);
		// In reading order: the count, the two new entries marked new, the line, then the four seen before.
		const words = text(page.slice(page.indexOf('class="count">2 new')));
		assert.match(words, /^class="count">2 new since your last visit\. Comment new Codex · @bob .* Comment new @eve .* ↑ New since your last visit · already seen ↓ Reply .* Comment .* Review .* New record/);
		assert.equal((page.match(/class="item entry new"/g) ?? []).length, 2);
		assert.ok(page.includes(UNREAD));
		// Links to the new posts carry the line, so the thread marks the same posts; links to seen ones are plain.
		assert.match(page, /href="\/r\/arxiv\/2611\.00001\?new=7#p\d+"/);
		assert.equal((page.match(/\?new=7#p/g) ?? []).length, 2);
		// Nothing new: no line, and the page says so.
		const again = html(createElement(MyFeedBody, { feed: await openFeed(db, ada), q: '' }));
		assert.doesNotMatch(again, /unread-line|entry new/);
		assert.match(text(again), /Nothing new since your last visit\./);
		// A first visit has no line and no count: there is no earlier visit to compare with.
		await replaceQueries(db, eve, 'cat:quant-ph');
		const firstVisit = html(createElement(MyFeedBody, { feed: await openFeed(db, eve), q: '' }));
		assert.doesNotMatch(firstVisit, /unread-line|since your last visit/);
		// Everything on the page is new and there is more: the line is on an older page, which the pager's link finds.
		const paged = html(createElement(MyFeedBody, { feed: { ...visit, entries: visit.entries.slice(0, 2), older: 8 }, q: '' }));
		assert.doesNotMatch(paged, /unread-line/);
		assert.match(text(paged), /2\+ new since your last visit\./);
		assert.match(paged, /<a href="\/\?feed=mine&amp;before=8&amp;line=7" rel="next">Older<\/a>/);
		const older = html(createElement(MyFeedBody, { feed: await openFeed(db, ada, { before: 8, line: 7 }), q: '', before: 8 }));
		assert.doesNotMatch(older, /unread-line|entry new/, 'a page wholly below the line needs none');
		assert.match(older, /<a href="\/\?feed=mine&amp;line=7" rel="prev">Newest<\/a>/);
		await db.close();
	});

	test('on a record\'s thread and in a topic, the posts after the last visit are marked; reading a thread moves nothing', async () => {
		const { db, topic, reply } = await site();
		await replaceQueries(db, ada, 'cat:quant-ph');
		// No earlier visit, or nobody: nothing is marked.
		assert.deepEqual([...await newInThread(db, ada, { record: QP.id })], []);
		assert.deepEqual([...await newInThread(db, null, { record: QP.id }, 1)], []);
		await openFeed(db, ada); // seen 7
		const onRecord = await comment(db, QP.id, eve, { body: 'The bound is sharp for N = 2.', parent: reply.id }, yes); // 8
		const inTopic = await post(db, { topic: topic.id }, eve, { body: 'Only for even length.' }, yes); // 9
		assert.deepEqual([...await newInThread(db, ada, { record: QP.id })], [onRecord.id]);
		assert.deepEqual([...await newInThread(db, ada, { topic: topic.id })], [inTopic.id]);
		assert.deepEqual([...await newInThread(db, ada, { record: NT.id })], []);
		assert.equal((await savedQueries(db, 'ada')).seen, 7, 'reading threads moved nothing');
		// Arriving from the feed, which has just moved the place: the link carries the line the feed drew.
		await openFeed(db, ada); // seen 9
		assert.deepEqual([...await newInThread(db, ada, { record: QP.id })], []);
		assert.deepEqual([...await newInThread(db, ada, { record: QP.id }, 7)], [onRecord.id]);
		assert.equal(entryHref({ kind: 'comment', path: `${QP.id}/${onRecord.id}` }, 7, true), `/r/arxiv/2611.00001?new=7#p${onRecord.id}`);
		assert.equal(entryHref({ kind: 'answer', path: `forum/${topic.id}/${inTopic.id}` }, 7, true), `/forum/${topic.id}?new=7#p${inTopic.id}`);
		assert.equal(entryHref({ kind: 'record', path: QP.id }, 7, true), '/r/arxiv/2611.00001');
		assert.equal(entryHref({ kind: 'comment', path: `${QP.id}/${reply.id}` }, 7, false), `/r/arxiv/2611.00001#p${reply.id}`);
		// The note above the thread links to the first new post in the page's order.
		const note = html(createElement(NewInThread, { ids: new Set([inTopic.id, 3]), order: [1, 2, inTopic.id, 3] }));
		assert.match(note, new RegExp(`<a href="#p${inTopic.id}">2 new since your last visit</a>`));
		assert.equal(html(createElement(NewInThread, { ids: new Set<number>(), order: [1, 2] })), '');
		await db.close();
	});
});
