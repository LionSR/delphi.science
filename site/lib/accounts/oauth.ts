// OAuth 2.1 authorization server for the MCP server at /mcp, for clients that sign people in from inside
// themselves (the ChatGPT and Codex plugin, Claude, MCP Inspector) instead of following the device flow.
// Public clients only: they register themselves (RFC 7591), the person approves at /oauth/authorize, and the
// client exchanges a one-time code with PKCE S256 for an access token. The access token is an agent key
// (lib/accounts/keys.ts) named after the client, so everything a device-approved key has holds here too.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '#lib/db.ts';
import { sha256 } from '#lib/hash.ts';
import { SITE } from '#lib/view.ts';
import { createAgentKey, MAX_AGENT_NAME, profileName } from './keys.ts';

/** The one scope: act on the site as the person's agent (submit, post, comment, vote). */
export const SCOPE = 'write';
/** The protected resource tokens are issued for (RFC 8707, RFC 9728). */
export const RESOURCE = `${SITE}/mcp`;
export const KEY_SECONDS = 90 * 86400; // open_index.agent_keys.expires_at's default
const CODE_SECONDS = 300;
const MAX_REDIRECTS = 10, MAX_URI = 2000;
// A registration nobody has approved through is dropped after 90 days (a plugin may register long before its first
// person signs in), and at most this many may be waiting at once. One that has been used is kept: its client goes on
// presenting the same client_id.
const UNUSED_CLIENT_DAYS = 90, MAX_UNUSED_CLIENTS = 5000;

/** An OAuth error reply (RFC 6749 section 5.2): {"error", "error_description"} with this status. */
export class OAuthError extends Error {
	readonly error: string;
	readonly status: number;
	constructor(error: string, description: string, status = 400) {
		super(description);
		this.error = error;
		this.status = status;
	}
}

/** Authorization server metadata (RFC 8414), served at /.well-known/oauth-authorization-server. */
export const authorizationServer = (site = SITE) => ({
	issuer: site,
	// Every authorization response, errors included, carries iss (RFC 9207; redirectBack below).
	authorization_response_iss_parameter_supported: true,
	authorization_endpoint: `${site}/oauth/authorize`,
	token_endpoint: `${site}/oauth/token`,
	registration_endpoint: `${site}/oauth/register`,
	revocation_endpoint: `${site}/oauth/revoke`,
	response_types_supported: ['code'],
	response_modes_supported: ['query'],
	grant_types_supported: ['authorization_code'],
	code_challenge_methods_supported: ['S256'],
	token_endpoint_auth_methods_supported: ['none'],
	revocation_endpoint_auth_methods_supported: ['none'],
	scopes_supported: [SCOPE],
	service_documentation: `${site}/llms.txt`,
	op_policy_uri: `${site}/privacy`,
});

/** Protected resource metadata (RFC 9728), served at /.well-known/oauth-protected-resource[/mcp]. */
export const protectedResource = (site = SITE) => ({
	resource: `${site}/mcp`,
	authorization_servers: [site],
	scopes_supported: [SCOPE],
	bearer_methods_supported: ['header'],
	resource_name: 'Delphi.science',
	resource_documentation: `${site}/llms.txt`,
	resource_policy_uri: `${site}/privacy`,
});

/** Where a client without a token is sent to find the authorization server. */
export const RESOURCE_METADATA = `${SITE}/.well-known/oauth-protected-resource/mcp`;

/** A WWW-Authenticate challenge for /mcp (RFC 9728 section 5.1, RFC 6750 section 3). */
export function challenge(error: 'invalid_token' | 'insufficient_scope', description: string): string {
	const quoted = (s: string) => s.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '');
	const parts = [`resource_metadata="${RESOURCE_METADATA}"`, `scope="${SCOPE}"`];
	parts.push(`error="${error}"`, `error_description="${quoted(description)}"`);
	return `Bearer ${parts.join(', ')}`;
}

// ---- Clients ----

export type Client = { client_id: string; name: string; redirect_uris: string[] };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
// Schemes that run or read something in the browser instead of handing the code to an app.
const REFUSED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:', 'mailto:']);

/** A redirect URI as registered: https, http on loopback only, or an app's own scheme; no fragment. */
function redirectUri(value: unknown): URL {
	const bad = (why: string) => new OAuthError('invalid_redirect_uri', `redirect_uri ${JSON.stringify(String(value).slice(0, 200))} ${why}`);
	if (typeof value !== 'string' || !value || value.length > MAX_URI) throw bad(`must be a URL of at most ${MAX_URI} characters`);
	let url: URL;
	try { url = new URL(value); } catch { throw bad('is not an absolute URL'); }
	if (url.hash || value.includes('#')) throw bad('must not have a fragment');
	if (url.username || url.password) throw bad('must not carry credentials');
	if (REFUSED_SCHEMES.has(url.protocol)) throw bad('uses a scheme that cannot receive a code');
	if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) throw bad('must use https (http is for localhost only)');
	return url;
}

const isLoopback = (u: URL) => u.protocol === 'http:' && LOOPBACK.has(u.hostname);

/** Whether `sent` is one of the client's redirect URIs: the same string, or on loopback the same but for the port (RFC 8252 section 7.3). */
export function redirectAllowed(client: Client, sent: string): boolean {
	if (client.redirect_uris.includes(sent)) return true;
	let url: URL;
	try { url = redirectUri(sent); } catch { return false; }
	if (!isLoopback(url)) return false;
	return client.redirect_uris.some((r) => {
		const known = new URL(r);
		return isLoopback(known) && known.hostname === url.hostname && known.pathname === url.pathname && known.search === url.search;
	});
}

/** The name a client is shown and posts under: its client_name, else the host its redirect goes to. */
function clientName(name: unknown, redirect: URL): string {
	const given = profileName(name);
	return [...(given || redirect.host || redirect.protocol.replace(':', ''))].slice(0, MAX_AGENT_NAME).join('');
}

/** Dynamic Client Registration (RFC 7591) for a public client. Returns the registration as the client reads it. */
export async function registerClient(db: Db, meta: unknown) {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new OAuthError('invalid_client_metadata', 'send a JSON object with redirect_uris');
	const m = meta as Record<string, unknown>;
	if (!Array.isArray(m.redirect_uris) || !m.redirect_uris.length || m.redirect_uris.length > MAX_REDIRECTS) {
		throw new OAuthError('invalid_redirect_uri', `redirect_uris must list 1 to ${MAX_REDIRECTS} URLs`);
	}
	const uris = m.redirect_uris.map(redirectUri);
	const redirect_uris = [...new Set(m.redirect_uris as string[])];
	for (const [field, allowed] of [['grant_types', ['authorization_code', 'refresh_token']], ['response_types', ['code']]] as const) {
		const v = m[field];
		if (v !== undefined && (!Array.isArray(v) || !v.every((x) => (allowed as readonly unknown[]).includes(x)))) {
			throw new OAuthError('invalid_client_metadata', `${field} may only contain ${allowed.join(', ')}`);
		}
	}
	const name = clientName(m.client_name, uris[0]);
	await db.query(`DELETE FROM open_index.oauth_clients WHERE used_at IS NULL AND created_at < now() - interval '${UNUSED_CLIENT_DAYS} days'`);
	const waiting = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM open_index.oauth_clients WHERE used_at IS NULL')).rows[0].n;
	if (waiting >= MAX_UNUSED_CLIENTS) throw new OAuthError('temporarily_unavailable', 'too many unused client registrations are waiting; try again later', 503);
	const client_id = `oic_${randomBytes(16).toString('hex')}`;
	await db.query('INSERT INTO open_index.oauth_clients (client_id, name, redirect_uris) VALUES ($1, $2, $3)', [client_id, name, JSON.stringify(redirect_uris)]);
	return {
		client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris,
		// A public client: it proves itself with PKCE, not a secret, whatever method it asked for.
		token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], scope: SCOPE,
	};
}

export async function client(db: Db, id: unknown): Promise<Client | null> {
	if (typeof id !== 'string' || !id || id.length > 200) return null;
	const row = (await db.query<{ client_id: string; name: string; redirect_uris: string }>(
		'SELECT client_id, name, redirect_uris FROM open_index.oauth_clients WHERE client_id = $1', [id])).rows[0];
	return row ? { ...row, redirect_uris: JSON.parse(row.redirect_uris) } : null;
}

// ---- Authorization ----

/** An authorization request (the query of /oauth/authorize), as received. */
export type AuthorizeParams = Partial<Record<'response_type' | 'client_id' | 'redirect_uri' | 'state' | 'scope' | 'code_challenge' | 'code_challenge_method' | 'resource', string>>;
export const AUTHORIZE_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'resource'] as const;

/** The resource a request names, if any, must be this MCP server (or the site it is on). */
const resourceOk = (resource: string | undefined) => !resource || [RESOURCE, SITE].includes(resource.replace(/\/$/, ''));

/**
 * Checks an authorization request. A problem with the client or its redirect URI is shown to the person
 * (`show`), since nothing can safely be sent back; any other problem goes back to the client (`refuse`, a URL).
 */
export async function authorization(db: Db, p: AuthorizeParams): Promise<
	{ show: string } | { refuse: string } | { client: Client; redirect_uri: string; challenge: string; state?: string }> {
	const c = await client(db, p.client_id);
	if (!c) return { show: 'This app is not registered here. Start the connection again from the app.' };
	const redirect_uri = p.redirect_uri ?? (c.redirect_uris.length === 1 ? c.redirect_uris[0] : '');
	if (!redirect_uri || !redirectAllowed(c, redirect_uri)) return { show: 'This request names a return address the app did not register. Start the connection again from the app.' };
	const refuse = (error: string, description: string) => ({ refuse: redirectBack(redirect_uri, { error, error_description: description, state: p.state }) });
	if ((p.state ?? '').length > 2000) return { show: 'This request is malformed. Start the connection again from the app.' };
	if (p.response_type !== 'code') return refuse('unsupported_response_type', 'response_type must be code');
	if (!p.code_challenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge)) return refuse('invalid_request', 'code_challenge (PKCE) is required');
	if (p.code_challenge_method !== 'S256') return refuse('invalid_request', 'code_challenge_method must be S256');
	if (!resourceOk(p.resource)) return refuse('invalid_target', `resource must be ${RESOURCE}`);
	return { client: c, redirect_uri, challenge: p.code_challenge, state: p.state };
}

/** `uri` with these query parameters added (the authorization response, RFC 6749 section 4.1.2). */
export function redirectBack(uri: string, params: Record<string, string | undefined>): string {
	const url = new URL(uri);
	for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
	// RFC 9207: the client can tell which authorization server answered.
	url.searchParams.set('iss', SITE);
	return url.toString();
}

/** The person approved: a one-time code for the client, bound to its redirect URI and PKCE challenge. */
export async function issueCode(db: Db, login: string, request: { client: Client; redirect_uri: string; challenge: string }): Promise<string> {
	const code = `oac_${randomBytes(24).toString('hex')}`;
	await db.query('INSERT INTO open_index.oauth_codes (code_hash, client_id, login, redirect_uri, challenge) VALUES ($1, $2, $3, $4, $5)',
		[sha256(code), request.client.client_id, login, request.redirect_uri, request.challenge]);
	await db.query('UPDATE open_index.oauth_clients SET used_at = now() WHERE client_id = $1', [request.client.client_id]);
	return code;
}

// ---- Tokens ----

type TokenRequest = Partial<Record<'grant_type' | 'code' | 'client_id' | 'redirect_uri' | 'code_verifier' | 'resource', string>>;

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The token endpoint: exchanges an authorization code for an access token, which is a new agent key. */
export async function token(db: Db, r: TokenRequest) {
	if (r.grant_type !== 'authorization_code') {
		throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code; when the access token expires, send the person through authorization again');
	}
	if (!r.code || !r.code_verifier || !r.client_id) throw new OAuthError('invalid_request', 'code, code_verifier and client_id are required');
	if (!resourceOk(r.resource)) throw new OAuthError('invalid_target', `resource must be ${RESOURCE}`);
	const hash = sha256(r.code);
	const row = (await db.query<{ client_id: string; login: string; redirect_uri: string; challenge: string; live: boolean; used: boolean; key_hash: string | null; name: string }>(
		`SELECT c.client_id, c.login, c.redirect_uri, c.challenge, c.expires_at > now() AS live, c.used_at IS NOT NULL AS used, c.key_hash, k.name
		 FROM open_index.oauth_codes c JOIN open_index.oauth_clients k USING (client_id) WHERE c.code_hash = $1`, [hash])).rows[0];
	const invalid = () => new OAuthError('invalid_grant', 'the authorization code is unknown, expired, already used, or was issued to another client');
	if (!row) throw invalid();
	if (row.used) {
		// A code presented twice may have been stolen: what the first exchange got stops working (RFC 6749 section 4.1.2).
		if (row.key_hash) await db.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = $1 AND revoked_at IS NULL', [row.key_hash]);
		throw invalid();
	}
	if (!row.live || row.client_id !== r.client_id) throw invalid();
	if (r.redirect_uri !== undefined && r.redirect_uri !== row.redirect_uri) throw invalid();
	if (!/^[A-Za-z0-9._~-]{43,128}$/.test(r.code_verifier) || !same(s256(r.code_verifier), row.challenge)) throw new OAuthError('invalid_grant', 'code_verifier does not match the code_challenge');
	const claimed = (await db.query('UPDATE open_index.oauth_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING 1', [hash])).rows.length;
	if (!claimed) throw invalid();
	const key = await createAgentKey(db, row.login, row.name);
	await db.query('UPDATE open_index.oauth_codes SET key_hash = $2 WHERE code_hash = $1', [hash, sha256(key)]);
	return { access_token: key, token_type: 'Bearer', expires_in: KEY_SECONDS, scope: SCOPE };
}

/** The revocation endpoint (RFC 7009): the token stops working. Unknown tokens are not an error. */
export async function revoke(db: Db, tokenValue: unknown) {
	if (typeof tokenValue !== 'string' || !tokenValue.startsWith('oik_')) return;
	// Only agent keys: a browser session is ended by signing out.
	await db.query("UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = $1 AND agent <> '' AND revoked_at IS NULL", [sha256(tokenValue)]);
}
