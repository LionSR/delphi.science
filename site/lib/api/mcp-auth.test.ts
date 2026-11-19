// The MCP tools with and without a token (lib/api/mcp.ts), on in-process Postgres with every migration: what a caller
// without a token can and cannot do, paths, that a signed-in plugin's actions are attributed, moderated and limited
// like those of a device-approved agent key, and expiry and revocation. Sign-in itself is in lib/accounts/oauth.test.ts.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { load } from '#lib/records/load.ts';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { createAgentKey, createSession, revokeAgentKey, voterFromKey } from '#lib/accounts/keys.ts';
import { RESOURCE_METADATA } from '#lib/accounts/oauth.ts';
import { form, route, signIn as signInOn } from '#lib/accounts/oauth-testing.ts';
import { sha256 } from '#lib/hash.ts';
import { SITE } from '#lib/view.ts';
import { handle, TOOLS } from './mcp.ts';
import { MCP_READ_TOOLS, MCP_WRITE_TOOLS } from './mcp-guide.ts';

allowRouteImports();

type Json = Record<string, any>;
const RECORD = 'app/oauth-plugin', OTHER = 'app/oauth-other';

let pg: PGlite;
before(async () => {
	pg = await migratedDb();
	useDb(pg);
	await load(pg, [RECORD, OTHER].map((id) => ({ id, source: 'app', title: 'A boundary-condition comparison', url: `https://example.org/${id}` })));
});
after(async () => { useDb(); await pg.close(); });

// ---- Helpers ----

const mcp = (method: string, params: object = {}, bearer?: string) => handle(new Request('http://localhost/mcp', {
	method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
}), async () => pg);
const call = async (name: string, args: object, bearer?: string) => (await (await mcp('tools/call', { name, arguments: args }, bearer)).json()).result as Json;
/** A tool's structured result; fails with the tool's own message if it refused. */
const ok = async (name: string, args: object, bearer?: string) => {
	const r = await call(name, args, bearer);
	assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
	return r.structuredContent as Json;
};
const signIn = (login: string, name?: string) => signInOn(pg, login, name);

/** Runs `run` with the moderation provider answering `decision`, counting the calls made to it. */
async function moderated<T>(decision: 'ACCEPT' | 'REQUEST_REVISION', run: () => Promise<T>): Promise<{ value: T; calls: number }> {
	const priorFetch = globalThis.fetch, priorKey = process.env.DEEPSEEK_API_KEY;
	let calls = 0;
	process.env.DEEPSEEK_API_KEY = 'offline-provider-fixture';
	globalThis.fetch = (async () => {
		calls++;
		const verdict = decision === 'ACCEPT'
			? { decision, reason: 'A scoped, checkable observation.', fix: '', verification_needed: false }
			: { decision, reason: 'The comment states no argument.', fix: 'Add the step or reference that supports it.', verification_needed: false };
		return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(verdict) } }] });
	}) as typeof fetch;
	try {
		return { value: await run(), calls };
	} finally {
		globalThis.fetch = priorFetch;
		if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey;
	}
}

// ---- The MCP server, with and without a token ----

// Every way a tool acts for a person, each of which must ask for sign-in from a caller without a token.
const WRITES: [string, object][] = [
	['get', { id: 'me' }],
	['vote', { id: RECORD, value: 1 }],
	['vote', { id: RECORD, value: 0 }],
	['post', { id: RECORD, body: 'The lemma fails for open boundary conditions.' }],
	['edit', { id: `${RECORD}/1`, body: 'The lemma fails for open boundary conditions only.', revision: '1' }],
	['post', { id: 'records', body: 'arxiv/2610.20058' }],
	['post', { id: 'forum', title: 'Does the bound hold?', body: 'For which boundary conditions does the bound of app/oauth-plugin hold?' }],
	['post', { id: 'forum/1', body: 'It holds for periodic ones.' }],
	['vote', { id: 'forum/1/1', value: 1 }],
	['vote', { id: 'forum/1/1', accept: true }],
];
const NO_AUTH = { type: 'noauth' }, OAUTH = { type: 'oauth2', scopes: ['write'] };

describe('a caller without a token', () => {
	test('lists six tools, each marked with whether it needs sign-in, and with honest annotations', async () => {
		const listed = await (await mcp('tools/list')).json();
		const tools: Record<string, Json> = Object.fromEntries((listed.result.tools as Json[]).map((t) => [t.name, t]));
		assert.deepEqual(Object.keys(tools), ['search', 'get', 'log', 'post', 'edit', 'vote']);
		assert.deepEqual(Object.keys(tools), Object.keys(TOOLS));
		// The guides (/llms.txt, /api/v1) name the same tools, split the same way.
		assert.deepEqual([...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS], Object.keys(TOOLS));
		// Reading is open; get also serves the signed-in account (me) and log the signed-in person's inbox (to:@me), so they offer both.
		const schemes = { search: [NO_AUTH], get: [NO_AUTH, OAUTH], log: [NO_AUTH, OAUTH], post: [OAUTH], edit: [OAUTH], vote: [OAUTH] };
		const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
		const annotations = { search: read, get: read, log: read,
			// post only adds. edit overwrites a post's text. vote replaces or removes a vote, and accept is a toggle.
			post: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
			edit: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
			vote: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false } };
		for (const [name, t] of Object.entries(tools)) {
			assert.deepEqual(t.securitySchemes, schemes[name as keyof typeof schemes], name);
			assert.deepEqual(t._meta.securitySchemes, t.securitySchemes, name);
			assert.deepEqual(t.annotations, annotations[name as keyof typeof annotations], name);
			assert.ok(t.outputSchema && t.description.length > 80, name);
			// Flat inputs: tool clients do not take anyOf or oneOf.
			assert.ok(!/"(anyOf|oneOf|allOf)"/.test(JSON.stringify(t.inputSchema)), name);
		}
		// The portal import file (scripts/plugin.ts) justifies each hint of each tool, and no others.
		const submission = JSON.parse(readFileSync(new URL('../../plugin/submission.json', import.meta.url), 'utf8'));
		assert.deepEqual(Object.keys(submission.justifications), Object.keys(TOOLS));
	});

	test('reads records, the forum and the post log', async () => {
		assert.equal((await ok('get', { id: RECORD })).id, RECORD);
		assert.deepEqual(await ok('log', { path: OTHER }), { path: OTHER, since: 0, entries: [] });
		assert.equal((await ok('search', { in: 'forum', q: 'no such topic words' })).total, 0);
		assert.deepEqual((await ok('search', { q: 'boundary-condition' })).results.map((r: Json) => r.page).sort(), [OTHER, RECORD].map((id) => `${SITE}/r/${id}`));
	});

	test('an empty log is empty text, and a path that names nothing says what a path is', async () => {
		assert.equal((await call('log', { path: OTHER })).content[0].text, '');
		for (const [name, args, message] of [
			['get', { id: 'app/none' }, /^no record "app\/none"\. Use an id that search returns/],
			['get', { id: 'forum/999999' }, /^no forum\/999999\. Find topics with search, in=forum/],
			['get', { id: 'forum' }, /is a list, not one thing\. Use log for its posts, or search/],
			['get', { id: 'forum/x' }, /^no forum\/x\. A topic is forum\/<number>/],
			['log', { path: 'nowhere' }, /^no nowhere\. A path: a record id/],
			['log', { path: 'me' }, /has no log/],
			['search', { in: 'forum', sort: 'newest' }, /^sort and fields apply to records, not the forum/],
		] as const) {
			const r = await call(name, args);
			assert.ok(r.isError && message.test(r.content[0].text), `${name} ${JSON.stringify(args)}: ${r.content[0].text}`);
		}
	});

	test('cannot act for a person: every such call asks for sign-in and nothing is stored', async () => {
		const counts = async () => (await pg.query(`SELECT (SELECT count(*) FROM open_index.votes) AS votes, (SELECT count(*) FROM open_index.comments) AS comments,
			(SELECT count(*) FROM open_index.topics) AS topics, (SELECT count(*) FROM open_index.moderations) AS attempts, (SELECT count(*) FROM open_index.entries) AS entries`)).rows[0];
		const before = await counts();
		for (const [name, args] of WRITES) {
			const r = await call(name, args);
			assert.ok(r.isError, `${name} ${JSON.stringify(args)}`);
			assert.match(r.content[0].text, /^Sign-in required/, name);
			const [header] = r._meta['mcp/www_authenticate'];
			assert.ok(header.startsWith(`Bearer resource_metadata="${RESOURCE_METADATA}"`), name);
			assert.ok(header.includes('scope="write"') && header.includes('error="insufficient_scope"') && header.includes('error_description="'), name);
		}
		assert.deepEqual(await counts(), before);
	});

	test('a token that does not work is 401 with where to sign in, even for a read', async () => {
		for (const bearer of ['oik_' + '0'.repeat(48), 'gho_not-one-of-ours', await createSession(pg, 'ada').then(async (k) => { await pg.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = $1', [sha256(k)]); return k; })]) {
			const r = await mcp('tools/call', { name: 'get', arguments: { id: RECORD } }, bearer);
			assert.equal(r.status, 401);
			const header = r.headers.get('www-authenticate')!;
			assert.ok(header.includes(`resource_metadata="${RESOURCE_METADATA}"`) && header.includes('error="invalid_token"'), header);
		}
	});
});

describe('paths', () => {
	test('a record id that ends in a number is the record, and a post on it is one segment more', async () => {
		const old = 'arxiv/hep-th/9901001';
		await load(pg, [{ id: old, source: 'arxiv', title: 'An old-style identifier', url: 'https://example.org/hep-th' }]);
		assert.equal((await ok('get', { id: old })).title, 'An old-style identifier');
		assert.equal((await ok('get', { id: `/${old}/` })).id, old);
		const who = await signIn('Ada');
		const { value: posted } = await moderated('ACCEPT', () => ok('post', { id: old, body: 'Equation (4) is the $N = 2$ case of the general formula.' }, who));
		assert.match(posted.id, /^arxiv\/hep-th\/9901001\/\d+$/);
		assert.equal((await ok('get', { id: posted.id })).body, 'Equation (4) is the $N = 2$ case of the general formula.');
		// The same number under another thread names nothing.
		const n = posted.id.split('/').pop();
		for (const wrong of [`${RECORD}/${n}`, `forum/1/${n}`]) assert.match((await call('get', { id: wrong })).content[0].text, /^no post /, wrong);
		// A source prefix scopes the log to its records: each as it came in, and the posts on them.
		assert.deepEqual((await ok('log', { path: 'arxiv' })).entries.map((e: Json) => [e.kind, e.path]), [['comment', posted.id], ['record', old]]);
		assert.deepEqual((await ok('log', { path: 'arxiv', q: 'NOT kind:record' })).entries.map((e: Json) => e.path), [posted.id]);
		assert.deepEqual((await ok('log', { path: 'hexagon' })).entries, []);
	});
});

describe('a signed-in plugin', () => {
	test('acts as the client\'s name on the person\'s team, sharing their one vote with their other agents', async () => {
		const plugin = await signIn('Grace');
		assert.deepEqual(await ok('get', { id: 'me' }, plugin), { id: 'me', login: 'Grace', agent: 'ChatGPT', attribution: 'ChatGPT · @Grace’s team', profile: `${SITE}/u/grace` });
		assert.equal((await ok('vote', { id: RECORD, value: 1 }, plugin)).score, 1);
		const stored = async () => (await pg.query<{ agent: string; value: number }>('SELECT agent, value FROM open_index.votes WHERE record_id = $1 AND voter = $2', [RECORD, 'Grace'])).rows;
		assert.deepEqual(await stored(), [{ agent: 'ChatGPT', value: 1 }]);
		// The same person's device-approved agent votes: still one vote, now that agent's.
		const device = await createAgentKey(pg, 'Grace', 'Claude Code');
		assert.equal((await ok('vote', { id: RECORD, value: -1 }, device)).score, -1);
		assert.deepEqual(await stored(), [{ agent: 'Claude Code', value: -1 }]);
		// if_absent keeps it, as on the REST API.
		assert.equal((await ok('vote', { id: RECORD, value: 1, if_absent: true }, plugin)).created, false);
		assert.deepEqual(await stored(), [{ agent: 'Claude Code', value: -1 }]);
		// Value 0 takes the vote back; it carries nothing else.
		assert.match((await call('vote', { id: RECORD, value: 0, emoji: '🤔' }, plugin)).content[0].text, /^value 0 takes the whole vote back/);
		assert.equal((await ok('vote', { id: RECORD, value: 0 }, plugin)).score, 0);
		assert.deepEqual(await stored(), []);
	});

	test('the same token works on the REST API, where it is an agent key like any other', async () => {
		const plugin = await signIn('Grace');
		const { GET } = await route('api/v1/keys');
		const r: Response = await GET(new Request('http://localhost/api/v1/keys', { headers: { authorization: `Bearer ${plugin}` } }), { params: Promise.resolve({}) });
		const { keys } = await r.json();
		assert.deepEqual(keys.filter((k: Json) => k.current).map((k: Json) => k.agent), ['ChatGPT']);
	});

	test('posts go through moderation: an accepted comment is stored with the attribution, a refused one is not', async () => {
		const plugin = await signIn('Hypatia', 'Codex');
		const body = 'The estimate in Section 3 uses open boundary conditions; with periodic ones the constant doubles.';
		const posted = await moderated('ACCEPT', () => ok('post', { id: RECORD, body, review: true }, plugin));
		assert.equal(posted.calls, 1);
		assert.match(posted.value.id, new RegExp(`^${RECORD}/\\d+$`));
		assert.deepEqual([posted.value.voter, posted.value.agent, posted.value.review, posted.value.parent], ['Hypatia', 'Codex', true, null]);
		// The log shows it on one line, and get shows it whole with the revision an edit needs.
		const logged = await call('log', { path: RECORD });
		assert.deepEqual(logged.structuredContent.entries.map((e: Json) => [e.path, e.kind, e.by, e.agent, e.subject, e.text]),
			[[posted.value.id, 'review', 'Hypatia', 'Codex', 'A boundary-condition comparison', body]]);
		assert.equal(logged.structuredContent.since, logged.structuredContent.entries[0].seq);
		const [line] = logged.content[0].text.split('\n');
		assert.deepEqual(line.split('\t').filter((_: string, i: number) => i !== 5),
			[String(logged.structuredContent.entries[0].seq), 'review', posted.value.id, '-', 'Codex · @Hypatia', '0', 'A boundary-condition comparison', body, '-']);
		const whole = await ok('get', { id: posted.value.id });
		assert.deepEqual([whole.id, whole.kind, whole.voter, whole.body], [posted.value.id, 'review', 'Hypatia', body]);

		// The person corrects it through another of their connections; the attribution stays, and the revision moves on.
		const fixed = `${body} Checked for $n \\le 6$.`;
		const edited = await moderated('ACCEPT', async () => ok('edit', { id: posted.value.id, body: fixed, revision: whole.revision }, await signIn('Hypatia', 'Claude')));
		assert.deepEqual([edited.value.id, edited.value.body], [posted.value.id, fixed]);
		assert.notEqual(edited.value.revision, whole.revision);
		const stale = await moderated('ACCEPT', () => call('edit', { id: posted.value.id, body: `${fixed} More.`, revision: whole.revision }, plugin));
		assert.match(stale.value.content[0].text, /^edit_conflict/);
		assert.match((await call('edit', { id: posted.value.id, body: 'Mine now.', revision: edited.value.revision }, await signIn('Mallory'))).content[0].text, /^edit_forbidden/);
		assert.match((await call('edit', { id: RECORD, body: 'x', revision: '1' }, plugin)).content[0].text, /is not a post/);
		assert.deepEqual((await ok('get', { id: posted.value.id })).body, fixed);

		// A reply goes to the post's path; a refused post stores nothing.
		const reply = await moderated('ACCEPT', () => ok('post', { id: posted.value.id, body: 'Agreed: the factor of two comes from the two boundary terms.' }, plugin));
		assert.equal(reply.value.parent, posted.value.id);
		const refusedPost = await moderated('REQUEST_REVISION', () => call('post', { id: RECORD, body: 'Great paper, thanks.' }, plugin));
		assert.ok(refusedPost.value.isError);
		assert.match(refusedPost.value.content[0].text, /^moderation_rejected: not posted: REQUEST_REVISION: The comment states no argument\.+ Add the step/);
		assert.equal((await ok('log', { path: RECORD })).entries.length, 2);
		// Following the log: only what came after a seq, oldest first.
		assert.deepEqual((await ok('log', { path: RECORD, since: logged.structuredContent.since })).entries.map((e: Json) => e.path), [reply.value.id]);
		// Every attempt is in the person's daily ledger under the name of the connection that made it.
		const attempts = (await pg.query<{ agent: string; publish: boolean }>('SELECT agent, publish FROM open_index.moderations WHERE voter = $1 ORDER BY id', ['Hypatia'])).rows;
		assert.deepEqual(attempts, [{ agent: 'Codex', publish: true }, { agent: 'Claude', publish: true }, { agent: 'Codex', publish: true }, { agent: 'Codex', publish: false }]);
	});

	test('fields that do not apply to a path are refused with where they do', async () => {
		const plugin = await signIn('Hypatia');
		for (const [name, args, message] of [
			['post', { id: RECORD, body: 'x', title: 'A title' }, /^title does not apply to .* it is for a new topic/],
			['post', { id: 'forum/1', body: 'x', review: true }, /^review does not apply/],
			['post', { id: 'forum', body: 'A question with no title.' }, /^a new topic needs a title/],
			['post', { id: 'me', body: 'x' }, /^nothing can be posted to "me"/],
			['vote', { id: 'forum/1/1', value: 1, emoji: '🤔' }, /^emoji does not apply .* votes on records/],
			['vote', { id: RECORD, accept: true }, /^accept does not apply/],
			['vote', { id: 'forum', value: 1 }, /cannot be voted on/],
			['vote', { id: 'forum/1/1' }, /^the vote is empty/],
			['vote', { id: 'forum/1/1', value: 1, accept: true }, /^send value or accept, not both/],
		] as const) {
			const r = await call(name, args, plugin);
			assert.ok(r.isError && message.test(r.content[0].text), `${name} ${JSON.stringify(args)}: ${r.content[0].text}`);
		}
	});

	test('with no moderation provider nothing is posted', async () => {
		const prior = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
		try {
			const r = await call('post', { id: OTHER, body: 'The bound in Lemma 2 needs $n > 3$.' }, await signIn('Hypatia'));
			assert.ok(r.isError && /^moderation_unavailable/.test(r.content[0].text), r.content[0].text);
			assert.deepEqual((await ok('log', { path: OTHER })).entries, []);
		} finally { if (prior !== undefined) process.env.DEEPSEEK_API_KEY = prior; }
	});

	test('the daily limit of 30 attempts is the person\'s, whichever agent used them', async () => {
		const plugin = await signIn('Emmy');
		await pg.query("INSERT INTO open_index.moderations (voter, agent, kind, publish, reason) SELECT 'Emmy', 'Claude Code', 'comment', true, 'ACCEPT: ok' FROM generate_series(1, 30)");
		const r = await moderated('ACCEPT', () => call('post', { id: RECORD, body: 'The proof of Lemma 4 omits the case $n = 2$.' }, plugin));
		assert.equal(r.calls, 0, 'the provider is not asked once the limit is reached');
		assert.ok(r.value.isError);
		assert.match(r.value.content[0].text, /@Emmy has used 30 check\/submission attempts today, agents included/);
	});

	test('takes part in the forum: asks, is answered, votes, and accepts; nobody votes on their own post', async () => {
		const asker = await signIn('Sofia'), answerer = await signIn('Noether', 'Codex');
		const { value: topic } = await moderated('ACCEPT', () => ok('post',
			{ id: 'forum', title: 'Does the boundary term vanish?', body: 'In app/oauth-plugin the boundary term is dropped. For which boundary conditions is that justified?' }, asker));
		assert.match(topic.id, /^forum\/\d+$/);
		assert.deepEqual([topic.voter, topic.agent, topic.question.mentions, topic.page, topic.answers], ['Sofia', 'ChatGPT', [RECORD], `${SITE}/${topic.id}`, []]);
		assert.ok(topic.question.id.startsWith(`${topic.id}/`));
		const { value: answer } = await moderated('ACCEPT', () => ok('post', { id: topic.id, body: 'For periodic ones: the two boundary contributions cancel term by term.' }, answerer));
		assert.ok(answer.id.startsWith(`${topic.id}/`));
		assert.deepEqual([answer.voter, answer.agent, answer.parent], ['Noether', 'Codex', null]);
		const { value: remark } = await moderated('ACCEPT', () => ok('post', { id: answer.id, body: 'This also needs the sum to converge absolutely, which holds for $s > 1$.' }, asker));
		assert.equal(remark.parent, answer.id);
		// Voting on a post, and on the topic itself (its opening post).
		assert.deepEqual(await ok('vote', { id: answer.id, value: 1 }, asker), { id: answer.id, score: 1 });
		assert.deepEqual(await ok('vote', { id: topic.id, value: 1 }, answerer), { id: topic.question.id, score: 1 });
		assert.match((await call('vote', { id: answer.id, value: 1 }, answerer)).content[0].text, /cannot vote on your own post/);
		assert.match((await call('vote', { id: `${RECORD}/1`, value: 1 }, asker)).content[0].text, /^(comments on records are not voted on|no record)/);
		// Accepting is the asker's, and sending it again takes it back.
		assert.match((await call('vote', { id: answer.id, accept: true }, answerer)).content[0].text, /only the asker/);
		assert.deepEqual(await ok('vote', { id: answer.id, accept: true }, asker), { id: answer.id, accepted: answer.id });
		const read = await ok('get', { id: topic.id });
		assert.deepEqual(read.answers.map((a: Json) => [a.id, a.accepted, a.score, a.comments.map((c: Json) => [c.id, c.parent])]), [[answer.id, true, 1, [[remark.id, answer.id]]]]);
		assert.deepEqual([read.accepted, read.answers.length, read.score], [answer.id, 1, 1]);
		assert.deepEqual(await ok('vote', { id: answer.id, accept: true }, asker), { id: answer.id, accepted: null });
		// The topic is found by search, listed as one line there, and its posts are in the log by kind.
		const found = (await ok('search', { in: 'forum', q: 'boundary term' })).results[0];
		assert.deepEqual([found.id, found.title, found.answers, found.accepted], [topic.id, 'Does the boundary term vanish?', 1, null]);
		assert.deepEqual((await ok('log', { path: topic.id, since: 0 })).entries.map((e: Json) => [e.path, e.kind, e.parent]),
			[[topic.question.id, 'question', null], [answer.id, 'answer', null], [remark.id, 'comment', answer.id]]);
		const all = (await ok('log', { path: 'forum' })).entries.map((e: Json) => e.path);
		assert.deepEqual(all.slice(0, 3), [remark.id, answer.id, topic.question.id], 'without since, the newest first');
	});

	test('a post that contains the token is refused and the token revoked, as for any agent key', async () => {
		const plugin = await signIn('Ada');
		const r = await call('post', { id: RECORD, body: `My token is ${plugin}` }, plugin);
		assert.match(r.content[0].text, /contains an agent key/);
		assert.equal((await mcp('tools/list', {}, plugin)).status, 401);
	});
});

describe('expiry and revocation', () => {
	const works = async (bearer: string) => (await mcp('tools/call', { name: 'get', arguments: { id: 'me' } }, bearer)).status;

	test('an expired token stops working', async () => {
		const plugin = await signIn('Ada');
		assert.equal(await works(plugin), 200);
		await pg.query("UPDATE open_index.agent_keys SET expires_at = now() - interval '1 second' WHERE key_hash = $1", [sha256(plugin)]);
		assert.equal(await works(plugin), 401);
	});

	test('the person revokes it at /keys, where it is listed with their other agents', async () => {
		const plugin = await signIn('Ada');
		assert.ok(await revokeAgentKey(pg, 'Ada', sha256(plugin)));
		assert.equal(await works(plugin), 401);
	});

	test('the client revokes it at the revocation route; unknown tokens and browser sessions are left alone', async () => {
		const plugin = await signIn('Ada'), session = await createSession(pg, 'Ada');
		const { POST } = await route('oauth/revoke');
		for (const t of [plugin, session, 'oik_unknown', '']) assert.equal((await POST(form('/oauth/revoke', { token: t })) as Response).status, 200);
		assert.equal(await works(plugin), 401);
		assert.deepEqual(await voterFromKey(pg, session), { login: 'Ada', agent: '' });
	});
});
