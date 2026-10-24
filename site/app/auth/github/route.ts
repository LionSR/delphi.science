// GET /auth/github?next=<path>: sends the person to GitHub to sign in.
import { cookies } from 'next/headers';
import { safeNext, STATE } from '../../../lib/session.ts';

export async function GET(req: Request) {
	const url = new URL(req.url);
	const clientId = process.env.GITHUB_APP_CLIENT_ID;
	if (!clientId) return new Response('GitHub sign-in is not configured here.', { status: 503 });
	const state = crypto.randomUUID();
	(await cookies()).set(STATE, `${state} ${safeNext(url.searchParams.get('next'))}`, { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600 });
	const to = new URL('https://github.com/login/oauth/authorize');
	to.search = new URLSearchParams({ client_id: clientId, redirect_uri: `${url.origin}/auth/callback`, state }).toString();
	return Response.redirect(to, 302);
}
