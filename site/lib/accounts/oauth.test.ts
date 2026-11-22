// The OAuth authorization server for MCP sign-in (lib/accounts/oauth.ts) and the reviewers' demo account, on
// in-process Postgres with every migration: discovery, registration, approval, and the code exchange with PKCE.
// What a token can then do at /mcp is in lib/api/mcp-auth.test.ts.
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { sha256 } from '#lib/hash.ts';
import { voterFromKey } from './keys.ts';
import { issueCode, RESOURCE, token } from './oauth.ts';
import { CHATGPT, form, refused, register, request, route, signIn as signInOn, VERIFIER } from './oauth-testing.ts';
import { isReviewer } from './review.ts';

allowRouteImports();

let pg: PGlite;
before(async () => { pg = await migratedDb(); useDb(pg); });
after(async () => { useDb(); await pg.close(); });
const signIn = (login: string) => signInOn(pg, login);


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
});

// ---- Approval and the code exchange ----

describe('authorization', () => {
	test('a request from an unknown client, or to an unregistered return address, is shown to the person and goes nowhere', async () => {
		const { client_id } = await register();
		for (const r of [await request('oic_unknown'), await request(client_id, { redirect_uri: 'https://evil.example/cb' })]) assert.ok('show' in r);
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

	test('a Claude Code plugin registration keeps its client ID and issues a key named Claude Code', async () => {
		const { client_id } = await register('Claude Code (plugin:delphi:delphi)');
		const approved = request(client_id);
		assert.ok('client' in approved);
		assert.equal(approved.client.name, 'Claude Code');
		const code = await issueCode(pg, 'Ada', approved);
		const { access_token } = await token(pg, { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER });
		const { rows } = await pg.query('SELECT agent FROM open_index.agent_keys WHERE key_hash = $1', [sha256(access_token)]);
		assert.deepEqual(rows, [{ agent: 'Claude Code' }]);
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
});

describe('the reviewers\' demo account', () => {
	const env = { REVIEW_ACCOUNT_LOGIN: 'delphi_reviewer', REVIEW_ACCOUNT_PASSWORD: 'correct horse battery staple' };

	test('signs in with exactly its login and password', () => {
		assert.ok(isReviewer(' Delphi_Reviewer ', env.REVIEW_ACCOUNT_PASSWORD, env));
		for (const [login, password] of [['delphi_reviewer', 'wrong'], ['delphi_reviewer', ''], ['octocat', env.REVIEW_ACCOUNT_PASSWORD], [undefined, undefined], ['delphi_reviewer', `${env.REVIEW_ACCOUNT_PASSWORD} `]]) {
			assert.ok(!isReviewer(login, password, env), `${login} ${password}`);
		}
	});

	test('once signed in it is an account like any other: approves a plugin and acts under its own login', async () => {
		assert.deepEqual(await voterFromKey(pg, await signIn('delphi_reviewer')), { login: 'delphi_reviewer', agent: 'ChatGPT' });
	});
});
