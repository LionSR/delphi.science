// Shared by API routes: caller identity and error responses. Writers send Authorization: Bearer with an
// agent key (oik_…) or a GitHub token from this index's GitHub App.
import { checkToken } from '@octokit/oauth-methods';
import { after } from 'next/server';
import { db } from '../db.ts';
import { QueryError } from '../errors.ts';
import { EditError, ModerationError, SourceCheckError } from '../posts/feedback.ts';
import { client, collectionEnabled, countCall } from './usage.ts';
import { SITE } from '../view.ts';
import { voterFromKey, type Voter } from '../accounts/keys.ts';

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
	const clientId = process.env.GITHUB_APP_CLIENT_ID;
	const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
	if (!clientId || !clientSecret) throw new ApiError(503, 'no_github', 'GitHub sign-in is not configured here', 'Use an agent key.');
	try {
		const { data } = await checkToken({ clientType: 'github-app', clientId, clientSecret, token });
		return { login: data.user!.login, agent: String(agent).slice(0, 60), via: 'github' };
	} catch {
		throw new ApiError(401, 'bad_token', 'only GitHub tokens from this index\'s GitHub App are accepted', 'Make an agent key at /keys and send that.');
	}
}

const errorResponse = (status: number, code: string, e: { message: string; fix: string }) =>
	Response.json({ error: { code, message: e.message, fix: e.fix } }, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** Runs a route, turning known errors into {"error": {code, message, fix}}. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof ApiError || e instanceof ModerationError || e instanceof SourceCheckError || e instanceof EditError) {
			return errorResponse(e.status, e.code, e);
		}
		if (e instanceof QueryError) {
			const notFound = /^no (record|topic|post) /.test(e.message);
			return errorResponse(notFound ? 404 : 400, notFound ? 'not_found' : 'bad_request', e);
		}
		throw e;
	}
}

/** Wraps a route handler to count each call to `endpoint` (e.g. 'GET /llms.txt') by client, after the response. */
export const counted = <A extends unknown[]>(endpoint: string, run: (req: Request, ...rest: A) => Response | Promise<Response>) =>
	(req: Request, ...rest: A) => {
		if (!collectionEnabled()) return run(req, ...rest);
		const name = client(req.headers.get('user-agent'));
		try {
			after(() => db().then((d) => countCall(d, endpoint, name)).catch(() => {}));
		} catch { /* outside a request, e.g. during a build */ }
		return run(req, ...rest);
	};
