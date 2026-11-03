// Public names and affiliations shown beside logins (open_index.people). Cosmetic only: authorization and
// attribution always use the GitHub login.
import { QueryError, type Db } from './query.ts';
import { profileName } from './votes.ts';

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

/** The person's own edit from their profile page. Blank fields are allowed and stay blank at later sign-ins. */
export async function editPublicName(db: Db, login: string, input: { name?: unknown; affiliation?: unknown }): Promise<PublicName> {
	const raw = { name: typeof input.name === 'string' ? input.name : '', affiliation: typeof input.affiliation === 'string' ? input.affiliation : '' };
	if ([...raw.name.trim()].length > MAX_NAME) throw new QueryError(`Names are at most ${MAX_NAME} characters.`, 'Shorten the name.');
	if ([...raw.affiliation.trim()].length > MAX_AFFILIATION) throw new QueryError(`Affiliations are at most ${MAX_AFFILIATION} characters.`, 'Shorten the affiliation.');
	const saved = { name: profileName(raw.name), affiliation: profileName(raw.affiliation) };
	await db.query(`INSERT INTO open_index.people (login, name, affiliation, edited) VALUES ($1, $2, $3, true)
		ON CONFLICT (login) DO UPDATE SET name = excluded.name, affiliation = excluded.affiliation, edited = true, updated_at = now()`,
	[login.toLowerCase(), saved.name, saved.affiliation]);
	return saved;
}
