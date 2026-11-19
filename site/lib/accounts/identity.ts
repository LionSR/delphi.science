// Which GitHub account a login belongs to. GitHub lets a login change hands (a rename or a deleted account frees the
// name for anyone), and everything here is attributed to the login: posts, votes, space memberships, admin rights.
// So each login is bound to the numeric id of the first GitHub account that signs in with it, and that id never changes.
import type { Db } from '#lib/db.ts';

/**
 * At GitHub sign-in: binds `login` to the account `id` if it is not bound yet, and says whether this account may sign
 * in as `login`. False means another GitHub account signed in with this login before, so this one is refused.
 *
 * A person who renames their account arrives with a known id and a new login. Their sessions and agent keys under the
 * earlier login are revoked here, since that name may now be anyone's; the earlier login stays bound to them.
 */
export async function bindGitHubAccount(db: Db, login: string, id: unknown): Promise<boolean> {
	if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return false;
	const name = login.toLowerCase();
	await db.query('INSERT INTO open_index.github_accounts (login, github_id) VALUES ($1, $2) ON CONFLICT (login) DO NOTHING', [name, id]);
	const bound = (await db.query<{ github_id: string | number }>('SELECT github_id FROM open_index.github_accounts WHERE login = $1', [name])).rows[0];
	if (!bound || String(bound.github_id) !== String(id)) return false;
	await db.query(`UPDATE open_index.agent_keys SET revoked_at = now() WHERE revoked_at IS NULL AND lower(login) IN
		(SELECT login FROM open_index.github_accounts WHERE github_id = $1 AND login <> $2)`, [id, name]);
	return true;
}
