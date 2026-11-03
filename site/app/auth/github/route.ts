// GET /auth/github?next=<path>: redirect to GitHub sign-in. In local development without a GitHub App, sign in as @local-dev.
import { cookies } from 'next/headers';
import { callbackUrl } from '../../../lib/callback.ts';
import { db } from '../../../lib/db.ts';
import { COOKIE, safeNext, STATE } from '../../../lib/session.ts';
import { createSession } from '../../../lib/votes.ts';

export async function GET(req: Request) {
	const url = new URL(req.url);
	const next = safeNext(url.searchParams.get('next'));
	const clientId = process.env.GITHUB_APP_CLIENT_ID;
	if (!clientId && process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL) {
		(await cookies()).set(COOKIE, await createSession(await db(), 'local-dev'), { httpOnly: true, sameSite: 'lax', path: '/' });
		return Response.redirect(new URL(next, url.origin), 302);
	}
	if (!clientId) return new Response('GitHub sign-in is not configured here.', { status: 503 });
	const state = crypto.randomUUID();
	(await cookies()).set(STATE, `${state} ${next}`, { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600 });
	const to = new URL('https://github.com/login/oauth/authorize');
	to.search = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl(url.origin), state }).toString();
	return Response.redirect(to, 302);
}
