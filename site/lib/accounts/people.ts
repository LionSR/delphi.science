// Public profiles shown on /u/<login> and beside logins (open_index.people). They are for display only:
// authorization and attribution always use the GitHub login.
import { QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { MAX_ARXIV_ID, MAX_ARXIV_INPUT, normalizeArxivAuthor } from './arxiv-author.ts';
import { profileName } from './keys.ts';

/** What is shown for a person besides their login on posts/comments; either part may be ''. */
export type PublicName = { name: string; affiliation: string };
/** Full public profile fields shown on /u/<login> and GET /api/v1/users/{login}. */
export type PublicProfile = PublicName & { bio: string; url: string; arxiv_id: string };
/** What a person has stored, as they and their agents see it: unlike publicName, a name equal to the login is kept. */
export type OwnProfile = PublicProfile & { login: string; edited: boolean };

export const MAX_NAME = 100;
export const MAX_AFFILIATION = 100;
export const MAX_BIO = 400;
export const MAX_URL = 200;
export { MAX_ARXIV_ID, MAX_ARXIV_INPUT };

/** A GitHub "company", shown but never used for identity: profileName rules, without GitHub's leading "@" on organization mentions. */
export function profileAffiliation(value: unknown): string {
	return profileName(value).replace(/^@(?=\S)/, '');
}

/** Multi-line bio text: strips control characters other than newlines, trims, and caps length. */
export function normalizeBio(value: string): string {
	const clean = value.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
	if ([...clean].length > MAX_BIO) throw new QueryError(`Bio is longer than ${MAX_BIO} characters.`, 'Shorten the bio.');
	return clean;
}

/** Public homepage/profile URL (http/https only, no credentials). Bare hostnames default to https://. */
export function normalizeProfileUrl(value: string): string {
	const raw = value.trim();
	if (!raw) return '';
	if ([...raw].length > MAX_URL) throw new QueryError(`Website URL is longer than ${MAX_URL} characters.`, 'Use a shorter URL.');
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		throw new QueryError('Website must be a valid http(s) URL.', 'Enter a URL such as https://example.edu/~you, or leave it blank.');
	}
	if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password || !parsed.hostname.includes('.')) {
		throw new QueryError('Website must be a public http(s) URL.', 'Enter a URL such as https://example.edu/~you, or leave it blank.');
	}
	const href = parsed.href;
	if ([...href].length > MAX_URL) throw new QueryError(`Website URL is longer than ${MAX_URL} characters.`, 'Use a shorter URL.');
	return href;
}

/** Public names keyed by each login as given (GitHub logins ignore case). Logins with nothing to show are left out,
 *  and a name that only repeats the login is dropped. Names are for display only, so if the lookup fails none are
 *  shown. */
export async function publicNames(db: Db, logins: string[]): Promise<Map<string, PublicName>> {
	const names = new Map<string, PublicName>();
	const lower = [...new Set(logins.map((l) => l.toLowerCase()))];
	if (!lower.length) return names;
	const rows = await db.query<{ login: string; name: string; affiliation: string }>(
		'SELECT login, name, affiliation FROM open_index.people WHERE login = ANY($1)', [lower]).then((r) => r.rows, () => []);
	const found = new Map(rows.map((r) => [r.login, { name: r.name.toLowerCase() === r.login ? '' : r.name, affiliation: r.affiliation }]));
	for (const login of logins) {
		const shown = found.get(login.toLowerCase());
		if (shown && (shown.name || shown.affiliation)) names.set(login, shown);
	}
	return names;
}

/** One person's public name, or empty parts when none is known. */
export async function publicName(db: Db, login: string): Promise<PublicName> {
	return (await publicNames(db, [login])).get(login) ?? { name: '', affiliation: '' };
}

/** One person's public profile fields for /u/<login> and GET /api/v1/users/{login}. Falls back gracefully if newer columns are not yet migrated. */
export async function publicProfile(db: Db, login: string): Promise<PublicProfile> {
	const lower = login.toLowerCase();
	try {
		const row = (await db.query<{ login: string; name: string; affiliation: string; bio: string; url: string; arxiv_id: string }>(
			'SELECT login, name, affiliation, bio, url, arxiv_id FROM open_index.people WHERE login = $1', [lower])).rows[0];
		if (!row) return { name: '', affiliation: '', bio: '', url: '', arxiv_id: '' };
		return {
			name: row.name.toLowerCase() === row.login ? '' : row.name,
			affiliation: row.affiliation,
			bio: row.bio,
			url: row.url,
			arxiv_id: row.arxiv_id,
		};
	} catch {
		return { ...(await publicName(db, login)), bio: '', url: '', arxiv_id: '' };
	}
}

/** At sign-in: copy the public GitHub name and company, unless the person has edited theirs here. Never fails sign-in. */
export async function rememberGitHubProfile(db: Db, login: string, github: { name?: unknown; company?: unknown }) {
	await db.query(`INSERT INTO open_index.people (login, name, affiliation) VALUES ($1, $2, $3)
		ON CONFLICT (login) DO UPDATE SET name = excluded.name, affiliation = excluded.affiliation, updated_at = now()
		WHERE NOT open_index.people.edited`,
	[login.toLowerCase(), profileName(github.name), profileAffiliation(github.company)]).catch(() => {});
}

/** The person's own profile fields, for their profile form and their agents. */
export async function ownName(db: Db, login: string): Promise<OwnProfile> {
	const lower = login.toLowerCase();
	try {
		const row = (await db.query<OwnProfile>(
			'SELECT login, name, affiliation, bio, url, arxiv_id, edited FROM open_index.people WHERE login = $1', [lower])).rows[0];
		return row ?? { login: lower, name: '', affiliation: '', bio: '', url: '', arxiv_id: '', edited: false };
	} catch {
		const row = (await db.query<PublicName & { login: string; edited: boolean }>(
			'SELECT login, name, affiliation, edited FROM open_index.people WHERE login = $1', [lower])).rows[0];
		return row ? { ...row, bio: '', url: '', arxiv_id: '' } : { login: lower, name: '', affiliation: '', bio: '', url: '', arxiv_id: '', edited: false };
	}
}

type ProfileEdit = { name?: unknown; affiliation?: unknown; bio?: unknown; url?: unknown; arxiv_id?: unknown };

/** The person's own edit, from their profile page or one of their agents. A field left out (not a string) keeps its
 *  value; '' clears it. Edited values stay at later sign-ins. */
export async function editPublicName(db: Db, login: string, input: ProfileEdit): Promise<OwnProfile> {
	const given = (v: unknown, max: number, what: string) => {
		if (typeof v !== 'string') return null;
		if ([...v.trim()].length > max) throw new QueryError(`${what} is longer than ${max} characters.`, `Shorten the ${what.toLowerCase()}.`);
		return profileName(v);
	};
	const name = given(input.name, MAX_NAME, 'Name');
	const affiliation = given(input.affiliation, MAX_AFFILIATION, 'Affiliation');
	const bio = typeof input.bio === 'string' ? normalizeBio(input.bio) : null;
	const url = typeof input.url === 'string' ? normalizeProfileUrl(input.url) : null;
	const arxiv_id = typeof input.arxiv_id === 'string' ? normalizeArxivAuthor(input.arxiv_id) : null;
	if (name === null && affiliation === null && bio === null && url === null && arxiv_id === null) {
		throw new QueryError('Nothing to change.', 'Send at least one of "name", "affiliation", "bio", "url", or "arxiv_id"; "" clears a field.');
	}
	return (await db.query<OwnProfile>(`INSERT INTO open_index.people (login, name, affiliation, bio, url, arxiv_id, edited)
		VALUES ($1, coalesce($2, ''), coalesce($3, ''), coalesce($4, ''), coalesce($5, ''), coalesce($6, ''), true)
		ON CONFLICT (login) DO UPDATE SET
			name = coalesce($2, open_index.people.name),
			affiliation = coalesce($3, open_index.people.affiliation),
			bio = coalesce($4, open_index.people.bio),
			url = coalesce($5, open_index.people.url),
			arxiv_id = coalesce($6, open_index.people.arxiv_id),
			edited = true, updated_at = now()
		RETURNING login, name, affiliation, bio, url, arxiv_id, edited`, [login.toLowerCase(), name, affiliation, bio, url, arxiv_id])).rows[0];
}
