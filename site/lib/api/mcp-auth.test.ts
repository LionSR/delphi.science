// Sign-in for MCP clients (lib/accounts/oauth.ts) and the tools that act for a person (lib/api/mcp.ts), on in-process
// Postgres with every migration: registration, approval, the code exchange with PKCE, expiry and revocation, what a
// caller without a token can and cannot do, and that a plugin's actions are attributed, moderated and limited like
// those of a device-approved agent key.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { load } from '#lib/records/load.ts';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { createAgentKey, createSession, revokeAgentKey, voterFromKey } from '#lib/accounts/keys.ts';
import { authorization, authorizationServer, client, issueCode, OAuthError, protectedResource, redirectAllowed, registerClient, RESOURCE, RESOURCE_METADATA, token } from '#lib/accounts/oauth.ts';
import { sha256 } from '#lib/hash.ts';
import { SITE } from '#lib/view.ts';
import { isReviewer, reviewLogin } from '#lib/accounts/review.ts';
import { handle, TOOLS } from './mcp.ts';
import { MCP_READ_TOOLS, MCP_WRITE_TOOLS } from './mcp-guide.ts';

allowRouteImports();

type Json = Record<string, any>;
const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
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
const route = (p: string) => import(new URL(`../../app/${p}/route.ts`, import.meta.url).href);
const form = (path: string, fields: Record<string, string>) => new Request(`http://localhost${path}`, {
	method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

const register = async (name = 'ChatGPT', redirect_uris = [CHATGPT]) => registerClient({ client_name: name, redirect_uris, token_endpoint_auth_method: 'none' });
const request = (client_id: string, more: object = {}) =>
	authorization(pg, { response_type: 'code', client_id, redirect_uri: CHATGPT, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'st-1', resource: RESOURCE, ...more });
/** The whole sign-in for `login` through a newly registered client: the access token it ends with. */
async function signIn(login: string, name = 'ChatGPT') {
	const { client_id } = await register(name);
	const approved = await request(client_id);
	assert.ok('client' in approved);
	const code = await issueCode(pg, login, approved);
	return (await token(pg, { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER, resource: RESOURCE })).access_token;
}
const refused = (error: string) => (e: unknown) => e instanceof OAuthError && e.error === error;

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

// ---- Discovery and registration ----

describe('discovery', () => {
	test('the resource names this site as its authorization server, and the server names its endpoints', async () => {
		assert.deepEqual([protectedResource().resource, protectedResource().authorization_servers], [RESOURCE, [SITE]]);
		const as = authorizationServer();
		assert.equal(as.issuer, SITE);
		assert.equal(as.authorization_response_iss_parameter_supported, true);
		assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
		assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']);
		for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint'] as const) assert.ok(as[k].startsWith(`${SITE}/oauth/`), k);
	});

	test('the metadata routes serve them, at the root and under the resource path, to any origin', async () => {
		const pr = await route('.well-known/oauth-protected-resource/[[...path]]');
		const as = await route('.well-known/oauth-authorization-server/[[...path]]');
		const oidc = await route('.well-known/openid-configuration');
		const r = pr.GET() as Response;
		assert.equal(r.headers.get('access-control-allow-origin'), '*');
		assert.deepEqual(await r.json(), protectedResource());
		assert.deepEqual(await as.GET().json(), authorizationServer());
		assert.deepEqual(await oidc.GET().json(), authorizationServer());
		assert.ok(RESOURCE_METADATA.endsWith('/.well-known/oauth-protected-resource/mcp'));
	});
});

describe('client registration', () => {
	test('a public client registers itself through the route and is told it has no secret', async () => {
		const { POST } = await route('oauth/register');
		const r: Response = await POST(new Request('http://localhost/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ client_name: '  ChatGPT\n', redirect_uris: [CHATGPT], token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'] }) }));
		assert.equal(r.status, 201);
		assert.equal(r.headers.get('cache-control'), 'no-store');
		const c = await r.json();
		assert.match(c.client_id, /^oic_[A-Za-z0-9_-]+$/);
		assert.deepEqual([c.client_name, c.redirect_uris, c.token_endpoint_auth_method, c.client_secret], ['ChatGPT', [CHATGPT], 'none', undefined]);
	});

	test('a client with no name is named after where it returns to; a long name is cut to an agent name\'s length', async () => {
		assert.equal(registerClient({ redirect_uris: ['http://127.0.0.1:33418/callback'] }).client_name, '127.0.0.1:33418');
		assert.equal([...(await register('n'.repeat(200))).client_name].length, 60);
	});

	test('redirect URIs must be https, loopback http, or an app\'s own scheme, with no fragment', async () => {
		for (const uri of ['http://example.org/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://example.org/cb#frag', 'https://user:pw@example.org/cb', 'not a url', '']) {
			await assert.rejects(register('X', [uri]), refused('invalid_redirect_uri'), uri);
		}
		assert.throws(() => registerClient({ client_name: 'X' }), refused('invalid_redirect_uri'));
		assert.throws(() => registerClient([]), refused('invalid_client_metadata'));
		assert.throws(() => registerClient({ redirect_uris: [CHATGPT], grant_types: ['client_credentials'] }), refused('invalid_client_metadata'));
		for (const uri of ['cursor://anysphere.cursor-mcp/oauth/callback', 'http://localhost:6274/oauth/callback', 'http://[::1]:9/cb']) assert.ok((await register('X', [uri])).client_id, uri);
	});

	test('a loopback redirect matches on any port; anything else must match exactly', () => {
		const c = { client_id: 'x', name: 'x', redirect_uris: ['http://127.0.0.1:1234/callback', CHATGPT] };
		assert.ok(redirectAllowed(c, 'http://127.0.0.1:55555/callback'));
		assert.ok(redirectAllowed(c, CHATGPT));
		for (const uri of ['http://127.0.0.1:55555/other', 'http://localhost:1234/callback', `${CHATGPT}/x`, `${CHATGPT}?a=1`, 'https://chatgpt.com.evil.example/connector_platform_oauth_redirect']) {
			assert.ok(!redirectAllowed(c, uri), uri);
		}
	});

	test('registering stores nothing, so it cannot be used up: a client_id is the registration itself', async () => {
		const tables = async () => (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'open_index' AND table_name = 'oauth_clients'")).rows[0].n;
		assert.equal(await tables(), 0);
		const codes = async () => (await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM open_index.oauth_codes')).rows[0].n;
		const before = await codes();
		const ids = new Set<string>();
		for (let i = 0; i < 6000; i++) ids.add(registerClient({ client_name: `Flood ${i}`, redirect_uris: [`https://flood.example/cb/${i}`] }).client_id);
		assert.equal(ids.size, 6000);
		assert.equal(await codes(), before);
		// A client that registered before the flood, and one after, are both known.
		const { client_id } = await register();
		assert.deepEqual(client(client_id), { client_id, name: 'ChatGPT', redirect_uris: [CHATGPT] });
		assert.equal(registerClient({ client_name: 'ChatGPT', redirect_uris: [CHATGPT] }).client_id, client_id, 'the same registration is the same client');
		assert.ok('client' in await request(client_id));
	});

	test('a client_id is only what this server would have issued: edited, oversized or malformed ones are unknown', async () => {
		const forge = (o: unknown) => `oic_${Buffer.from(JSON.stringify(o)).toString('base64url')}`;
		for (const id of ['', 'oic_', 'oic_unknown', 'oic_!!!', forge({ n: 'ChatGPT', r: ['http://evil.example/cb'] }), forge({ n: 'ChatGPT', r: ['javascript:alert(1)'] }),
			forge({ n: 'ChatGPT', r: [] }), forge({ n: 'x'.repeat(200), r: [CHATGPT] }), forge({ n: 'ChatGPT', r: [CHATGPT], extra: 1 }), forge({ n: 7, r: [CHATGPT] }), forge([1]),
			forge({ n: 'ChatGPT', r: [CHATGPT, `https://example.org/${'a'.repeat(1500)}`] }), 7, null]) {
			assert.equal(client(id), null, String(id).slice(0, 60));
			if (typeof id === 'string') assert.ok('show' in await request(id), id.slice(0, 60));
		}
		// A forged id that is well-formed is simply a registration anyone could have made: it names its own return address, which the approval page shows.
		const own = forge({ n: 'ChatGPT', r: ['https://evil.example/cb'] });
		assert.deepEqual(client(own)?.redirect_uris, ['https://evil.example/cb']);
		assert.ok('show' in await request(own), 'and it cannot return anywhere else');
		assert.throws(() => registerClient({ redirect_uris: Array.from({ length: 10 }, (_, i) => `https://example.org/${i}/${'a'.repeat(300)}`) }), refused('invalid_redirect_uri'));
	});
});

// ---- Approval and the code exchange ----

describe('authorization', () => {
	test('a request from an unknown client, or to an unregistered return address, is shown to the person and goes nowhere', async () => {
		const { client_id } = await register();
		for (const r of [await request('oic_unknown'), await request(client_id, { redirect_uri: 'https://evil.example/cb' })]) assert.ok('show' in r);
	});

	test('other problems go back to the client with its state: no PKCE, plain PKCE, another response type or resource', async () => {
		const { client_id } = await register();
		for (const [more, error] of [[{ code_challenge: undefined }, 'invalid_request'], [{ code_challenge_method: 'plain' }, 'invalid_request'],
			[{ response_type: 'token' }, 'unsupported_response_type'], [{ resource: 'https://other.example/mcp' }, 'invalid_target']] as const) {
			const r = await request(client_id, more);
			assert.ok('refuse' in r, error);
			const back = new URL(r.refuse);
			assert.equal(back.origin + back.pathname, CHATGPT);
			assert.deepEqual([back.searchParams.get('error'), back.searchParams.get('state'), back.searchParams.get('iss')], [error, 'st-1', SITE]);
		}
	});

	test('an approved code is exchanged once, at the token route, for an agent key named after the client', async () => {
		const { client_id } = await register();
		const approved = await request(client_id);
		assert.ok('client' in approved);
		const code = await issueCode(pg, 'Ada', approved);
		assert.equal((await pg.query('SELECT 1 FROM open_index.oauth_codes WHERE code_hash = $1', [code])).rows.length, 0, 'only the code\'s hash is stored');
		const { POST } = await route('oauth/token');
		const r: Response = await POST(form('/oauth/token', { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER, resource: RESOURCE }));
		assert.equal(r.status, 200);
		assert.equal(r.headers.get('cache-control'), 'no-store');
		const t = await r.json();
		assert.deepEqual([t.token_type, t.scope, t.expires_in], ['Bearer', 'write', 90 * 86400]);
		assert.deepEqual(await voterFromKey(pg, t.access_token), { login: 'Ada', agent: 'ChatGPT' });
		// The key is stored like any other: by hash, expiring in 90 days.
		const row = (await pg.query<{ days: number }>("SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM open_index.agent_keys WHERE key_hash = $1", [sha256(t.access_token)])).rows[0];
		assert.equal(row.days, 90);
	});

	test('the exchange needs the right verifier, client and return address, within five minutes', async () => {
		const { client_id } = await register();
		const other = (await register('Other')).client_id;
		const fresh = async () => { const a = await request(client_id); assert.ok('client' in a); return issueCode(pg, 'ada', a); };
		const exchange = (code: string, more: object = {}) => token(pg, { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER, ...more });
		await assert.rejects(exchange(await fresh(), { code_verifier: 'w'.repeat(64) }), refused('invalid_grant'));
		await assert.rejects(exchange(await fresh(), { client_id: other }), refused('invalid_grant'));
		await assert.rejects(exchange(await fresh(), { redirect_uri: `${CHATGPT}/x` }), refused('invalid_grant'));
		await assert.rejects(exchange(await fresh(), { resource: 'https://other.example/mcp' }), refused('invalid_target'));
		await assert.rejects(exchange(await fresh(), { grant_type: 'refresh_token' }), refused('unsupported_grant_type'));
		await assert.rejects(exchange('oac_unknown'), refused('invalid_grant'));
		const late = await fresh();
		await pg.query("UPDATE open_index.oauth_codes SET expires_at = now() - interval '1 second' WHERE code_hash = $1", [sha256(late)]);
		await assert.rejects(exchange(late), refused('invalid_grant'));
		const { POST } = await route('oauth/token');
		const r: Response = await POST(form('/oauth/token', { grant_type: 'authorization_code', code: 'oac_unknown', client_id, code_verifier: VERIFIER }));
		assert.equal(r.status, 400);
		assert.equal((await r.json()).error, 'invalid_grant');
	});

	test('a code presented twice by the client that holds its verifier is refused, and the key from its first use stops working', async () => {
		const { client_id } = await register();
		const approved = await request(client_id);
		assert.ok('client' in approved);
		const code = await issueCode(pg, 'ada', approved);
		const exchange = (more: object = {}) => token(pg, { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER, ...more });
		const first = (await exchange()).access_token;
		assert.ok(await voterFromKey(pg, first));
		// Knowing a used code alone signs nobody out: without the right client and verifier a replay proves nothing.
		await assert.rejects(exchange({ code_verifier: 'w'.repeat(64) }), refused('invalid_grant'));
		await assert.rejects(exchange({ client_id: (await register('Other')).client_id }), refused('invalid_grant'));
		assert.ok(await voterFromKey(pg, first));
		await assert.rejects(exchange(), refused('invalid_grant'));
		assert.equal(await voterFromKey(pg, first), null);
	});

	test('two exchanges of one code at once: one key is issued, and it is revoked by the other', async () => {
		const { client_id } = await register();
		const approved = await request(client_id);
		assert.ok('client' in approved);
		const code = await issueCode(pg, 'ada', approved);
		const before = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM open_index.agent_keys WHERE login = 'ada' AND agent = 'ChatGPT'")).rows[0].n;
		const exchange = () => token(pg, { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER });
		const results = await Promise.allSettled([exchange(), exchange(), exchange()]);
		const issued = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.access_token] : []));
		assert.equal(issued.length, 1);
		assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM open_index.agent_keys WHERE login = 'ada' AND agent = 'ChatGPT'")).rows[0].n, before + 1);
		assert.equal(await voterFromKey(pg, issued[0]), null, 'the replays saw the key and revoked it');
	});
});

// ---- The MCP server, with and without a token ----

const WRITES: [string, object][] = [
	['whoami', {}],
	['vote_on_record', { id: RECORD, value: 1 }],
	['remove_record_vote', { id: RECORD }],
	['post_comment', { id: RECORD, body: 'The lemma fails for open boundary conditions.' }],
	['edit_post', { id: 1, body: 'The lemma fails for open boundary conditions only.', revision: '1' }],
	['submit_record', { url: 'arxiv/2610.20058' }],
	['ask_forum_question', { title: 'Does the bound hold?', body: 'For which boundary conditions does the bound of app/oauth-plugin hold?' }],
	['reply_in_forum', { topic: 1, body: 'It holds for periodic ones.' }],
	['vote_on_forum_post', { topic: 1, post: 1, value: 1 }],
	['accept_forum_answer', { topic: 1, post: 1 }],
];

describe('a caller without a token', () => {
	test('lists every tool, each marked with whether it needs sign-in, and with honest annotations', async () => {
		const listed = await (await mcp('tools/list')).json();
		const tools = listed.result.tools as Json[];
		assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(TOOLS).sort());
		// The guides (/llms.txt, /api/v1) name the same tools, split the same way.
		assert.deepEqual(MCP_READ_TOOLS, Object.keys(TOOLS).filter((n) => !TOOLS[n].signIn));
		assert.deepEqual(MCP_WRITE_TOOLS, Object.keys(TOOLS).filter((n) => TOOLS[n].signIn));
		for (const t of tools) {
			const needs = WRITES.some(([name]) => name === t.name);
			assert.deepEqual(t.securitySchemes, needs ? [{ type: 'oauth2', scopes: ['write'] }] : [{ type: 'noauth' }], t.name);
			assert.deepEqual(t._meta.securitySchemes, t.securitySchemes, t.name);
			assert.equal(t.annotations.readOnlyHint, !needs || t.name === 'whoami', t.name);
			assert.equal(t.annotations.openWorldHint, !t.annotations.readOnlyHint, t.name);
			assert.equal(typeof t.annotations.destructiveHint, 'boolean', t.name);
		}
		// The portal import file (scripts/plugin.ts) justifies each hint of each tool, and no others.
		const submission = JSON.parse(readFileSync(new URL('../../plugin/submission.json', import.meta.url), 'utf8'));
		assert.deepEqual(Object.keys(submission.justifications).sort(), Object.keys(TOOLS).sort());
		const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
		// Adding a post removes nothing; taking a vote back, replacing one or toggling an acceptance does.
		for (const name of ['post_comment', 'submit_record', 'ask_forum_question', 'reply_in_forum']) assert.equal(byName[name].destructiveHint, false, name);
		for (const name of ['edit_post', 'vote_on_record', 'remove_record_vote', 'vote_on_forum_post', 'accept_forum_answer']) assert.equal(byName[name].destructiveHint, true, name);
	});

	test('reads records, comments and the forum', async () => {
		assert.equal((await ok('get_record', { id: RECORD })).id, RECORD);
		assert.deepEqual((await ok('list_record_comments', { id: OTHER })).comments, []);
		assert.equal((await ok('search_forum', { q: 'no such topic words' })).total, 0);
		assert.ok((await call('list_record_comments', { id: 'app/none' })).isError);
		assert.ok((await call('get_forum_topic', { id: 999999 })).isError);
	});

	test('cannot use any tool that acts for a person: each asks for sign-in and nothing is stored', async () => {
		const counts = async () => (await pg.query(`SELECT (SELECT count(*) FROM open_index.votes) AS votes, (SELECT count(*) FROM open_index.comments) AS comments,
			(SELECT count(*) FROM open_index.topics) AS topics, (SELECT count(*) FROM open_index.moderations) AS attempts, (SELECT count(*) FROM open_index.entries) AS entries`)).rows[0];
		const before = await counts();
		for (const [name, args] of WRITES) {
			const r = await call(name, args);
			assert.ok(r.isError, name);
			assert.match(r.content[0].text, /^Sign-in required/, name);
			const [header] = r._meta['mcp/www_authenticate'];
			assert.ok(header.startsWith(`Bearer resource_metadata="${RESOURCE_METADATA}"`), name);
			assert.ok(header.includes('scope="write"') && header.includes('error="insufficient_scope"') && header.includes('error_description="'), name);
		}
		assert.deepEqual(await counts(), before);
	});

	test('a token that does not work is 401 with where to sign in, even for a read', async () => {
		for (const bearer of ['oik_' + '0'.repeat(48), 'gho_not-one-of-ours', await createSession(pg, 'ada').then(async (k) => { await pg.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = $1', [sha256(k)]); return k; })]) {
			const r = await mcp('tools/call', { name: 'get_record', arguments: { id: RECORD } }, bearer);
			assert.equal(r.status, 401);
			const header = r.headers.get('www-authenticate')!;
			assert.ok(header.includes(`resource_metadata="${RESOURCE_METADATA}"`) && header.includes('error="invalid_token"'), header);
		}
	});
});

describe('a signed-in plugin', () => {
	test('acts as the client\'s name on the person\'s team, sharing their one vote with their other agents', async () => {
		const plugin = await signIn('Grace');
		assert.deepEqual(await ok('whoami', {}, plugin), { login: 'Grace', agent: 'ChatGPT', attribution: 'ChatGPT · @Grace’s team', profile: `${SITE}/u/grace` });
		assert.equal((await ok('vote_on_record', { id: RECORD, value: 1 }, plugin)).score, 1);
		const stored = async () => (await pg.query<{ agent: string; value: number }>('SELECT agent, value FROM open_index.votes WHERE record_id = $1 AND voter = $2', [RECORD, 'Grace'])).rows;
		assert.deepEqual(await stored(), [{ agent: 'ChatGPT', value: 1 }]);
		// The same person's device-approved agent votes: still one vote, now that agent's.
		const device = await createAgentKey(pg, 'Grace', 'Claude Code');
		assert.equal((await ok('vote_on_record', { id: RECORD, value: -1 }, device)).score, -1);
		assert.deepEqual(await stored(), [{ agent: 'Claude Code', value: -1 }]);
		// if_absent keeps it, as on the REST API.
		assert.equal((await ok('vote_on_record', { id: RECORD, value: 1, if_absent: true }, plugin)).created, false);
		assert.equal((await ok('remove_record_vote', { id: RECORD }, plugin)).score, 0);
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
		const posted = await moderated('ACCEPT', () => ok('post_comment', { id: RECORD, body, review: true }, plugin));
		assert.equal(posted.calls, 1);
		assert.deepEqual([posted.value.voter, posted.value.agent, posted.value.review, posted.value.record_id], ['Hypatia', 'Codex', true, RECORD]);
		const listed = (await ok('list_record_comments', { id: RECORD })).comments;
		assert.deepEqual(listed.map((c: Json) => [c.id, c.voter, c.agent, c.body]), [[posted.value.id, 'Hypatia', 'Codex', body]]);

		// The person corrects it through another of their connections; the attribution stays, and the revision moves on.
		const fixed = `${body} Checked for $n \\le 6$.`;
		const edited = await moderated('ACCEPT', async () => ok('edit_post', { id: posted.value.id, body: fixed, revision: listed[0].revision }, await signIn('Hypatia', 'Claude')));
		assert.deepEqual([edited.value.body, edited.value.record_id], [fixed, RECORD]);
		assert.notEqual(edited.value.revision, listed[0].revision);
		const stale = await moderated('ACCEPT', () => call('edit_post', { id: posted.value.id, body: `${fixed} More.`, revision: listed[0].revision }, plugin));
		assert.match(stale.value.content[0].text, /^edit_conflict/);
		assert.match((await call('edit_post', { id: posted.value.id, body: 'Mine now.', revision: edited.value.revision }, await signIn('Mallory'))).content[0].text, /^edit_forbidden/);
		assert.deepEqual((await ok('list_record_comments', { id: RECORD })).comments.map((c: Json) => [c.agent, c.body]), [['Codex', fixed]]);

		const refusedPost = await moderated('REQUEST_REVISION', () => call('post_comment', { id: RECORD, body: 'Great paper, thanks.' }, plugin));
		assert.ok(refusedPost.value.isError);
		assert.match(refusedPost.value.content[0].text, /^moderation_rejected: not posted: REQUEST_REVISION: The comment states no argument\.+ Add the step/);
		assert.equal((await ok('list_record_comments', { id: RECORD })).comments.length, 1);
		// Both attempts are in the person's daily ledger under the plugin's name.
		const attempts = (await pg.query<{ agent: string; publish: boolean }>('SELECT agent, publish FROM open_index.moderations WHERE voter = $1 ORDER BY id', ['Hypatia'])).rows;
		assert.deepEqual(attempts, [{ agent: 'Codex', publish: true }, { agent: 'Claude', publish: true }, { agent: 'Codex', publish: false }]);
	});

	test('with no moderation provider nothing is posted', async () => {
		const prior = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
		try {
			const r = await call('post_comment', { id: OTHER, body: 'The bound in Lemma 2 needs $n > 3$.' }, await signIn('Hypatia'));
			assert.ok(r.isError && /^moderation_unavailable/.test(r.content[0].text), r.content[0].text);
			assert.deepEqual((await ok('list_record_comments', { id: OTHER })).comments, []);
		} finally { if (prior !== undefined) process.env.DEEPSEEK_API_KEY = prior; }
	});

	test('the daily limit of 30 attempts is the person\'s, whichever agent used them', async () => {
		const plugin = await signIn('Emmy');
		await pg.query("INSERT INTO open_index.moderations (voter, agent, kind, publish, reason) SELECT 'Emmy', 'Claude Code', 'comment', true, 'ACCEPT: ok' FROM generate_series(1, 30)");
		const r = await moderated('ACCEPT', () => call('post_comment', { id: RECORD, body: 'The proof of Lemma 4 omits the case $n = 2$.' }, plugin));
		assert.equal(r.calls, 0, 'the provider is not asked once the limit is reached');
		assert.ok(r.value.isError);
		assert.match(r.value.content[0].text, /@Emmy has used 30 check\/submission attempts today, agents included/);
	});

	test('takes part in the forum: asks, is answered, votes, and accepts; nobody votes on their own post', async () => {
		const asker = await signIn('Sofia'), answerer = await signIn('Noether', 'Codex');
		const { value: topic } = await moderated('ACCEPT', () => ok('ask_forum_question',
			{ title: 'Does the boundary term vanish?', body: 'In app/oauth-plugin the boundary term is dropped. For which boundary conditions is that justified?' }, asker));
		assert.deepEqual([topic.voter, topic.agent, topic.question.mentions, topic.page], ['Sofia', 'ChatGPT', [RECORD], `${SITE}/forum/${topic.id}`]);
		const { value: answer } = await moderated('ACCEPT', () => ok('reply_in_forum', { topic: topic.id, body: 'For periodic ones: the two boundary contributions cancel term by term.' }, answerer));
		assert.deepEqual([answer.topic_id, answer.voter, answer.agent], [topic.id, 'Noether', 'Codex']);
		assert.equal((await ok('vote_on_forum_post', { topic: topic.id, post: answer.id, value: 1 }, asker)).score, 1);
		assert.match((await call('vote_on_forum_post', { topic: topic.id, post: answer.id, value: 1 }, answerer)).content[0].text, /cannot vote on your own post/);
		assert.match((await call('accept_forum_answer', { topic: topic.id, post: answer.id }, answerer)).content[0].text, /only the asker/);
		assert.equal((await ok('accept_forum_answer', { topic: topic.id, post: answer.id }, asker)).accepted_id, answer.id);
		const read = await ok('get_forum_topic', { id: topic.id });
		assert.deepEqual(read.answers.map((a: Json) => [a.id, a.accepted, a.score]), [[answer.id, true, 1]]);
		assert.equal((await ok('search_forum', { q: 'boundary term' })).questions[0].id, topic.id);
	});

	test('a post that contains the token is refused and the token revoked, as for any agent key', async () => {
		const plugin = await signIn('Ada');
		const r = await call('post_comment', { id: RECORD, body: `My token is ${plugin}` }, plugin);
		assert.match(r.content[0].text, /contains an agent key/);
		assert.equal((await mcp('tools/list', {}, plugin)).status, 401);
	});
});

describe('expiry and revocation', () => {
	const works = async (bearer: string) => (await mcp('tools/call', { name: 'whoami', arguments: {} }, bearer)).status;

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

describe('the reviewers\' demo account', () => {
	const env = { REVIEW_ACCOUNT_LOGIN: 'delphi_reviewer', REVIEW_ACCOUNT_PASSWORD: 'correct horse battery staple' };

	test('is off unless both a login no GitHub account can have and a long password are set', () => {
		assert.equal(reviewLogin({}), null);
		assert.equal(reviewLogin({ ...env, REVIEW_ACCOUNT_PASSWORD: 'short' }), null);
		assert.equal(reviewLogin({ ...env, REVIEW_ACCOUNT_LOGIN: 'octocat' }), null, 'a login without an underscore could be someone\'s GitHub login');
		assert.equal(reviewLogin({ ...env, REVIEW_ACCOUNT_LOGIN: 'Delphi_Reviewer' }), null);
		assert.equal(reviewLogin(env), 'delphi_reviewer');
		assert.ok(!isReviewer('delphi_reviewer', 'correct horse battery staple', {}));
	});

	test('signs in with exactly its login and password', () => {
		assert.ok(isReviewer(' Delphi_Reviewer ', env.REVIEW_ACCOUNT_PASSWORD, env));
		for (const [login, password] of [['delphi_reviewer', 'wrong'], ['delphi_reviewer', ''], ['octocat', env.REVIEW_ACCOUNT_PASSWORD], [undefined, undefined], ['delphi_reviewer', `${env.REVIEW_ACCOUNT_PASSWORD} `]]) {
			assert.ok(!isReviewer(login, password, env), `${login} ${password}`);
		}
	});

	test('its public activity page and API answer, though its login is not a GitHub one', async () => {
		const prior = { login: process.env.REVIEW_ACCOUNT_LOGIN, password: process.env.REVIEW_ACCOUNT_PASSWORD };
		const { GET } = await route('api/v1/users/[login]');
		const status = async (login: string) => (await GET(new Request(`http://localhost/api/v1/users/${login}`), { params: Promise.resolve({ login }) }) as Response).status;
		try {
			delete process.env.REVIEW_ACCOUNT_LOGIN;
			assert.equal(await status('delphi_reviewer'), 400, 'not a login at all while the account is off');
			Object.assign(process.env, env);
			assert.equal(await status('delphi_reviewer'), 200);
			assert.equal(await status('Delphi_Reviewer'), 200);
			assert.equal(await status('other_login'), 400);
		} finally {
			for (const [k, v] of [['REVIEW_ACCOUNT_LOGIN', prior.login], ['REVIEW_ACCOUNT_PASSWORD', prior.password]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
		}
	});

	test('once signed in it is an account like any other: approves a plugin and acts under its own login', async () => {
		const plugin = await signIn('delphi_reviewer');
		assert.equal((await ok('whoami', {}, plugin)).attribution, 'ChatGPT · @delphi_reviewer’s team');
	});
});
