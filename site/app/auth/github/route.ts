// GET /auth/github?next=<path>: sends the person to GitHub to sign in. On a local copy without a GitHub
// App (`npm run dev`, PGlite), it signs you in as @local-dev instead, so you can try submitting and posting.
import { cookies } from 'next/headers';
import { db } from '../../../lib/db.ts';
import { COOKIE, safeNext, STATE } from '../../../lib/session.ts';
import { createSession } from '../../../lib/votes.ts';

export async function GET(req: Request) {
	const url = new URL(req.url);
	const clientId = process.env.GITHUB_APP_CLIENT_ID;
	if (!clientId && process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL) {
		(await cookies()).set(COOKIE, await createSession(await db(), 'local-dev'), { httpOnly: true, sameSite: 'lax', path: '/' });
		return Response.redirect(new URL(safeNext(url.searchParams.get('next')), url.origin), 302);
	}
	if (!clientId) return new Response('GitHub sign-in is not configured here.', { status: 503 });
	const state = crypto.randomUUID();
	(await cookies()).set(STATE, `${state} ${safeNext(url.searchParams.get('next'))}`, { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600 });
	const to = new URL('https://github.com/login/oauth/authorize');
	to.search = new URLSearchParams({ client_id: clientId, redirect_uri: `${url.origin}/auth/callback`, state }).toString();
	return Response.redirect(to, 302);
}
