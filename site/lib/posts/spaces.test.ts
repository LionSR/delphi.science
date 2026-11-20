// Spaces on in-process Postgres, through the route handlers: their life (open, invite, accept,
// leave, remove, delete), and above all that nothing private leaks. For a private space with content, everyone who is
// not a member (nobody signed in, a stranger, a person invited who has not accepted, a member who was removed) tries
// every way of reading and writing, and each must answer exactly as it would if the space did not exist.
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { createAgentKey, createSession, type Voter } from '#lib/accounts/keys.ts';
import { spec } from '#lib/api/openapi.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import { load } from '#lib/records/load.ts';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { comment, post } from './comments.ts';
import { editPost } from './edit.ts';
import { startTopic, topics } from './forum.ts';
import { addMember, createSpace, members, mySpaces, removeMember, space } from './spaces.ts';
import { canRead } from './visibility.ts';

allowRouteImports();

const APP = new URL('../../app', import.meta.url);
const RECORD = 'app/space-record';
// A word that is in every private text and nowhere else: if it shows up in a reply to an outsider, something leaked.
const SECRET = 'zanzibarine';

const person = (login: string): Voter => ({ login, agent: '' });
const alice = person('alice'), bob = person('bob'), carol = person('carol'), dave = person('dave'), eve = person('eve');

let pg: PGlite;
const keys: Record<string, string> = {};
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

before(async () => {
	process.env.DEEPSEEK_API_KEY = 'offline-spaces-fixture';
	globalThis.fetch = (async (url) => {
		assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'unexpected network call');
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
	test('posting a title to ws opens a private space with its creator as the only member: a notebook', async () => {
		assert.equal((await api('POST', '/api/v1/post/ws', undefined, { title: 'Notebook', body: 'x' })).status, 401);
		const made = await api('POST', '/api/v1/post/ws', 'alice', { title: 'Notebook on boundary terms', body: 'Working notes.' });
		assert.equal(made.status, 201);
		slug = made.json.id.slice(3);
		assert.deepEqual([made.json.title, made.json.voter, made.json.body, made.cache], ['Notebook on boundary terms', 'alice', 'Working notes.', 'private, no-store']);
		const s = (await space(pg, slug, 'alice'))!;
		assert.deepEqual([s.visibility, s.creator, s.topics], ['private', 'alice', 0]);
		assert.deepEqual((await members(pg, slug, 'alice'))!.map((m) => [m.login, m.creator, m.accepted_at !== null]), [['alice', true, true]]);
		assert.equal(await canRead(pg, slug, 'alice'), true);
		assert.equal(await canRead(pg, slug, 'ALICE'), true, 'GitHub logins ignore case');
		assert.equal(await canRead(pg, slug, 'bob'), false);
		assert.equal(await canRead(pg, slug, null), false);
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

		// Bob, invited: his log has the invitation, and get ws lists it; the space itself is still not his to read.
		const news = await api('GET', `/api/v1/log?since=${before}`, 'bob');
		assert.deepEqual(news.json.entries.map((e: Record<string, string>) => [e.kind, e.path, e.by, e.agent, e.subject, e.text]),
			[['comment', `ws/${slug}/members/bob`, 'alice', 'Claude Code', 'Notebook on boundary terms', `invited @bob to ws/${slug}: come and check my sums`]]);
		assert.match((await api('GET', '/api/v1/get/ws', 'bob')).json.body, new RegExp(`^ws/${slug}\\tinvited by @alice\\t\\S+\\tNotebook on boundary terms\\tcome and check my sums$`));
		assert.match((await api('GET', `/api/v1/get/ws/${slug}/members/bob`, 'bob')).json.body, /To accept, post your login/);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}`, 'bob')).status, 404);
		// He accepts by posting his own login, and reads all of it, earlier posts included.
		const mark = (await api('GET', '/api/v1/log', 'alice')).json.since;
		const accepted = await api('POST', `/api/v1/post/ws/${slug}/members`, 'bob', { body: 'bob' });
		assert.match(accepted.json.body, /\tmember\tby @alice\t/);
		assert.deepEqual((await api('GET', `/api/v1/log?since=${mark}`, 'alice')).json.entries.map((e: Record<string, string>) => [e.path, e.by, e.text]),
			[[`ws/${slug}/members/bob`, 'bob', `@bob accepted the invitation and joined ws/${slug}`]]);
		assert.equal((await api('GET', `/api/v1/log?path=ws/${slug}`, 'bob')).json.entries.length, 5, 'three posts, the invitation and the acceptance');
		assert.deepEqual((await api('GET', `/api/v1/get/ws/${slug}/members`, 'bob')).json.authors, ['alice', 'bob']);
		// Members are equal: Bob invites too.
		assert.equal((await api('POST', `/api/v1/post/ws/${slug}/members`, 'bob', { body: 'carol' })).status, 201);
	});

	test('anyone leaves by a vote; removing a member and deleting the space are operations of their own, not votes', async () => {
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
		// Deleting takes the topics and posts with it.
		const topic = (await topics(pg, 'alice', { space: slug })).questions[0].id;
		assert.deepEqual((await api('DELETE', `/api/v1/ws/${slug}`, 'alice')).json, { deleted: `ws/${slug}` });
		assert.equal(await space(pg, slug, 'alice'), null);
		assert.equal((await pg.query('SELECT 1 FROM open_index.topics WHERE id = $1 UNION ALL SELECT 1 FROM open_index.comments WHERE topic_id = $1', [topic])).rows.length, 0);
		assert.deepEqual(await mySpaces(pg, 'alice'), []);
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
		// Public things first: a forum topic by Alice and one by Dave, and a comment on the record.
		publicTopic = (await startTopic(pg, alice, { title: 'Which boundary conditions?', body: 'Does an open chain leave endpoint terms?' })).id;
		await startTopic(pg, dave, { title: 'A second public question', body: 'Is the gap uniform?' });
		await comment(pg, RECORD, bob, { body: 'Equation 2 omits the endpoint term.' });

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
					['POST', `post/forum/${topic}`, `post/forum/${noTopic}`, { body: 'An answer by the forum\'s path.' }],
					['POST', `post/ws/${slug}/members`, `post/ws/${ghost}/members`, { body: 'eve let her in' }],
					['PATCH', `edit/ws/${slug}/${topic}/${davePost}`, `edit/ws/${ghost}/${noTopic}/${noPost}`, { body: 'Mine again.', revision }],
					['POST', `vote/ws/${slug}/${topic}/${firstPost}`, `vote/ws/${ghost}/${noTopic}/${noPost}`, { value: 1 }],
					['POST', `vote/ws/${slug}`, `vote/ws/${ghost}`, { value: 0 }],
					['POST', `vote/ws/${slug}/members/alice`, `vote/ws/${ghost}/members/alice`, { value: 0 }],
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
		});
	}

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
		}
		// Writing: a reply from the agent, a vote and an accept from the people.
		const reply = await api('POST', `/api/v1/post/ws/${slug}/${topic}`, 'alice-agent', { body: `An agent's ${SECRET} answer.` });
		assert.equal(reply.status, 201, reply.text);
		const id = reply.json.id as string;
		assert.deepEqual((await api('POST', `/api/v1/vote/${id}`, 'bob', { value: 1 })).json, { id, score: 1 });
		assert.deepEqual((await api('POST', `/api/v1/vote/${id}`, 'alice', { accept: true })).json, { id, accepted: id });
		assert.match((await api('POST', `/api/v1/vote/${id}`, 'alice', { value: 1 })).json.error.message, /cannot vote on your own post/);
		// A member's queries reach the space: a word in it, and Dave's post that Bob replied to (to:@dave).
		assert.ok((await api('GET', `/api/v1/log?since=0&q=${SECRET}`, 'bob')).json.entries.length >= 3);
		assert.ok((await api('GET', '/api/v1/log?since=0&q=to:@dave', 'alice')).json.entries.some((e: { path: string }) => e.path.startsWith(`ws/${slug}/`)));
		// A private topic is not at the forum's path even for its members: one path each.
		assert.equal((await api('GET', `/api/v1/get/forum/${topic}`, 'alice')).status, 404);
		assert.equal((await api('POST', `/api/v1/forum/${topic}`, 'alice', { body: 'By the forum\'s route.' })).status, 404);
	});

	test('an invitation, once accepted, opens the whole history; a removed member gets nothing more', async () => {
		assert.equal((await api('POST', `/api/v1/post/ws/${slug}/members`, 'carol', { body: 'carol' })).status, 201);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}/${topic}/${firstPost}`, 'carol')).json.body, `A ${SECRET} sketch, building on ${RECORD} and https://example.org/space-record.`);
		assert.equal((await api('GET', `/api/v1/get/ws/${slug}`, 'dave')).status, 404);
		assert.ok(!(await api('GET', '/api/v1/log?limit=200', 'dave')).text.includes(SECRET));
		await assert.rejects(editPost(pg, davePost, dave, { body: 'Mine again.', revision: '1' }), (e: QueryError) => e instanceof NotFoundError && e.message === `no post ${davePost}`);
	});
});
