// GET /auth/callback: GitHub sends the person back here. Checks the state, learns their login, and
// starts a session. GitHub's token is used once and not kept.
import { exchangeWebFlowCode } from '@octokit/oauth-methods';
import { cookies } from 'next/headers';
import { db } from '../../../lib/db.ts';
import { COOKIE, STATE } from '../../../lib/session.ts';
import { createSession } from '../../../lib/votes.ts';

export async function GET(req: Request) {
	const url = new URL(req.url);
	const jar = await cookies();
	const [state, next = '/'] = (jar.get(STATE)?.value ?? '').split(' ');
	jar.delete(STATE);
	const code = url.searchParams.get('code');
	if (!code || !state || url.searchParams.get('state') !== state) return new Response('Sign-in expired. Try again.', { status: 400 });
	const { authentication } = await exchangeWebFlowCode({
		clientType: 'github-app', clientId: process.env.GITHUB_APP_CLIENT_ID!, clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
		code, redirectUrl: `${url.origin}/auth/callback`,
	});
	const user = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${authentication.token}`, 'User-Agent': 'open-research-index' } });
	if (!user.ok) return new Response('GitHub did not say who you are. Try again.', { status: 502 });
	const { login } = (await user.json()) as { login: string };
	jar.set(COOKIE, await createSession(await db(), login), { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 90 * 86400 });
	return Response.redirect(new URL(next, url.origin), 302);
}
