// GET /auth/callback: GitHub's OAuth redirect. Checks the state, reads the login and name, and starts a session.
// The GitHub token is used once and not stored.
import { exchangeWebFlowCode } from '@octokit/oauth-methods';
import { cookies } from 'next/headers';
import { callbackUrl } from '#lib/accounts/callback.ts';
import { db } from '#lib/db.ts';
import { COOKIE, STATE } from '#lib/accounts/session.ts';
import { rememberGitHubProfile } from '#lib/accounts/people.ts';
import { createSession } from '#lib/accounts/keys.ts';
import { bindGitHubAccount } from '#lib/accounts/identity.ts';
import { SUPPORT_EMAIL } from '#lib/contact.ts';

export async function GET(req: Request) {
	const url = new URL(req.url);
	const jar = await cookies();
	const [state, next = '/'] = (jar.get(STATE)?.value ?? '').split(' ');
	jar.delete(STATE);
	const code = url.searchParams.get('code');
	if (!code || !state || url.searchParams.get('state') !== state) return new Response('Sign-in expired. Try again.', { status: 400 });
	const { authentication } = await exchangeWebFlowCode({
		clientType: 'github-app', clientId: process.env.GITHUB_APP_CLIENT_ID!, clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
		code, redirectUrl: callbackUrl(url.origin),
	});
	const user = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${authentication.token}`, 'User-Agent': 'open-research-index' } });
	if (!user.ok) return new Response('GitHub did not say who you are. Try again.', { status: 502 });
	const { login, id, name, company } = (await user.json()) as { login: string; id?: unknown; name?: unknown; company?: unknown };
	// A login can change hands on GitHub; the account that first signed in with it keeps it here (lib/accounts/identity.ts).
	if (!(await bindGitHubAccount(await db(), login, id))) {
		return new Response(`@${login} was first used here by a different GitHub account, so this one cannot sign in as it. Write to ${SUPPORT_EMAIL}.`, { status: 403 });
	}
	await rememberGitHubProfile(await db(), login, { name, company });
	jar.set(COOKIE, await createSession(await db(), login, name), { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 90 * 86400 });
	return Response.redirect(new URL(next, url.origin), 302);
}
