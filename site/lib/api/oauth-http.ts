// What the OAuth routes share (lib/accounts/oauth.ts): CORS for browser-based MCP clients, bodies, and error replies.
import { OAuthError } from '#lib/accounts/oauth.ts';

/** Any origin may read these: they carry no cookies, and the token endpoint is protected by PKCE. */
export const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version',
};
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_BODY_BYTES = 20_000;

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** A metadata document, cacheable for an hour. */
export const metadata = (doc: object) => Response.json(doc, { headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' } });

/** The request's fields: a form body (RFC 6749) or JSON (RFC 7591), bounded in size. */
export async function fields(req: Request): Promise<Record<string, unknown>> {
	const text = await req.text();
	if (text.length > MAX_BODY_BYTES) throw new OAuthError('invalid_request', 'the request body is too large');
	if ((req.headers.get('content-type') ?? '').includes('application/json')) {
		try {
			const v = JSON.parse(text);
			if (v && typeof v === 'object' && !Array.isArray(v)) return v;
		} catch { /* reported below */ }
		throw new OAuthError('invalid_request', 'send a JSON object');
	}
	return Object.fromEntries(new URLSearchParams(text));
}

/** Runs an OAuth endpoint, answering {"error", "error_description"} for an OAuthError. Replies are never stored. */
export async function oauthReply(run: () => Promise<Response | object>, status = 200): Promise<Response> {
	try {
		const out = await run();
		return out instanceof Response ? out : Response.json(out, { status, headers: { ...CORS, ...NO_STORE } });
	} catch (e) {
		if (!(e instanceof OAuthError)) throw e;
		return Response.json({ error: e.error, error_description: e.message }, { status: e.status, headers: { ...CORS, ...NO_STORE } });
	}
}
