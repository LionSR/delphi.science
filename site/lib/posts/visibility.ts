// THE visibility rule, in one place. A space can be read by a login when it is public, or when that login is an
// accepted member: the SQL function open_index.can_read(space, login) (supabase/migrations/…_spaces.sql). Every query
// that reads or writes a topic or its posts calls it through READABLE or POST_READABLE below, with the caller's login,
// or NULL for nobody signed in and for anything shown to the public (profiles, feeds, the sitemap, counts on records).
// Posts on records belong to no space and are public. There is no second rule: do not test visibility any other way.
import type { Voter } from '#lib/accounts/keys.ts';
import type { Db } from '#lib/db.ts';

export const FORUM = 'forum';
/** Who is reading: a GitHub login, or null for nobody signed in (who reads public things only). */
export type Reader = string | null;
export const reader = (who: Voter | null | undefined): Reader => who?.login ?? null;

/** SQL that is true when the space named by the SQL expression `space` can be read by the login in `param` ($n). */
export const READABLE = (space: string, param: string) => `open_index.can_read(${space}, ${param})`;
/** SQL that is true for a post row `c` left-joined to its topic `t`: posts on records are public, posts in a topic
 * are readable when the topic's space is. */
export const POST_READABLE = (param: string) => `(c.topic_id IS NULL OR ${READABLE('t.space_id', param)})`;

/** Whether `who` can read the space: it is public, or they are an accepted member. False for a space that does not exist. */
export async function canRead(db: Db, space: string, who: Reader): Promise<boolean> {
	return (await db.query<{ ok: boolean }>(`SELECT ${READABLE('$1', '$2')} AS ok`, [space, who])).rows[0].ok;
}
