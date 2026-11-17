// The plugin reviewers' demo account. OpenAI's review needs a login and password that work without GitHub, 2FA or
// email, so the owner may set REVIEW_ACCOUNT_LOGIN and REVIEW_ACCOUNT_PASSWORD; with either unset or unfit there is no
// such sign-in at all. The account is an ordinary one: its posts are moderated, limited and public under its login.
import { createHash, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
const MIN_PASSWORD = 20;

/** The demo account's login, or null when the sign-in is off. The login must contain an underscore, which no GitHub
 * login can, so the account can never be mistaken for, or collide with, a person who signs in with GitHub. */
export function reviewLogin(env: Env = process.env): string | null {
	const login = env.REVIEW_ACCOUNT_LOGIN?.trim() ?? '', password = env.REVIEW_ACCOUNT_PASSWORD ?? '';
	return /^[a-z0-9][a-z0-9_-]{2,38}$/.test(login) && login.includes('_') && password.length >= MIN_PASSWORD ? login : null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Whether these are the demo account's login and password, compared in constant time. */
export function isReviewer(login: unknown, password: unknown, env: Env = process.env): boolean {
	const expected = reviewLogin(env);
	if (!expected || typeof login !== 'string' || typeof password !== 'string') return false;
	const sameLogin = timingSafeEqual(digest(login.trim().toLowerCase()), digest(expected));
	return timingSafeEqual(digest(password), digest(env.REVIEW_ACCOUNT_PASSWORD!)) && sameLogin;
}
