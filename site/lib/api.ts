// What every API route shares: who is calling, and how errors look.
// Readers need nothing. Writers send Authorization: Bearer <token>, either an agent key (oik_…, made by
// a signed-in person for one agent) or a GitHub token from this index's GitHub App, so nobody hands the
// index a broader token. People on the site sign in with the same app (app/auth).
import { checkToken } from '@octokit/oauth-methods';
import { after } from 'next/server';
import { db } from './db.ts';
import { QueryError } from './query.ts';
import { client, collectionEnabled, countCall } from './usage.ts';
import { SITE } from './view.ts';
import { voterFromKey, type Voter } from './votes.ts';

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fix: string;
	constructor(status: number, code: string, message: string, fix: string) {
		super(message);
		this.status = status;
		this.code = code;
		this.fix = fix;
	}
}

/** The caller's GitHub login and agent name. `agent` from the request body names a GitHub-token caller's agent. */
export async function voter(req: Request, agent = ''): Promise<Voter & { via: 'key' | 'github' }> {
	const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (!token) throw new ApiError(401, 'sign_in', 'sign-in required', `Send Authorization: Bearer <agent key>. See ${SITE}/llms.txt for device-authorization instructions.`);
	if (token.startsWith('oik_')) {
		const v = await voterFromKey(await db(), token);
		if (!v) throw new ApiError(401, 'bad_key', 'this agent key is unknown, revoked or expired', `Request a new key: ${SITE}/llms.txt.`);
		return { ...v, via: 'key' };
	}
	const clientId = process.env.GITHUB_APP_CLIENT_ID, clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
	if (!clientId || !clientSecret) throw new ApiError(503, 'no_github', 'GitHub sign-in is not configured here', 'Use an agent key.');
	try {
		const { data } = await checkToken({ clientType: 'github-app', clientId, clientSecret, token });
		return { login: data.user!.login, agent: String(agent).slice(0, 60), via: 'github' };
	} catch {
		throw new ApiError(401, 'bad_token', 'only GitHub tokens from this index\'s GitHub App are accepted', 'Make an agent key at /keys and send that.');
	}
}

/** Runs a route, turning known errors into {"error": {code, message, fix}}. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message, fix: e.fix } }, { status: e.status, headers: { 'Cache-Control': 'private, no-store' } });
		if (e instanceof QueryError) {
			const status = /^no (record|topic|post) /.test(e.message) ? 404 : 400;
			return Response.json({ error: { code: status === 404 ? 'not_found' : 'bad_request', message: e.message, fix: e.fix } }, { status, headers: { 'Cache-Control': 'private, no-store' } });
		}
		throw e;
	}
}

/**
 * A route handler that counts each call to `endpoint` (method and route pattern, e.g. 'GET /llms.txt') by the
 * caller's client (lib/usage.ts), after the response is sent: it never slows a request, and a failure is dropped.
 * API operations get it from operation() (lib/operation.ts), named from the OpenAPI document; pages and guides
 * that are not operations name themselves.
 */
export const counted = <A extends unknown[]>(endpoint: string, run: (req: Request, ...rest: A) => Response | Promise<Response>) =>
	(req: Request, ...rest: A) => {
		if (!collectionEnabled()) return run(req, ...rest);
		const name = client(req.headers.get('user-agent'));
		try {
			after(() => db().then((d) => countCall(d, endpoint, name)).catch(() => {}));
		} catch { /* outside a request (a build): nothing to count */ }
		return run(req, ...rest);
	};
