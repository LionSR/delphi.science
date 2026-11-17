// What the sign-in tests share: a client as ChatGPT registers it, an approved request, and the whole exchange.
// Not a test file itself (the test glob takes *.test.ts).
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import type { Db } from '#lib/db.ts';
import { authorization, issueCode, OAuthError, registerClient, RESOURCE, token } from './oauth.ts';

export const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const VERIFIER = 'v'.repeat(64);
export const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

/** A route module of the app, for tests that call its handlers. */
export const route = (p: string) => import(new URL(`../../app/${p}/route.ts`, import.meta.url).href);
/** A form POST, as OAuth clients send to the token and revocation endpoints. */
export const form = (path: string, fields: Record<string, string>) => new Request(`http://localhost${path}`, {
	method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

export const register = async (name = 'ChatGPT', redirect_uris = [CHATGPT]) => registerClient({ client_name: name, redirect_uris, token_endpoint_auth_method: 'none' });
/** An authorization request from that client, checked. */
export const request = (client_id: string, more: object = {}) =>
	authorization({ response_type: 'code', client_id, redirect_uri: CHATGPT, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'st-1', resource: RESOURCE, ...more });
/** The whole sign-in for `login` through a client named `name`: the access token it ends with. */
export async function signIn(db: Db, login: string, name = 'ChatGPT') {
	const { client_id } = await register(name);
	const approved = request(client_id);
	assert.ok('client' in approved);
	const code = await issueCode(db, login, approved);
	return (await token(db, { grant_type: 'authorization_code', code, client_id, redirect_uri: CHATGPT, code_verifier: VERIFIER, resource: RESOURCE })).access_token;
}
/** Matches an OAuthError with this error code. */
export const refused = (error: string) => (e: unknown) => e instanceof OAuthError && e.error === error;
