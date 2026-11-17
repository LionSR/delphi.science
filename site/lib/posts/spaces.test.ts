// Spaces on in-process Postgres, through the route handlers and the MCP server: their life (open, invite, accept,
// leave, remove, delete), and above all that nothing private leaks. For a private space with content, everyone who is
// not a member (nobody signed in, a stranger, a person invited who has not accepted, a member who was removed) tries
// every way of reading and writing, and each must answer exactly as it would if the space did not exist.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { createAgentKey, createSession, type Voter } from '#lib/accounts/keys.ts';
import { profile } from '#lib/accounts/profile.ts';
import { analyticsPath } from '#lib/analytics.ts';
import { handle as mcp } from '#lib/api/mcp.ts';
import { spec } from '#lib/api/openapi.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import { load } from '#lib/records/load.ts';
import { sitemapFile, sitemapFiles } from '#lib/records/sitemap.ts';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { comment, post } from './comments.ts';
import { editPost } from './edit.ts';
import { submitPostForm } from './form-submit.ts';
import { activity, startTopic, topics, topicThread, topicWithPosts } from './forum.ts';
import { log } from './log.ts';
import { addMember, CREATABLE, createSpace, deleteSpace, MAX_INVITE_NOTE, members, MODERATE_PRIVATE_SPACES, mySpaces, postOptions, PRIVATE_POSTS_PER_DAY, removeMember, space } from './spaces.ts';
import { canRead, FORUM } from './visibility.ts';

allowRouteImports();

const APP = new URL('../../app', import.meta.url);
const RECORD = 'app/space-record';
// A word that is in every private text and nowhere else: if it shows up in a reply to an outsider, something leaked.
const SECRET = 'zanzibarine';

const person = (login: string): Voter => ({ login, agent: '' });
const alice = person('alice'), bob = person('bob'), carol = person('carol'), dave = person('dave'), eve = person('eve');

let pg: PGlite;
const keys: Record<string, string> = {};
let moderated: string[] = []; // what was sent to the moderation provider
const priorFetch = globalThis.fetch, priorKey = process.env.DEEPSEEK_API_KEY;

// ---- Calling the site as a client would ----

/** The route file and params for a request path, as Next would pick them: a verb's path id is a catch-all. */
function route(path: string) {
	const verb = path.match(/^\/api\/v1\/(get|post|edit|vote)\/(.+)$/);
	if (verb) return { file: `/api/v1/${verb[1]}/[...id]`, params: { id: verb[2].split('/').map(decodeURIComponent) } as Record<string, string | string[]> };
	const tmpl = Object.keys(spec.paths).filter((p) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
		.sort((a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0))[0];
	if (!tmpl) throw new Error(`no route for ${path}`);
	const parts = tmpl.split('/'), given = path.split('/');
	return { file: tmpl.replace(/\{([^}]+)\}/g, '[$1]'), params: Object.fromEntries(parts.flatMap((p, n) => (p.startsWith('{') ? [[p.slice(1, -1), decodeURIComponent(given[n])]] : []))) };
}

type Reply = { status: number; text: string; json: any; cache: string };
/** One REST call, as `who` (a name in keys) or as nobody. */
async function api(method: string, pathAndQuery: string, who?: string, body?: unknown): Promise<Reply> {
	const at = new URL(pathAndQuery, 'http://localhost');
	const found = route(at.pathname);
	const handler = (await import(`${APP.href}${found.file}/route.ts`))[method];
	const res: Response = await handler(new Request(at, { method, body: body === undefined ? undefined : JSON.stringify(body),
		headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(who ? { Authorization: `Bearer ${keys[who]}` } : {}) } }),
	{ params: Promise.resolve(found.params) });
	const text = await res.text();
	let json: any;
	try { json = JSON.parse(text); } catch { /* text/plain */ }
	return { status: res.status, text, json, cache: res.headers.get('cache-control') ?? '' };
}

/** Runs `run` with the MCP server open to spaces, or closed to them (the default), and puts the switch back. */
async function mcpSpaces<T>(on: boolean, run: () => Promise<T>): Promise<T> {
	const prior = process.env.ORI_MCP_SPACES;
	if (on) process.env.ORI_MCP_SPACES = 'true'; else delete process.env.ORI_MCP_SPACES;
	try { return await run(); } finally { if (prior === undefined) delete process.env.ORI_MCP_SPACES; else process.env.ORI_MCP_SPACES = prior; }
}

/** One MCP tool call, as `who` or as nobody: its text, and whether it is an error. */
async function tool(name: string, args: object, who?: string) {
	const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(who ? { Authorization: `Bearer ${keys[who]}` } : {}) } });
	const reply = await (await mcp(req, async () => pg)).json();
	assert.ok(reply.result, `${name}: ${JSON.stringify(reply.error)}`);
	return { error: reply.result.isError === true, text: reply.result.content[0].text as string, out: reply.result.structuredContent as Record<string, any> | undefined };
}

before(async () => {
	process.env.DEEPSEEK_API_KEY = 'offline-spaces-fixture';
	globalThis.fetch = (async (url, init) => {
		assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'unexpected network call');
		moderated.push(String((init as RequestInit).body));
		return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: 'ACCEPT', verification_needed: false, reason: 'A scoped, checkable observation.', fix: '' }) } }] });
	}) as typeof fetch;
	pg = await migratedDb();
	useDb(pg);
	await load(pg, [{ id: RECORD, source: 'app', title: 'A finite-chain computation', url: 'https://example.org/space-record', summary: 'We compute the endpoint terms of an open chain.', published: '2026-11-01' }]);
	for (const who of [alice, bob, carol, dave, eve]) keys[who.login] = await createSession(pg, who.login);
	keys['alice-agent'] = await createAgentKey(pg, 'alice', 'Claude Code');
});
after(async () => {
	globalThis.fetch = priorFetch;
	if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey;
	useDb();
	await pg.close();
});

describe('the life of a space, through the six verbs', () => {
	let slug = '';
	test('the switches are at the defaults this was built with', () => {
		assert.equal(MODERATE_PRIVATE_SPACES, false);
		assert.deepEqual(CREATABLE, ['private']);
		assert.equal(MAX_INVITE_NOTE, 200);
	});

	test('posting a title to ws opens a private space with its creator as the only member: a notebook', async () => {
		assert.equal((await api('POST', '/api/v1/post/ws', undefined, { title: 'Notebook', body: 'x' })).status, 401);
		assert.match((await api('POST', '/api/v1/post/ws', 'alice', { body: 'no title' })).json.error.message, /a new space needs a title/);
		const made = await api('POST', '/api/v1/post/ws', 'alice', { title: 'Notebook on boundary terms', body: 'Working notes.' });
		assert.equal(made.status, 201);
		slug = made.json.id.slice(3);
		assert.match(slug, /^notebook-on-boundary-terms-[a-z2-9]{5}$/, 'the slug says what it is and ends in random letters');
		assert.deepEqual([made.json.title, made.json.voter, made.json.body, made.cache], ['Notebook on boundary terms', 'alice', 'Working notes.', 'private, no-store']);
		const s = (await space(pg, slug, 'alice'))!;
		assert.deepEqual([s.visibility, s.creator, s.topics], ['private', 'alice', 0]);
		assert.deepEqual((await members(pg, slug, 'alice'))!.map((m) => [m.login, m.creator, m.accepted_at !== null]), [['alice', true, true]]);
		assert.equal(await canRead(pg, slug, 'alice'), true);
		assert.equal(await canRead(pg, slug, 'ALICE'), true, 'GitHub logins ignore case');
		assert.equal(await canRead(pg, slug, 'bob'), false);
		assert.equal(await canRead(pg, slug, null), false);
		assert.equal(await canRead(pg, FORUM, null), true, 'the forum is the one public space');
		assert.equal(await canRead(pg, 'no-such-space', 'alice'), false);
		await assert.rejects(createSpace(pg, alice, { title: 'Open house', visibility: 'public' }), /a new space cannot be public/);
	});

	test('her agent key is her: it reads and writes the notebook, and a topic and its posts take ws paths', async () => {
		const topic = await api('POST', `/api/v1/post/ws/${slug}`, 'alice-agent', { title: 'Endpoint terms', body: 'The sum telescopes.' });
		assert.equal(topic.status, 201);
		assert.match(topic.json.id, new RegExp(`^ws/${slug}/\\d+$`));
		assert.equal(topic.json.page, `https://delphi.science/${topic.json.id}`);
		assert.deepEqual([topic.json.question.agent, topic.json.question.voter], ['Claude Code', 'alice']);
		const reply = await api('POST', `/api/v1/post/${topic.json.id}`, 'alice', { body: 'Check n = 0.' });
		assert.equal(reply.json.id.startsWith(`${topic.json.id}/`), true);
		const under = await api('POST', `/api/v1/post/${reply.json.id}`, 'alice-agent', { body: 'It holds.' });
		assert.equal(under.json.parent, reply.json.id);
		const got = await api('GET', `/api/v1/get/${topic.json.id}`, 'alice-agent');
		assert.deepEqual([got.status, got.json.answers.length, got.json.answers[0].comments[0].body, got.cache], [200, 1, 'It holds.', 'private, no-store']);
		const one = await api('GET', `/api/v1/get/${reply.json.id}`, 'alice');
		assert.deepEqual([one.json.kind, one.json.subject, one.json.body], ['answer', 'Endpoint terms', 'Check n = 0.']);
		const edited = await api('PATCH', `/api/v1/edit/${reply.json.id}`, 'alice-agent', { body: 'Check n = 0 and n = 1.', revision: one.json.revision });
		assert.deepEqual([edited.status, edited.json.body], [200, 'Check n = 0 and n = 1.'], 'any of her keys edits her posts');
		const shown = await api('GET', `/api/v1/get/ws/${slug}`, 'alice');
		assert.deepEqual([shown.json.kind, shown.json.title, shown.json.authors], ['space', 'Notebook on boundary terms', ['alice']]);
		assert.match(shown.json.body, new RegExp(`^Working notes\\.\\n\\nTopics, the latest activity first \\(1\\):\\n${topic.json.id}\\t\\d{4}-\\d\\d-\\d\\d\\t1 reply\\tEndpoint terms$`));
		const mine = await api('GET', '/api/v1/get/ws', 'alice-agent');
		assert.match(mine.json.body, new RegExp(`^ws/${slug}\\tmember\\t\\d{4}-\\d\\d-\\d\\d\\tNotebook on boundary terms\\t$`));
		assert.equal((await api('GET', '/api/v1/get/ws')).status, 401, 'nobody signed in has no spaces to list');
		const lines = await api('GET', `/api/v1/log?path=ws/${slug}&format=text`, 'alice');
		assert.deepEqual(lines.text.trim().split('\n').map((l) => l.split('\t')[1]), ['comment', 'answer', 'question']);
		const found = await api('GET', '/api/v1/find?in=forum&q=telescopes', 'alice');
		assert.deepEqual([found.json.results.map((r: { id: string }) => r.id), found.cache], [[topic.json.id], 'private, no-store']);
	});

	test('any member invites; the invitation and the acceptance are lines in the affected people\'s logs', async () => {
		const before = (await api('GET', '/api/v1/log', 'bob')).json.since;
		const invited = await api('POST', `/api/v1/post/ws/${slug}/members`, 'alice-agent', { body: '@Bob  come and check\n my sums' });
		assert.deepEqual([invited.status, invited.json.id, invited.json.voter, invited.json.agent], [201, `ws/${slug}/members/bob`, 'alice', 'Claude Code']);
		assert.match(invited.json.body, new RegExp(`^ws/${slug}/members/bob\\tinvited\\tby @alice\\t\\d{4}-\\d\\d-\\d\\d\\tcome and check my sums$`));
		// Inviting again changes nothing.
		assert.equal((await api('POST', `/api/v1/post/ws/${slug}/members`, 'alice', { body: 'bob another line' })).json.body, invited.json.body);
		assert.match((await api('POST', `/api/v1/post/ws/${slug}/members`, 'alice', { body: `carol ${'x'.repeat(MAX_INVITE_NOTE + 1)}` })).json.error.message, /longer than 200 characters/);
		assert.match((await api('POST', `/api/v1/post/ws/${slug}/members`, 'alice', { body: 'not/a/login' })).json.error.message, /valid GitHub login/);

		// Bob, invited: his log has the invitation, and get ws lists it; the space itself is still not his to read.
		const news = await api('GET', `/api/v1/log?since=${before}`, 'bob');
		assert.deepEqual(news.json.entries.map((e: Record<string, string>) => [e.kind, e.path, e.by, e.agent, e.subject, e.text]),
			[['comment', `ws/${slug}/members/bob`, 'alice', 'Claude Code', 'Notebook on boundary terms', `invited @bob to ws/${slug}: come and check my sums`]]);
		assert.match((await api('GET', '/api/v1/get/ws', 'bob')).json.body, new RegExp(`^ws/${slug}\\tinvited by @alice\\t\\S+\\tNotebook on boundary terms\\tcome and check my sums$`));
		assert.match((await api('GET', `/api/v1/get/ws/${slug}/members/bob`, 'bob')).json.body, /To accept, post your login/);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}`, 'bob')).status, 404);

		// The invitation is addressed to him: it is in his inbox (to:@me), and in nobody else's who cannot read the space.
		const inbox = (who: string, q = 'to:@me') => api('GET', `/api/v1/log?since=0&q=${encodeURIComponent(q)}`, who).then((r) => r.json.entries.map((e: Record<string, string>) => e.path));
		assert.deepEqual(await inbox('bob'), [`ws/${slug}/members/bob`]);
		assert.deepEqual(await inbox('bob', 'to:@Bob'), [`ws/${slug}/members/bob`]);
		assert.deepEqual(await inbox('alice', 'to:@bob'), [`ws/${slug}/members/bob`], 'a member of the space sees whom it invited');
		assert.deepEqual(await inbox('eve', 'to:@bob'), [], 'a stranger asking after Bob learns nothing');
		assert.deepEqual((await api('GET', '/api/v1/log?since=0&q=to:@bob')).json.entries, []);
		assert.deepEqual(await inbox('bob', 'to:@me OR kind:review'), [], 'only when to: is the whole query');
		assert.ok(!(await tool('log', { q: 'to:@me', since: 0 }, 'bob')).text.includes(slug), 'and not through MCP while spaces are closed to it');
		// He accepts by posting his own login, and reads all of it, earlier posts included.
		const mark = (await api('GET', '/api/v1/log', 'alice')).json.since;
		const accepted = await api('POST', `/api/v1/post/ws/${slug}/members`, 'bob', { body: 'bob' });
		assert.match(accepted.json.body, /\tmember\tby @alice\t/);
		assert.deepEqual((await api('GET', `/api/v1/log?since=${mark}`, 'alice')).json.entries.map((e: Record<string, string>) => [e.path, e.by, e.text]),
			[[`ws/${slug}/members/bob`, 'bob', `@bob accepted the invitation and joined ws/${slug}`]]);
		assert.equal((await api('GET', `/api/v1/log?path=ws/${slug}`, 'bob')).json.entries.length, 5, 'three posts, the invitation and the acceptance');
		assert.deepEqual(await inbox('alice'), [`ws/${slug}/members/bob`], 'the acceptance of an invitation she sent is addressed to her');
		assert.deepEqual(await inbox('bob'), [`ws/${slug}/members/bob`], 'his invitation stays in his inbox; his own acceptance is not sent to him');
		assert.deepEqual((await api('GET', `/api/v1/get/ws/${slug}/members`, 'bob')).json.authors, ['alice', 'bob']);
		// Members are equal: Bob invites too.
		assert.equal((await api('POST', `/api/v1/post/ws/${slug}/members`, 'bob', { body: 'carol' })).status, 201);
	});

	test('a post with options goes round as it was written, and choosing one is a reply', async () => {
		const topic = (await topics(pg, 'alice', { space: slug })).questions[0];
		const body = 'Options: Yes, merge it | Not yet | Ask Carol\n\nShall I merge the endpoint fix?';
		const card = await api('POST', `/api/v1/post/ws/${slug}/${topic.id}`, 'alice-agent', { body });
		assert.equal(card.json.body, body);
		const read = await api('GET', `/api/v1/get/${card.json.id}`, 'bob');
		assert.equal(read.json.body, body);
		assert.deepEqual(postOptions(read.json.body), { options: ['Yes, merge it', 'Not yet', 'Ask Carol'], text: 'Shall I merge the endpoint fix?' });
		const choice = await api('POST', `/api/v1/post/${card.json.id}`, 'alice', { body: 'Yes, merge it' });
		assert.deepEqual([choice.status, choice.json.parent, choice.json.body], [201, card.json.id, 'Yes, merge it']);
		const t = (await topicThread(pg, topic.id, 'bob', slug))!;
		assert.deepEqual(t.posts.map((p) => p.id), [...t.posts.map((p) => p.id)].sort((a, b) => a - b), 'a space shows a thread in the order it was written');
		assert.equal(t.posts.at(-1)!.parent, t.posts.at(-2)!.id);
		assert.deepEqual(postOptions('No options here.'), { options: [], text: 'No options here.' });
		assert.deepEqual(postOptions('Options: only one').options, [], 'one option is no choice');
	});

	test('anyone leaves by a vote; removing a member and deleting the space are operations of their own, not votes', async () => {
		// No vote removes someone else or deletes a space, whoever casts it.
		for (const who of ['alice', 'bob']) {
			assert.match((await api('POST', `/api/v1/vote/ws/${slug}`, who, { value: 0 })).json.error.message, /a space is not voted on/);
			assert.match((await api('POST', `/api/v1/vote/ws/${slug}`, who, { value: 1 })).json.error.message, /a space is not voted on/);
		}
		assert.match((await api('POST', `/api/v1/vote/ws/${slug}/members/bob`, 'alice', { value: 0 })).json.error.message, /a vote takes back only your own place/);
		assert.match((await api('POST', `/api/v1/vote/ws/${slug}/members/bob`, 'alice', { value: 0 })).json.error.fix, new RegExp(`DELETE /api/v1/ws/${slug}/members/bob`));
		assert.match((await api('POST', `/api/v1/vote/ws/${slug}/members/bob`, 'bob', { value: 1 })).json.error.message, /a member is not voted on/);
		assert.deepEqual((await members(pg, slug, 'alice'))!.map((m) => m.login), ['alice', 'bob', 'carol'], 'and nothing was removed');
		// Only the creator removes or deletes, by the operations named for it.
		assert.match((await api('DELETE', `/api/v1/ws/${slug}/members/alice`, 'bob')).json.error.message, /only the creator of a space can remove a member/);
		assert.match((await api('DELETE', `/api/v1/ws/${slug}`, 'bob')).json.error.message, /only its creator can delete a space/);
		assert.equal((await api('DELETE', `/api/v1/ws/${slug}`)).status, 401);
		// Carol declines her invitation and Bob leaves, each by taking back their own place.
		assert.deepEqual((await api('POST', `/api/v1/vote/ws/${slug}/members/carol`, 'carol', { value: 0 })).json, { id: `ws/${slug}/members/carol` });
		assert.equal((await api('POST', `/api/v1/vote/ws/${slug}/members/bob`, 'bob', { value: 0 })).status, 200);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}`, 'bob')).status, 404, 'having left, he no longer reads it');
		// Alice invites him back and then removes him; her agent does it for her.
		await addMember(pg, slug, alice, 'bob');
		await addMember(pg, slug, bob, 'bob');
		assert.deepEqual((await api('DELETE', `/api/v1/ws/${slug}/members/bob`, 'alice-agent')).json, { removed: `ws/${slug}/members/bob` });
		assert.deepEqual((await members(pg, slug, 'alice'))!.map((m) => m.login), ['alice']);
		assert.equal((await api('DELETE', `/api/v1/ws/${slug}/members/bob`, 'alice')).status, 404, 'nobody to remove');
		// The last member does not vote a space away: leaving would delete it, and that is said, not done.
		const last = await api('POST', `/api/v1/vote/ws/${slug}/members/alice`, 'alice', { value: 0 });
		assert.match(last.json.error.message, /you are the last member, and leaving would delete the space/);
		assert.ok(await space(pg, slug, 'alice'));
		// Deleting takes the topics and posts with it.
		const topic = (await topics(pg, 'alice', { space: slug })).questions[0].id;
		assert.deepEqual((await api('DELETE', `/api/v1/ws/${slug}`, 'alice')).json, { deleted: `ws/${slug}` });
		assert.equal(await space(pg, slug, 'alice'), null);
		assert.equal((await pg.query('SELECT 1 FROM open_index.topics WHERE id = $1 UNION ALL SELECT 1 FROM open_index.comments WHERE topic_id = $1', [topic])).rows.length, 0);
		assert.deepEqual(await mySpaces(pg, 'alice'), []);
	});

	test('one generous limit guards against a loop that does not end; public posts keep their own', async () => {
		const s = await createSpace(pg, eve, { title: 'A runaway notebook' });
		const t = await startTopic(pg, eve, { title: 'Loop', body: 'First.', space: s.id });
		// As if her agent had posted all day: one short of the limit, written straight to the table.
		await pg.query(`INSERT INTO open_index.comments (topic_id, voter, agent, body) SELECT $1, 'eve', 'Claude Code', 'again ' || n FROM generate_series(1, $2::int) n`, [t.id, PRIVATE_POSTS_PER_DAY - 2]);
		await post(pg, { topic: t.id, space: s.id }, { login: 'eve', agent: 'Claude Code' }, { body: 'The last one today.' });
		await assert.rejects(post(pg, { topic: t.id, space: s.id }, eve, { body: 'One too many.' }), /2,000 posts in private spaces today, agents included/);
		await assert.rejects(startTopic(pg, eve, { title: 'Another', body: 'x', space: s.id }), /2,000 posts in private spaces today/);
		assert.equal((await pg.query('SELECT 1 FROM open_index.moderations WHERE voter = $1', ['eve'])).rows.length, 0, 'none of it counted against the 30 public attempts a day');
		await deleteSpace(pg, s.id, eve);
	});

	test('when the last member leaves, the space goes with them', async () => {
		const s = await createSpace(pg, bob, { title: 'Bob alone' });
		await addMember(pg, s.id, bob, 'carol', 'join me');
		await removeMember(pg, s.id, bob, 'bob');
		assert.equal((await pg.query('SELECT 1 FROM open_index.spaces WHERE id = $1', [s.id])).rows.length, 0);
		assert.deepEqual(await mySpaces(pg, 'carol'), [], 'and the invitation to it');
		await assert.rejects(deleteSpace(pg, FORUM, alice), NotFoundError, 'the forum is nobody\'s to delete');
		await assert.rejects(removeMember(pg, FORUM, alice, 'alice'), NotFoundError);
		await assert.rejects(addMember(pg, FORUM, alice, 'bob'), NotFoundError);
	});
});

describe('nothing private leaks', () => {
	let slug = '', topic = 0, firstPost = 0, davePost = 0, publicTopic = 0;
	const OUTSIDERS = [undefined, 'eve', 'carol', 'dave'] as const; // nobody, a stranger, invited but not accepted, removed
	const name = (who?: string) => who ?? 'nobody signed in';
	/** A reply with everything that names this space taken out, so two replies can be compared. */
	const hide = (text: string, ...names: (string | number)[]) => names.reduce<string>((t, n) => t.replace(new RegExp(`\\b${n}\\b`, 'g'), '#'), text);
	const blind = (r: Reply, ...names: (string | number)[]) => ({ status: r.status, text: hide(r.text, ...names) });
	/** A reply's text without the query it echoes back. */
	const shown = (r: Reply) => (r.json && 'query' in r.json ? JSON.stringify({ ...r.json, query: undefined }) : r.text);

	before(async () => {
		moderated = [];
		// Public things first: a forum topic by Alice and one by Dave, and a comment on the record.
		publicTopic = (await startTopic(pg, alice, { title: 'Which boundary conditions?', body: 'Does an open chain leave endpoint terms?' })).id;
		await startTopic(pg, dave, { title: 'A second public question', body: 'Is the gap uniform?' });
		await comment(pg, RECORD, bob, { body: 'Equation 2 omits the endpoint term.' });
		assert.equal(moderated.length, 3, 'public posts are moderated');

		// The private space: Alice creates it, Bob and Dave join, Carol is invited and does not accept, Dave is removed.
		const s = await createSpace(pg, alice, { title: 'Reading group', about: `Plans for the ${SECRET} proof.` });
		slug = s.id;
		for (const who of [bob, dave]) { await addMember(pg, slug, alice, who.login); await addMember(pg, slug, who, who.login); }
		await addMember(pg, slug, alice, 'carol', 'come and read with us');
		const t = await startTopic(pg, alice, { title: `The ${SECRET} lemma`, body: `A ${SECRET} sketch, building on ${RECORD} and https://example.org/space-record.`, space: slug });
		topic = t.id; firstPost = t.question.id;
		davePost = Number((await post(pg, { topic, space: slug }, dave, { body: `Dave's ${SECRET} remark about ${RECORD}.` })).id);
		await post(pg, { topic, space: slug }, bob, { body: `Options: yes | no\n\nIs the ${SECRET} step right?`, parent: davePost });
		await removeMember(pg, slug, alice, 'dave');
	});

	test('posts in a private space are not moderated, and nothing of them reaches the moderation provider', async () => {
		assert.equal(moderated.length, 3, 'no call for the private topic or its replies');
		const mine = (await pg.query<{ id: number; revision: string }>('SELECT id::int, xmin::text AS revision FROM open_index.comments WHERE id = $1', [firstPost])).rows[0];
		await editPost(pg, mine.id, alice, { body: `A ${SECRET} sketch, revised, on ${RECORD}.`, revision: mine.revision });
		assert.equal(moderated.length, 3, 'nor for an edit');
		assert.equal((await pg.query('SELECT 1 FROM open_index.moderations WHERE at > now() - interval \'1 minute\'')).rows.length, 3, 'and no row in the moderation ledger');
		// A public post made afterwards is moderated, with public context only.
		await post(pg, { topic: publicTopic }, bob, { body: 'The sum telescopes, retaining endpoints.' });
		assert.equal(moderated.length, 4);
		for (const sent of moderated) assert.ok(!sent.includes(SECRET), 'private text in a moderation request');
		// What still applies in private: a post carrying an agent key is refused and the key revoked.
		const key = await createAgentKey(pg, 'alice', 'Leaky');
		await assert.rejects(post(pg, { topic, space: slug }, alice, { body: `my key is ${key}` }), /contains an agent key/);
		assert.ok(PRIVATE_POSTS_PER_DAY >= 1000, 'the private limit is generous');
	});

	test('a private post that names a record is not a mention of it', async () => {
		const counts = async () => (await pg.query<{ mentions: number; comments: number }>('SELECT mentions_count AS mentions, comments_count AS comments FROM open_index.records WHERE id = $1', [RECORD])).rows[0];
		assert.deepEqual(await counts(), { mentions: 0, comments: 1 });
		assert.equal((await pg.query('SELECT 1 FROM open_index.mentions m JOIN open_index.comments c ON c.id = m.comment_id JOIN open_index.topics t ON t.id = c.topic_id WHERE t.space_id <> \'forum\'')).rows.length, 0);
		assert.deepEqual((await topicThread(pg, topic, 'alice', slug))!.posts.map((p) => p.mentions), [[], [], []], 'not even to its members');
		// The same words in the forum are a mention.
		await post(pg, { topic: publicTopic }, bob, { body: `Compare ${RECORD}.` });
		assert.deepEqual(await counts(), { mentions: 1, comments: 1 });
		const rec = await api('GET', '/api/v1/get/app/space-record');
		assert.equal(rec.json.mentions, 1);
		assert.ok(!rec.text.includes(SECRET));
	});

	for (const who of OUTSIDERS) {
		describe(`as ${name(who)}`, () => {
			test('the six verbs read nothing of it, and answer as for a space that does not exist', async () => {
				const ghost = 'reading-group-zzzzz', noTopic = 987654, noPost = 987655;
				// Every path under the space, beside the same path under a slug that names nothing.
				const pairs: [string, string][] = [
					[`ws/${slug}`, `ws/${ghost}`], [`ws/${slug}/${topic}`, `ws/${ghost}/${noTopic}`], [`ws/${slug}/${topic}/${firstPost}`, `ws/${ghost}/${noTopic}/${noPost}`],
					[`ws/${slug}/members`, `ws/${ghost}/members`], [`ws/${slug}/members/alice`, `ws/${ghost}/members/alice`],
					// A private topic's number under the forum's path.
					[`forum/${topic}`, `forum/${noTopic}`], [`forum/${topic}/${firstPost}`, `forum/${noTopic}/${noPost}`],
				];
				for (const [real, none] of pairs) {
					// Carol is invited: her own invitation is hers to read, and is checked below.
					const got = await api('GET', `/api/v1/get/${real}`, who), absent = await api('GET', `/api/v1/get/${none}`, who);
					assert.equal(got.status, 404, `get ${real}`);
					assert.deepEqual(blind(got, slug, topic, firstPost), blind(absent, ghost, noTopic, noPost), `get ${real} answers as get ${none}`);
				}
				for (const [real, none] of pairs.filter(([p]) => !p.includes('/members') && p.split('/').length < 4 && p !== `forum/${topic}/${firstPost}`)) {
					const got = await api('GET', `/api/v1/log?path=${real}`, who), absent = await api('GET', `/api/v1/log?path=${none}`, who);
					if (real.startsWith('forum/')) {
						// The forum's path of a private topic lists nothing, as an empty forum topic would.
						assert.deepEqual([got.status, got.json.entries], [200, []], `log ${real}`);
						assert.deepEqual(absent.json.entries, []);
					} else {
						assert.equal(got.status, 404, `log ${real}`);
						assert.deepEqual(blind(got, slug, topic), blind(absent, ghost, noTopic), `log ${real} answers as log ${none}`);
					}
				}
				// The lists that span everything.
				for (const url of ['/api/v1/log', '/api/v1/log?since=0&limit=200', '/api/v1/log?format=text&limit=200', '/api/v1/log?path=forum', '/api/v1/log?path=app', `/api/v1/log?path=${RECORD}`,
					'/api/v1/find?in=forum', `/api/v1/find?in=forum&q=${SECRET}`, '/api/v1/find?in=forum&q=lemma', `/api/v1/find?q=${SECRET}`, '/api/v1/find']) {
					const got = await api('GET', url, who);
					assert.equal(got.status, 200, url);
					assert.ok(!shown(got).includes(SECRET), `${url} shows private text`);
					// Carol's log holds her invitation, which names the space; nobody else's names it.
					if (who !== 'carol') assert.ok(!got.text.includes(slug), `${url} names the space`);
					if (url.includes(`q=${SECRET}`) || url.includes('q=lemma')) assert.equal(got.json.total, 0, `${url} counts private matches`);
				}
				const mine = await api('GET', '/api/v1/log?path=ws', who), spaces = await api('GET', '/api/v1/get/ws', who);
				if (!who) assert.deepEqual([mine.status, spaces.status], [401, 401]);
				else {
					assert.ok(!mine.text.includes(SECRET) && !spaces.text.includes(SECRET));
					if (who !== 'carol') assert.ok(!mine.text.includes(slug) && !spaces.text.includes(slug), 'a stranger and a removed member have nothing of it');
				}
			});

			test('the six verbs write nothing to it', async () => {
				const ghost = 'reading-group-zzzzz', noTopic = 987654, noPost = 987655;
				const count = async () => (await pg.query<{ n: number }>(`SELECT (SELECT count(*) FROM open_index.comments) + (SELECT count(*) FROM open_index.post_votes) + (SELECT count(*) FROM open_index.space_members)
					+ (SELECT count(*) FROM open_index.topics) + (SELECT count(*) FROM open_index.spaces) AS n`)).rows[0].n;
				const before = await count();
				const revision = (await pg.query<{ r: string }>('SELECT xmin::text AS r FROM open_index.comments WHERE id = $1', [davePost])).rows[0].r;
				const writes: [string, string, string, object][] = [
					['POST', `post/ws/${slug}`, `post/ws/${ghost}`, { title: 'Let me in', body: 'Hello.' }],
					['POST', `post/ws/${slug}/${topic}`, `post/ws/${ghost}/${noTopic}`, { body: 'An answer.' }],
					['POST', `post/ws/${slug}/${topic}/${firstPost}`, `post/ws/${ghost}/${noTopic}/${noPost}`, { body: 'A reply.' }],
					['POST', `post/forum/${topic}`, `post/forum/${noTopic}`, { body: 'An answer by the forum\'s path.' }],
					['POST', `post/forum/${topic}/${firstPost}`, `post/forum/${noTopic}/${noPost}`, { body: 'A reply by the forum\'s path.' }],
					['POST', `post/ws/${slug}/members`, `post/ws/${ghost}/members`, { body: 'eve let her in' }],
					['PATCH', `edit/ws/${slug}/${topic}/${davePost}`, `edit/ws/${ghost}/${noTopic}/${noPost}`, { body: 'Mine again.', revision }],
					['PATCH', `edit/forum/${topic}/${davePost}`, `edit/forum/${noTopic}/${noPost}`, { body: 'Mine again.', revision }],
					['POST', `vote/ws/${slug}/${topic}/${firstPost}`, `vote/ws/${ghost}/${noTopic}/${noPost}`, { value: 1 }],
					['POST', `vote/ws/${slug}/${topic}`, `vote/ws/${ghost}/${noTopic}`, { value: 1 }],
					['POST', `vote/forum/${topic}/${firstPost}`, `vote/forum/${noTopic}/${noPost}`, { value: 1 }],
					['POST', `vote/forum/${topic}`, `vote/forum/${noTopic}`, { value: -1 }],
					['POST', `vote/ws/${slug}/${topic}/${davePost}`, `vote/ws/${ghost}/${noTopic}/${noPost}`, { accept: true }],
					['POST', `vote/ws/${slug}`, `vote/ws/${ghost}`, { value: 0 }],
					['POST', `vote/ws/${slug}/members/alice`, `vote/ws/${ghost}/members/alice`, { value: 0 }],
					['POST', `vote/ws/${slug}/members/bob`, `vote/ws/${ghost}/members/bob`, { value: 0 }],
				];
				writes.push(['DELETE', `ws/${slug}`, `ws/${ghost}`, {}], ['DELETE', `ws/${slug}/members/alice`, `ws/${ghost}/members/alice`, {}], ['DELETE', `ws/${slug}/members/bob`, `ws/${ghost}/members/bob`, {}]);
				// Posting their own login to the member list lets nobody in who was not invited. (Carol was: that is her acceptance, tried last.)
				if (who && who !== 'carol') writes.push(['POST', `post/ws/${slug}/members`, `post/ws/${ghost}/members`, { body: who }], ['POST', `vote/ws/${slug}/members/${who}`, `vote/ws/${ghost}/members/${who}`, { value: 0 }],
					['DELETE', `ws/${slug}/members/${who}`, `ws/${ghost}/members/${who}`, {}]);
				for (const [method, real, none, sent] of writes) {
					const body = method === 'DELETE' ? undefined : sent;
					const got = await api(method, `/api/v1/${real}`, who, body), absent = await api(method, `/api/v1/${none}`, who, body);
					assert.equal(got.status, who ? 404 : 401, `${method} ${real}: ${got.text}`);
					assert.deepEqual(blind(got, slug, topic, firstPost, davePost), blind(absent, ghost, noTopic, noPost), `${method} ${real} answers as ${none}`);
				}
				assert.equal(await count(), before, 'nothing was stored, voted, joined or deleted');
			});

			test('the older REST operations show and change nothing of it', async () => {
				const noTopic = 987654, noPost = 987655;
				for (const url of ['/api/v1/forum', '/api/v1/forum?limit=100', '/api/v1/forum?since=0', `/api/v1/forum?q=${SECRET}`, '/api/v1/forum?q=lemma', `/api/v1/search?q=${SECRET}`, '/api/v1/search',
					'/api/v1/records/app/space-record', '/api/v1/records/app/space-record/comments', '/api/v1/records/app/space-record/vote',
					'/api/v1/users/alice', '/api/v1/users/alice?tab=topics', '/api/v1/users/dave', '/api/v1/users/dave?tab=replies', '/api/v1/users/bob?tab=comments', '/api/v1/prefixes']) {
					const got = await api('GET', url, who);
					assert.equal(got.status, 200, `${url}: ${got.text.slice(0, 200)}`);
					assert.ok(!shown(got).includes(SECRET) && !got.text.includes(slug), `${url} shows something of the space`);
				}
				const forum = (await api('GET', '/api/v1/forum?limit=100&since=0', who)).json;
				assert.ok(forum.questions.every((q: { id: number }) => q.id !== topic) && forum.latest_posts.every((p: { topic_id: number | null }) => p.topic_id !== topic));
				assert.equal((await api('GET', `/api/v1/forum?q=${SECRET}`, who)).json.total, 0);
				// A profile counts public posts only: Alice has one forum topic, Dave one, whatever they wrote in the space.
				assert.deepEqual((await api('GET', '/api/v1/users/alice', who)).json.counts, { topics: 1, replies: 0, comments: 0, votes: 0 });
				assert.deepEqual((await api('GET', '/api/v1/users/dave', who)).json.counts, { topics: 1, replies: 0, comments: 0, votes: 0 });
				const got = await api('GET', `/api/v1/forum/${topic}`, who), absent = await api('GET', `/api/v1/forum/${noTopic}`, who);
				assert.deepEqual(blind(got, topic), blind(absent, noTopic));
				assert.equal(got.status, 404);
				const revision = (await pg.query<{ r: string }>('SELECT xmin::text AS r FROM open_index.comments WHERE id = $1', [davePost])).rows[0].r;
				const writes: [string, string, string, object][] = [
					['POST', `/api/v1/forum/${topic}`, `/api/v1/forum/${noTopic}`, { body: 'An answer.' }],
					['POST', `/api/v1/forum/${topic}`, `/api/v1/forum/${noTopic}`, { body: 'A comment.', parent: firstPost }],
					['POST', `/api/v1/forum/${topic}/vote`, `/api/v1/forum/${noTopic}/vote`, { post: firstPost, value: 1 }],
					['POST', `/api/v1/forum/${topic}/accept`, `/api/v1/forum/${noTopic}/accept`, { post: davePost }],
					['PATCH', `/api/v1/posts/${davePost}`, `/api/v1/posts/${noPost}`, { body: 'Mine again.', revision }],
					['PATCH', `/api/v1/posts/${firstPost}`, `/api/v1/posts/${noPost}`, { body: 'Not mine.', revision }],
				];
				for (const [method, real, none, body] of writes) {
					const done = await api(method, real, who, body), nothing = await api(method, none, who, body);
					assert.equal(done.status, who ? 404 : 401, `${method} ${real}: ${done.text}`);
					assert.deepEqual(blind(done, topic, davePost, firstPost, noTopic, noPost), blind(nothing, topic, davePost, firstPost, noTopic, noPost), `${method} ${real}`);
				}
			});

			for (const on of [false, true]) test(`each MCP tool shows and changes nothing of it, with spaces ${on ? 'open' : 'closed'} to MCP`, () => mcpSpaces(on, async () => {
				const ghost = 'reading-group-zzzzz', noTopic = 987654, noPost = 987655;
				const same = async (name: string, real: object, none: object) => {
					const got = await tool(name, real, who), absent = await tool(name, none, who);
					assert.equal(got.error, true, `${name} ${JSON.stringify(real)}: ${got.text}`);
					assert.equal(hide(got.text, slug, topic, firstPost, davePost), hide(absent.text, ghost, noTopic, noPost), `${name} ${JSON.stringify(real)}`);
				};
				for (const [real, none] of [[`ws/${slug}`, `ws/${ghost}`], [`ws/${slug}/${topic}`, `ws/${ghost}/${noTopic}`], [`ws/${slug}/${topic}/${firstPost}`, `ws/${ghost}/${noTopic}/${noPost}`],
					[`ws/${slug}/members`, `ws/${ghost}/members`], [`forum/${topic}`, `forum/${noTopic}`], [`forum/${topic}/${davePost}`, `forum/${noTopic}/${noPost}`]]) {
					await same('get', { id: real }, { id: none });
				}
				await same('log', { path: `ws/${slug}` }, { path: `ws/${ghost}` });
				await same('log', { path: `ws/${slug}/${topic}` }, { path: `ws/${ghost}/${noTopic}` });
				await same('post', { id: `ws/${slug}/${topic}`, body: 'An answer.' }, { id: `ws/${ghost}/${noTopic}`, body: 'An answer.' });
				await same('post', { id: `ws/${slug}`, title: 'T', body: 'A topic.' }, { id: `ws/${ghost}`, title: 'T', body: 'A topic.' });
				await same('post', { id: `forum/${topic}`, body: 'An answer.' }, { id: `forum/${noTopic}`, body: 'An answer.' });
				await same('post', { id: `ws/${slug}/members`, body: 'eve' }, { id: `ws/${ghost}/members`, body: 'eve' });
				await same('edit', { id: `ws/${slug}/${topic}/${davePost}`, body: 'Mine.', revision: '1' }, { id: `ws/${ghost}/${noTopic}/${noPost}`, body: 'Mine.', revision: '1' });
				await same('vote', { id: `ws/${slug}/${topic}/${firstPost}`, value: 1 }, { id: `ws/${ghost}/${noTopic}/${noPost}`, value: 1 });
				await same('vote', { id: `ws/${slug}`, value: 0 }, { id: `ws/${ghost}`, value: 0 });
				await same('vote', { id: `ws/${slug}/members/alice`, value: 0 }, { id: `ws/${ghost}/members/alice`, value: 0 });
				for (const [name, args] of [['search', { in: 'forum' }], ['search', { in: 'forum', q: SECRET }], ['search', { q: SECRET }], ['log', {}], ['log', { since: 0, limit: 200 }], ['log', { path: 'forum' }],
					['log', { path: `forum/${topic}` }], ['log', { path: RECORD }], ['get', { id: RECORD }], ['get', { id: `forum/${publicTopic}` }]] as [string, object][]) {
					const got = await tool(name, args, who);
					assert.equal(got.error, false, `${name} ${JSON.stringify(args)}: ${got.text}`);
					assert.ok(!JSON.stringify({ ...got.out, query: undefined }).includes(SECRET), `${name} ${JSON.stringify(args)} shows private text`);
					if (who !== 'carol' || !on) assert.ok(!got.text.includes(slug), `${name} ${JSON.stringify(args)} names the space`);
				}
				const mine = await tool('log', { path: 'ws' }, who), spaces = await tool('get', { id: 'ws' }, who);
				if (!who || !on) assert.deepEqual([mine.error, spaces.error], [true, true], 'nobody signed in is asked to sign in; closed, ws names nothing');
				// Closed to MCP, not even Carol's invitation is there to read.
				if (!on) for (const args of [{}, { since: 0, limit: 200 }]) assert.ok(!(await tool('log', args, who)).text.includes(slug));
				for (const got of [mine, spaces]) assert.ok(!got.text.includes(SECRET) && (who === 'carol' || !got.text.includes(slug)));
			}));

			test('the log\'s query, its Atom feed and the text forms of pages have nothing of it', async () => {
				const ghost = 'reading-group-zzzzz', noTopic = 987654, noPost = 987655;
				// A query looks into posts' text and topics' titles, at who wrote to whom, and at what names a record.
				const queries = [SECRET, 'lemma', 'sketch', 'by:@alice', 'by:@dave', 'by:@bob', 'to:@dave', 'to:@alice', `re:${RECORD}`, 'kind:question', 'kind:answer OR kind:comment', 'NOT kind:record'];
				for (const q of queries) {
					for (const format of ['json', 'text', 'atom']) {
						const got = await api('GET', `/api/v1/log?since=0&limit=200&format=${format}&q=${encodeURIComponent(q)}`, who);
						assert.equal(got.status, 200, `log q=${q} ${format}: ${got.text.slice(0, 200)}`);
						// An Atom feed's own title and address repeat the query; its entries are what must hold nothing.
						const shown = format === 'atom' ? got.text.slice(got.text.indexOf('<entry>') < 0 ? got.text.length : got.text.indexOf('<entry>')) : got.text;
						assert.ok(!shown.includes(SECRET) && !got.text.includes(slug), `log q=${q} as ${format} shows something of the space`);
					}
					const viaMcp = await tool('log', { q, since: 0, limit: 200 }, who);
					assert.ok(!viaMcp.error && !viaMcp.text.includes(SECRET) && !viaMcp.text.includes(slug), `the log tool with q=${q}`);
				}
				assert.deepEqual((await api('GET', `/api/v1/log?since=0&q=${SECRET}`, who)).json.entries, []);
				// to:@me is the caller's inbox: nothing of the space in it for an outsider, Dave included, whose post there was replied to.
				const inbox = await api('GET', '/api/v1/log?since=0&q=to:@me', who);
				if (!who) assert.equal(inbox.status, 401);
				// Carol's inbox holds her invitation, and that alone; nobody else's names the space.
				else if (who === 'carol') assert.deepEqual(inbox.json.entries.map((e: { path: string; text: string }) => [e.path, e.text]), [[`ws/${slug}/members/carol`, `invited @carol to ws/${slug}: come and read with us`]]);
				else assert.ok(inbox.status === 200 && !inbox.text.includes(SECRET) && !inbox.text.includes(slug));
				// The feed and the text forms are public: read as nobody, whatever token comes with the request.
				const { GET: feed } = await import(`${APP.href}/log.atom/route.ts`);
				const { GET: text } = await import(`${APP.href}/txt/[...id]/route.ts`);
				const headers = who ? { Authorization: `Bearer ${keys[who]}` } : undefined;
				const atom = async (query: string) => { const r: Response = await feed(new Request(`http://localhost/log.atom${query}`, { headers })); return { status: r.status, text: await r.text(), cache: r.headers.get('cache-control') ?? '' }; };
				const txt = async (path: string) => { const r: Response = await text(new Request(`http://localhost/txt/${path}`, { headers }), { params: Promise.resolve({ id: path.split('/') }) }); return { status: r.status, text: await r.text() }; };
				for (const query of ['', '?path=forum', `?path=${RECORD}`, '?q=kind:question']) {
					const got = await atom(query);
					assert.deepEqual([got.status, got.text.includes(SECRET) || got.text.includes(slug)], [200, false], `log.atom${query}`);
					assert.match(got.cache, /^public/);
				}
				const hide = (t: string) => [slug, ghost, topic, noTopic, firstPost, noPost].reduce<string>((x, n) => x.replace(new RegExp(`\\b${n}\\b`, 'g'), '#'), t);
				for (const [real, none] of [[`ws/${slug}`, `ws/${ghost}`], [`ws/${slug}/${topic}`, `ws/${ghost}/${noTopic}`]]) {
					const got = await atom(`?path=${real}`), absent = await atom(`?path=${none}`);
					assert.deepEqual([got.status, hide(got.text)], [404, hide(absent.text)], `log.atom?path=${real}`);
				}
				for (const [real, none] of [[`ws/${slug}/${topic}`, `ws/${ghost}/${noTopic}`], [`ws/${slug}/${topic}/${firstPost}`, `ws/${ghost}/${noTopic}/${noPost}`],
					[`forum/${topic}`, `forum/${noTopic}`], [`forum/${topic}/${firstPost}`, `forum/${noTopic}/${noPost}`]]) {
					const got = await txt(real), absent = await txt(none);
					assert.deepEqual([got.status, hide(got.text)], [404, hide(absent.text)], `the text form of ${real}`);
				}
				for (const path of [`forum/${publicTopic}`, RECORD]) {
					const got = await txt(path);
					assert.deepEqual([got.status, got.text.includes(SECRET) || got.text.includes(slug)], [200, false], `the text form of ${path}`);
				}
			});

			test('what the web pages read, the profile, the feed and the sitemap have nothing of it', async () => {
				const reader = who ?? null;
				// /ws/<slug> and /ws/<slug>/<n> render from these, and show not-found when they are null.
				assert.equal(await space(pg, slug, reader), null);
				assert.equal(await members(pg, slug, reader), null);
				assert.equal(await topicThread(pg, topic, reader, slug), null);
				assert.equal(await topicWithPosts(pg, topic, reader), null);
				assert.equal(await topicWithPosts(pg, topic, reader, FORUM), null);
				assert.deepEqual((await topics(pg, reader, { space: slug })).questions, []);
				assert.equal((await topics(pg, reader, { space: slug })).total, 0);
				assert.ok((await topics(pg, reader)).questions.every((t) => t.space === FORUM));
				assert.deepEqual((await topics(pg, reader, { q: SECRET })).total, 0);
				assert.ok((await log(pg, reader, {}, { limit: 200 })).entries.every((e) => !e.body.includes(SECRET) && !e.subject.includes(SECRET)));
				// /ws lists a person's own spaces: for Carol her invitation, with its title, inviter and note and nothing else.
				const listed = who ? await mySpaces(pg, who) : [];
				assert.deepEqual(listed.map((s) => [s.id, s.title, s.invited_by, s.note, s.accepted_at, s.topics]), who === 'carol' ? [[slug, 'Reading group', 'alice', 'come and read with us', null, 0]] : []);
				// The forum's pages (/forum, /forum/<n>) read as nobody signed in, whoever is looking.
				assert.equal(await topicWithPosts(pg, topic, null, FORUM), null);
				// A profile (/u/<login>) is public activity, the same for every viewer.
				for (const login of ['alice', 'bob', 'dave']) {
					const p = await profile(pg, login, { tab: 'all' });
					assert.ok(!JSON.stringify(p).includes(SECRET) && !JSON.stringify(p).includes(slug), `${login}'s profile`);
				}
				assert.ok((await activity(pg, { limit: 100 })).posts.every((p) => p.topic_id !== topic && !p.body.includes(SECRET)));
				// A web form's retry looks up the author's earlier post: not for a member who was removed.
				if (who) await assert.rejects(submitPostForm(pg, person(who), { kind: 'answer', title: '', body: `Dave's ${SECRET} remark about ${RECORD}.`, topic, review: false, space: slug }), NotFoundError);
				if (who) await assert.rejects(submitPostForm(pg, person(who), { kind: 'question', title: `The ${SECRET} lemma`, body: 'x', review: false, space: slug }), NotFoundError);
				for (let n = 0; n < await sitemapFiles(pg); n++) {
					const file = JSON.stringify(await sitemapFile(pg, 'https://delphi.science', n));
					assert.ok(!file.includes('/ws') && !file.includes(slug) && !file.includes(SECRET));
				}
			});
		});
	}

	test('usage analytics never mounts on a space\'s pages', () => {
		for (const path of ['/ws', '/ws/', `/ws/${slug}`, `/ws/${slug}/${topic}`, `/ws/${slug}/members`]) assert.equal(analyticsPath(path), null, path);
		assert.equal(analyticsPath('/forum'), '/forum', 'the forum is still counted');
	});

	test('a member and that member\'s agent key read and write all of it, privately', async () => {
		for (const who of ['alice', 'alice-agent', 'bob']) {
			const s = await api('GET', `/api/v1/get/ws/${slug}`, who);
			assert.deepEqual([s.status, s.json.title, s.json.authors, s.cache], [200, 'Reading group', ['alice', 'bob'], 'private, no-store'], who);
			assert.ok(s.json.body.includes(`Plans for the ${SECRET} proof.`) && s.json.body.includes(`ws/${slug}/${topic}`));
			const t = await api('GET', `/api/v1/get/ws/${slug}/${topic}`, who);
			assert.deepEqual([t.status, t.json.title, t.json.answers.length, t.json.answers[0].comments.length], [200, `The ${SECRET} lemma`, 1, 1], who);
			assert.equal((await api('GET', `/api/v1/get/ws/${slug}/${topic}/${davePost}`, who)).json.voter, 'dave', 'a removed member\'s posts stay');
			const people = await api('GET', `/api/v1/get/ws/${slug}/members`, who);
			assert.deepEqual(people.json.body.split('\n').map((l: string) => l.split('\t').slice(0, 2).join(' ')), [`ws/${slug}/members/alice creator`, `ws/${slug}/members/bob member`, `ws/${slug}/members/carol invited`]);
			const lines = await api('GET', `/api/v1/log?path=ws/${slug}/${topic}`, who);
			assert.deepEqual([lines.json.entries.length, lines.cache], [3, 'private, no-store'], who);
			const all = await api('GET', '/api/v1/log?limit=200', who);
			assert.ok(all.json.entries.some((e: { path: string }) => e.path === `ws/${slug}/${topic}/${firstPost}`), 'the whole log holds their spaces\' posts');
			assert.ok((await api('GET', '/api/v1/log?path=ws', who)).json.entries.every((e: { path: string }) => e.path.startsWith('ws/')));
			assert.ok((await api('GET', '/api/v1/log?path=forum', who)).json.entries.every((e: { path: string }) => e.path.startsWith('forum/')), 'the forum\'s log is the forum\'s');
			assert.deepEqual((await api('GET', `/api/v1/find?in=forum&q=${SECRET}`, who)).json.results.map((r: { id: string }) => r.id), [`ws/${slug}/${topic}`]);
			await mcpSpaces(true, async () => {
				const viaMcp = await tool('get', { id: `ws/${slug}/${topic}` }, who);
				assert.deepEqual([viaMcp.error, viaMcp.out!.title], [false, `The ${SECRET} lemma`]);
				assert.equal((await tool('log', { path: `ws/${slug}` }, who)).out!.entries.length, 6, 'three posts, the invitations to Bob and Carol, and Bob\'s acceptance (Dave\'s lines went with him)');
				assert.equal((await tool('search', { in: 'forum', q: 'lemma' }, who)).out!.results[0].id, `ws/${slug}/${topic}`);
				assert.ok((await tool('log', { since: 0, limit: 200 }, who)).text.includes(SECRET));
			});
		}
		// Writing: a reply from the agent, a vote and an accept from the people.
		const reply = await mcpSpaces(true, () => tool('post', { id: `ws/${slug}/${topic}`, body: `An agent's ${SECRET} answer.` }, 'alice-agent'));
		assert.equal(reply.error, false, reply.text);
		const id = reply.out!.id as string;
		assert.deepEqual((await api('POST', `/api/v1/vote/${id}`, 'bob', { value: 1 })).json, { id, score: 1 });
		assert.deepEqual((await api('POST', `/api/v1/vote/${id}`, 'alice', { accept: true })).json, { id, accepted: id });
		assert.match((await api('POST', `/api/v1/vote/${id}`, 'alice', { value: 1 })).json.error.message, /cannot vote on your own post/);
		// A member's queries reach the space: a word in it, and Dave's post that Bob replied to (to:@dave).
		assert.ok((await api('GET', `/api/v1/log?since=0&q=${SECRET}`, 'bob')).json.entries.length >= 3);
		assert.ok((await api('GET', '/api/v1/log?since=0&q=to:@dave', 'alice')).json.entries.some((e: { path: string }) => e.path.startsWith(`ws/${slug}/`)));
		// But a feed and a text form are public even for a member with a token: they are read as nobody.
		const { GET: feed } = await import(`${APP.href}/log.atom/route.ts`);
		const asAlice = { headers: { Authorization: `Bearer ${keys.alice}` } };
		const all: Response = await feed(new Request('http://localhost/log.atom', asAlice));
		assert.ok(all.status === 200 && !(await all.text()).includes(SECRET), 'a member\'s token adds nothing to a feed');
		assert.equal(((await feed(new Request(`http://localhost/log.atom?path=ws/${slug}`, asAlice))) as Response).status, 404);
		assert.equal((await api('GET', `/api/v1/log?format=atom&path=ws/${slug}/${topic}`, 'alice')).status, 404);
		const { GET: text } = await import(`${APP.href}/txt/[...id]/route.ts`);
		assert.equal(((await text(new Request(`http://localhost/txt/ws/${slug}/${topic}`, asAlice), { params: Promise.resolve({ id: ['ws', slug, String(topic)] }) })) as Response).status, 404);
		// A private topic is not at the forum's path even for its members: one path each.
		assert.equal((await api('GET', `/api/v1/get/forum/${topic}`, 'alice')).status, 404);
		assert.equal((await api('POST', `/api/v1/forum/${topic}`, 'alice', { body: 'By the forum\'s route.' })).status, 404);
		assert.equal(moderated.filter((m) => m.includes(SECRET)).length, 0);
	});

	test('closed to MCP (the default), a member\'s own tools find no ws path and read nothing private; REST is unaffected', () => mcpSpaces(false, async () => {
		const ghost = 'reading-group-zzzzz', noTopic = 987654, noPost = 987655;
		const hide = (t: string) => [slug, ghost, topic, noTopic, firstPost, noPost].reduce<string>((x, n) => x.replace(new RegExp(`\\b${n}\\b`, 'g'), '#'), t);
		const count = async () => (await pg.query<{ n: number }>('SELECT (SELECT count(*) FROM open_index.comments) + (SELECT count(*) FROM open_index.spaces) + (SELECT count(*) FROM open_index.space_members) + (SELECT count(*) FROM open_index.post_votes) AS n')).rows[0].n;
		const before = await count();
		for (const who of ['alice', 'alice-agent', 'bob']) {
			const calls: [string, object, object][] = [
				['get', { id: 'ws' }, { id: 'zz' }],
				['get', { id: `ws/${slug}` }, { id: `ws/${ghost}` }], ['get', { id: `ws/${slug}/${topic}` }, { id: `ws/${ghost}/${noTopic}` }],
				['get', { id: `ws/${slug}/${topic}/${firstPost}` }, { id: `ws/${ghost}/${noTopic}/${noPost}` }], ['get', { id: `ws/${slug}/members` }, { id: `ws/${ghost}/members` }],
				['get', { id: `forum/${topic}` }, { id: `forum/${noTopic}` }], ['get', { id: `forum/${topic}/${firstPost}` }, { id: `forum/${noTopic}/${noPost}` }],
				['log', { path: `ws/${slug}` }, { path: `ws/${ghost}` }], ['log', { path: `ws/${slug}/${topic}` }, { path: `ws/${ghost}/${noTopic}` }],
				['post', { id: 'ws', title: 'A space', body: 'By MCP.' }, { id: 'zz', title: 'A space', body: 'By MCP.' }],
				['post', { id: `ws/${slug}`, title: 'T', body: 'A topic.' }, { id: `ws/${ghost}`, title: 'T', body: 'A topic.' }],
				['post', { id: `ws/${slug}/${topic}`, body: 'An answer.' }, { id: `ws/${ghost}/${noTopic}`, body: 'An answer.' }],
				['post', { id: `forum/${topic}`, body: 'An answer.' }, { id: `forum/${noTopic}`, body: 'An answer.' }],
				['post', { id: `ws/${slug}/members`, body: 'eve' }, { id: `ws/${ghost}/members`, body: 'eve' }],
				['edit', { id: `ws/${slug}/${topic}/${firstPost}`, body: 'Mine.', revision: '1' }, { id: `ws/${ghost}/${noTopic}/${noPost}`, body: 'Mine.', revision: '1' }],
				['vote', { id: `ws/${slug}/${topic}/${firstPost}`, value: 1 }, { id: `ws/${ghost}/${noTopic}/${noPost}`, value: 1 }],
				['vote', { id: `ws/${slug}/members/bob`, value: 0 }, { id: `ws/${ghost}/members/bob`, value: 0 }],
				['vote', { id: `ws/${slug}`, value: 0 }, { id: `ws/${ghost}`, value: 0 }],
			];
			for (const [name, real, none] of calls) {
				const got = await tool(name, real, who), absent = await tool(name, none, who);
				assert.equal(got.error, true, `${name} ${JSON.stringify(real)} as ${who}: ${got.text}`);
				assert.equal(hide(got.text).replace('no ws.', 'no zz.'), hide(absent.text), `${name} ${JSON.stringify(real)} as ${who} answers as for a path that names nothing`);
				assert.ok(!got.text.includes('Spaces:'), 'and the refusal does not speak of spaces');
			}
			for (const [name, args] of [['search', { in: 'forum' }], ['search', { in: 'forum', q: SECRET }], ['search', { in: 'forum', q: 'lemma' }], ['log', {}], ['log', { since: 0, limit: 200 }],
				['log', { path: 'forum' }], ['log', { q: SECRET, since: 0 }], ['log', { q: 'to:@me', since: 0 }], ['log', { q: 'by:@me', since: 0 }], ['log', { path: `forum/${topic}` }], ['get', { id: 'me' }]] as [string, object][]) {
				const got = await tool(name, args, who);
				assert.equal(got.error, false, `${name} ${JSON.stringify(args)} as ${who}: ${got.text}`);
				assert.ok(!JSON.stringify({ ...got.out, query: undefined }).includes(SECRET) && !got.text.includes(slug), `${name} ${JSON.stringify(args)} as ${who} reads something private`);
			}
			// The public things a signed-in MCP caller did before still work: @me names them, and they post to the forum.
			assert.ok((await tool('log', { q: 'by:@me', since: 0 }, who)).out!.entries.every((e: { by: string; path: string }) => e.by === (who === 'bob' ? 'bob' : 'alice') && !e.path.startsWith('ws/')));
			// And the same person by REST, at the same moment, reads their space.
			assert.equal((await api('GET', `/api/v1/get/ws/${slug}/${topic}`, who)).status, 200);
		}
		assert.equal(await count(), before, 'nothing was written through MCP');
		assert.equal((await tool('get', { id: `forum/${publicTopic}` }, 'alice')).error, false);
	}));

	test('an invitation, once accepted, opens the whole history; a removed member gets nothing more', async () => {
		assert.equal((await api('POST', `/api/v1/post/ws/${slug}/members`, 'carol', { body: 'carol' })).status, 201);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}/${topic}/${firstPost}`, 'carol')).json.body, `A ${SECRET} sketch, revised, on ${RECORD}.`);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}`, 'dave')).status, 404);
		assert.ok(!(await api('GET', '/api/v1/log?limit=200', 'dave')).text.includes(SECRET));
		await assert.rejects(editPost(pg, davePost, dave, { body: 'Mine again.', revision: '1' }), (e: QueryError) => e instanceof NotFoundError && e.message === `no post ${davePost}`);
	});

	test('reads for nobody signed in may be cached; a signed-in reply never is', async () => {
		assert.match((await api('GET', '/api/v1/log')).cache, /^public/);
		assert.match((await api('GET', '/api/v1/find?in=forum')).cache, /^public/);
		for (const url of ['/api/v1/log', '/api/v1/find?in=forum', '/api/v1/find', `/api/v1/get/forum/${publicTopic}`]) assert.equal((await api('GET', url, 'eve')).cache, 'private, no-store', url);
	});
});

describe('the MCP tools as listed', () => {
	// What tools/list returns is what the plugin directories reviewed: names, descriptions, input and output schemas,
	// annotations and security schemes. Spaces changed none of it: the hash is that of the log-events branch they were
	// merged with (before it, of the agent-cli branch: 3c73e545…). If a change here is meant, agree it with whoever
	// holds the plugin submission, then update the hash.
	test('tools/list is byte for byte what it was before spaces', async () => {
		const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
			headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } });
		const text = await (await mcp(req, async () => pg)).text();
		assert.equal(createHash('sha256').update(text).digest('hex'), 'dcddc49cde2488ba3105477e81c74b05141d93a70964c89aa2b3edada6681a12');
	});
});
