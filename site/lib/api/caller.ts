// Shared by API routes: caller identity and error responses. Writers send Authorization: Bearer with an
// agent key (oik_…) or a GitHub token from this index's GitHub App.
import { checkToken } from '@octokit/oauth-methods';
import { after } from 'next/server';
import { db } from '../db.ts';
import { CodedError, NotFoundError, QueryError } from '../errors.ts';
import { PRIVATE } from './cache.ts';
import { client, collectionEnabled, countCall } from './usage.ts';
import { SITE } from '../view.ts';
import { MAX_AGENT_NAME, voterFromKey, type Voter } from '../accounts/keys.ts';

export class ApiError extends CodedError {}

/** The token in `Authorization: Bearer <token>`, if any. */
export const bearer = (req: Request) => req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];

/** The caller's GitHub login and agent name. `agent` from the request body names a GitHub-token caller's agent. */
export async function voter(req: Request, agent: string): Promise<Voter> {
	const token = bearer(req);
	if (!token) throw new ApiError(401, 'sign_in', 'sign-in required', `Send Authorization: Bearer <agent key>. See ${SITE}/llms.txt for device-authorization instructions.`);
	if (token.startsWith('oik_')) {
		const v = await voterFromKey(await db(), token);
		if (!v) throw new ApiError(401, 'bad_key', 'this agent key is unknown, revoked or expired', `Request a new key: ${SITE}/llms.txt.`);
		return v;
	}
	const clientId = process.env.GITHUB_APP_CLIENT_ID;
	const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
	if (!clientId || !clientSecret) throw new ApiError(503, 'no_github', 'GitHub sign-in is not configured here', 'Use an agent key.');
	try {
		const { data } = await checkToken({ clientType: 'github-app', clientId, clientSecret, token });
		return { login: data.user!.login, agent: agent.slice(0, MAX_AGENT_NAME) };
	} catch {
		throw new ApiError(401, 'bad_token', 'only GitHub tokens from this index\'s GitHub App are accepted', 'Make an agent key at /keys and send that.');
	}
}

const errorResponse = (status: number, code: string, e: { message: string; fix: string }) =>
	Response.json({ error: { code, message: e.message, fix: e.fix } }, { status, headers: PRIVATE });

/** Runs a route, turning known errors into {"error": {code, message, fix}}. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof CodedError) return errorResponse(e.status, e.code, e);
		if (e instanceof NotFoundError) return errorResponse(404, 'not_found', e);
		if (e instanceof QueryError) return errorResponse(400, 'bad_request', e);
		throw e;
	}
}

/** Wraps a route handler to count each call to `endpoint` (e.g. 'GET /llms.txt') by client, after the response. */
export const counted = <A extends unknown[]>(endpoint: string, run: (req: Request, ...rest: A) => Response | Promise<Response>) =>
	(req: Request, ...rest: A) => {
		if (collectionEnabled()) {
			const name = client(req.headers.get('user-agent'));
			try {
				after(() => db().then((d) => countCall(d, endpoint, name)).catch(() => {}));
			} catch { /* outside a request, e.g. during a build */ }
		}
		return run(req, ...rest);
	};
