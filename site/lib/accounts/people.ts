// Public names and affiliations shown beside logins (open_index.people). Cosmetic only: authorization and
// attribution always use the GitHub login.
import { QueryError } from '../errors.ts';
import type { Db } from '../db.ts';
import { profileName } from './keys.ts';

/** What is shown for a person besides their login; either part may be ''. */
export type PublicName = { name: string; affiliation: string };

export const MAX_NAME = 100;
export const MAX_AFFILIATION = 100;

/** A GitHub "company" for show only: profileName rules, without GitHub's leading "@" on organization mentions. */
export function profileAffiliation(value: unknown): string {
	return profileName(value).replace(/^@(?=\S)/, '');
}

/** Public names keyed by each login as given (GitHub logins ignore case). Logins with nothing to show are left out,
 *  and a name that only repeats the login is dropped. An unmigrated database shows no names. */
export async function publicNames(db: Db, logins: string[]): Promise<Map<string, PublicName>> {
	const lower = [...new Set(logins.map((l) => l.toLowerCase()))];
	if (!lower.length) return new Map();
	const rows = await db.query<{ login: string; name: string; affiliation: string }>(
		'SELECT login, name, affiliation FROM open_index.people WHERE login = ANY($1)', [lower]).then((r) => r.rows, () => []);
	const found = new Map(rows.map((r) => [r.login, r]));
	return new Map(logins.flatMap((login) => {
		const r = found.get(login.toLowerCase());
		const shown = r && { name: r.name.toLowerCase() === login.toLowerCase() ? '' : r.name, affiliation: r.affiliation };
		return shown && (shown.name || shown.affiliation) ? [[login, shown] as [string, PublicName]] : [];
	}));
}

/** One person's public name, or empty parts when none is known. */
export async function publicName(db: Db, login: string): Promise<PublicName> {
	return (await publicNames(db, [login])).get(login) ?? { name: '', affiliation: '' };
}

/** At sign-in: copy the public GitHub name and company, unless the person has edited theirs here. Never fails sign-in. */
export async function rememberGitHubProfile(db: Db, login: string, github: { name?: unknown; company?: unknown }) {
	await db.query(`INSERT INTO open_index.people (login, name, affiliation) VALUES ($1, $2, $3)
		ON CONFLICT (login) DO UPDATE SET name = excluded.name, affiliation = excluded.affiliation, updated_at = now()
		WHERE NOT open_index.people.edited`,
	[login.toLowerCase(), profileName(github.name), profileAffiliation(github.company)]).catch(() => {});
}

/** What a person has stored, as they and their agents see it: unlike publicName, a name equal to the login is kept. */
export type OwnName = PublicName & { login: string; edited: boolean };

/** The person's own name and affiliation, for their profile form and their agents. */
export async function ownName(db: Db, login: string): Promise<OwnName> {
	const row = (await db.query<OwnName>('SELECT login, name, affiliation, edited FROM open_index.people WHERE login = $1', [login.toLowerCase()])).rows[0];
	return row ?? { login: login.toLowerCase(), name: '', affiliation: '', edited: false };
}

/** The person's own edit, from their profile page or one of their agents. A field left out (not a string) keeps its
 *  value; '' clears it. Edited values stay at later sign-ins. */
export async function editPublicName(db: Db, login: string, input: { name?: unknown; affiliation?: unknown }): Promise<OwnName> {
	const given = (v: unknown, max: number, what: string) => {
		if (typeof v !== 'string') return null;
		if ([...v.trim()].length > max) throw new QueryError(`${what} is longer than ${max} characters.`, `Shorten the ${what.toLowerCase()}.`);
		return profileName(v);
	};
	const name = given(input.name, MAX_NAME, 'Name');
	const affiliation = given(input.affiliation, MAX_AFFILIATION, 'Affiliation');
	if (name === null && affiliation === null) throw new QueryError('Nothing to change.', 'Send "name", "affiliation" or both; "" clears one.');
	return (await db.query<OwnName>(`INSERT INTO open_index.people (login, name, affiliation, edited) VALUES ($1, coalesce($2, ''), coalesce($3, ''), true)
		ON CONFLICT (login) DO UPDATE SET name = coalesce($2, open_index.people.name), affiliation = coalesce($3, open_index.people.affiliation),
			edited = true, updated_at = now()
		RETURNING login, name, affiliation, edited`, [login.toLowerCase(), name, affiliation])).rows[0];
}
