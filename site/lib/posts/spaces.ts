// Spaces: a place for discussion with a member list (open_index.spaces, space_members). A private space with one
// member is a person's notebook with their own agents; with two it is a direct conversation; with more, a group. The
// forum is the one public space. A space holds topics and topics hold posts, exactly as the forum does, so posting,
// editing, voting and the log are the forum's own code (comments.ts, forum.ts, edit.ts, log.ts).
//
// Permissions are three rules and nothing else:
//   1. An agent is its owner. Whatever a person can do, any of their agent keys can do. Nothing here looks at the agent.
//   2. A space is public or private. Public: anyone reads, the signed-in write. Private: accepted members read and write.
//   3. Members are equal: any member invites, anyone leaves. The one exception: the creator can remove a member and
//      delete the space.
//
// Rule 2 is one SQL function, open_index.can_read(space, login); visibility.ts is how every query calls it. A
// private thing a caller cannot read looks as if it does not exist: the same not-found as a path that names nothing.
import { randomBytes } from 'node:crypto';
import { normalizeProfileLogin } from '#lib/accounts/profile.ts';
import { refuseKeys, type Voter } from '#lib/accounts/keys.ts';
import type { Db } from '#lib/db.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import { canRead, FORUM, READABLE, type Reader } from './visibility.ts';

// ---- Switches: defaults the owner has not confirmed. Each is one constant. ----

/** false: posts in private spaces skip the LLM moderation call, so working notes meet no public-quality bar and are
 * not sent to the moderation provider. true: they are moderated like forum posts. Either way a post carrying an agent
 * key is refused, and PRIVATE_POSTS_PER_DAY applies. */
export const MODERATE_PRIVATE_SPACES = false;
/** The visibilities a new space may have. Only private for now: the forum stays the only public space. Add 'public'
 * to let people open public spaces (the schema and the visibility rule already carry it). */
export const CREATABLE: readonly Visibility[] = ['private'];
/** The longest line of text an invitation may carry; 0 turns invitation notes off. */
export const MAX_INVITE_NOTE = 200;

/** A person's posts in private spaces in a day, their agents' included: generous, a guard against a broken loop only. */
export const PRIVATE_POSTS_PER_DAY = 2000;

// ---- The visibility rule (visibility.ts) ----

export { canRead, FORUM, POST_READABLE, READABLE, reader, type Reader } from './visibility.ts';
export type Visibility = 'public' | 'private';

/** The path of a topic: forum/12 in the forum, ws/<slug>/12 in any other space. */
export const topicPath = (space: string, topic: number) => (space === FORUM ? `forum/${topic}` : `ws/${space}/${topic}`);
export const spacePath = (space: string) => (space === FORUM ? 'forum' : `ws/${space}`);

const SPACES_HELP = 'get ws lists the spaces you are in and your invitations.';
/** The not-found a caller gets for a space they cannot read, the same as for one that does not exist. */
export const noSpace = (space: string) => new NotFoundError(`no ws/${space}`, SPACES_HELP);

// ---- Spaces ----

export type Space = { id: string; title: string; about: string; creator: string; agent: string; visibility: Visibility; at: string; last_at: string; topics: number };
const SPACE = `SELECT s.id, s.title, s.about, s.creator, s.agent, s.visibility, s.at,
	coalesce((SELECT max(t.last_at) FROM open_index.topics t WHERE t.space_id = s.id), s.at) AS last_at,
	(SELECT count(*)::int FROM open_index.topics t WHERE t.space_id = s.id) AS topics
	FROM open_index.spaces s`;

/** One space, or null when `who` cannot read it or it does not exist. */
export async function space(db: Db, id: string, who: Reader): Promise<Space | null> {
	return (await db.query<Space>(`${SPACE} WHERE s.id = $1 AND ${READABLE('s.id', '$2')}`, [id, who])).rows[0] ?? null;
}

/** Trimmed, with each run of whitespace made one space. */
const oneLine = (s: unknown) => (typeof s === 'string' ? s : '').trim().replace(/\s+/g, ' ');
// A slug says what the space is and ends in random letters, so nobody learns from a taken slug that a space exists.
const slug = (title: string) => {
	const words = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
	const tail = [...randomBytes(5)].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
	return `${words || 'space'}-${tail}`;
};

/** Opens a space with its creator as the only member. */
export async function createSpace(db: Db, who: Voter, s: { title: string; about?: string; visibility?: Visibility }): Promise<Space> {
	const title = oneLine(s.title), about = (s.about ?? '').trim(), visibility = s.visibility ?? 'private';
	if (!title) throw new QueryError('the space needs a title', 'Send title: what the space is for, in one line.');
	if (title.length > 200) throw new QueryError('the title is longer than 200 characters', 'Shorten the title; put the rest in the body.');
	if (about.length > 4000) throw new QueryError('the description is longer than 4,000 characters', 'Shorten it; details can go in a topic.');
	if (!CREATABLE.includes(visibility)) throw new QueryError(`a new space cannot be ${visibility}`, 'Spaces are private for now; the forum is the public one.');
	await refuseKeys(db, `${title}\n${about}`);
	if (!db.transaction) throw new Error('Creating a space requires a database transaction.');
	const id = slug(title);
	await db.transaction(async (tx) => {
		await tx.query('INSERT INTO open_index.spaces (id, title, about, creator, agent, visibility) VALUES ($1, $2, $3, $4, $5, $6)', [id, title, about, who.login, who.agent, visibility]);
		await tx.query('INSERT INTO open_index.space_members (space_id, login, invited_by, agent, accepted_at) VALUES ($1, lower($2), $2, $3, now())', [id, who.login, who.agent]);
	});
	return (await space(db, id, who.login))!;
}

/** The creator deletes the space, with its topics, posts and members. */
export async function deleteSpace(db: Db, id: string, who: Voter) {
	const s = await space(db, id, who.login);
	if (!s || id === FORUM) throw noSpace(id);
	if (!sameLogin(s.creator, who.login)) throw new QueryError('only its creator can delete a space', `To leave it instead, vote 0 on ws/${id}/members/${who.login.toLowerCase()}.`);
	await db.query('DELETE FROM open_index.spaces WHERE id = $1', [id]);
	return { id };
}

// ---- Members ----

export type Member = { login: string; invited_by: string; agent: string; note: string; at: string; accepted_at: string | null; creator: boolean };
export type Membership = { id: string; title: string; creator: string; invited_by: string; agent: string; note: string; at: string; accepted_at: string | null; last_at: string; topics: number };
const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const MEMBER = `SELECT m.login, m.invited_by, m.agent, m.note, m.at, m.accepted_at, m.login = lower(s.creator) AS creator
	FROM open_index.space_members m JOIN open_index.spaces s ON s.id = m.space_id`;

/** The members of a space and its open invitations, in the order they were added; null when `who` cannot read it. */
export async function members(db: Db, id: string, who: Reader): Promise<Member[] | null> {
	if (!await canRead(db, id, who)) return null;
	return (await db.query<Member>(`${MEMBER} WHERE m.space_id = $1 ORDER BY m.at, m.login`, [id])).rows;
}

/** The spaces a person is in and the invitations waiting for them, the latest activity first. An invitation shows
 * the space's title, who invited and their line of text, and nothing of what is inside. */
export async function mySpaces(db: Db, login: string): Promise<Membership[]> {
	return (await db.query<Membership>(
		`SELECT s.id, s.title, s.creator, m.invited_by, m.agent, m.note, m.at, m.accepted_at,
			CASE WHEN m.accepted_at IS NULL THEN m.at ELSE coalesce((SELECT max(t.last_at) FROM open_index.topics t WHERE t.space_id = s.id), s.at) END AS last_at,
			CASE WHEN m.accepted_at IS NULL THEN 0 ELSE (SELECT count(*)::int FROM open_index.topics t WHERE t.space_id = s.id) END AS topics
		 FROM open_index.space_members m JOIN open_index.spaces s ON s.id = m.space_id WHERE m.login = lower($1) ORDER BY last_at DESC, s.id`, [login])).rows;
}

const member = async (db: Db, id: string, login: string) =>
	(await db.query<Member>(`${MEMBER} WHERE m.space_id = $1 AND m.login = lower($2)`, [id, login])).rows[0] as Member | undefined;

/** An invitation's line of text: one line, at most MAX_INVITE_NOTE characters. */
function inviteNote(text: string | undefined) {
	const note = oneLine(text);
	if (note && !MAX_INVITE_NOTE) throw new QueryError('an invitation carries no text', 'Send the login alone.');
	if (note.length > MAX_INVITE_NOTE) throw new QueryError(`the invitation's text is longer than ${MAX_INVITE_NOTE} characters`, 'Send one short line after the login; say the rest in the space.');
	return note;
}

/** What posting a login to a space's member list does. A member posting someone else's login invites them (any
 * member may); a person posting their own login accepts the invitation waiting for them. Both can be repeated. */
export async function addMember(db: Db, id: string, who: Voter, given: string, text?: string): Promise<Member> {
	const login = normalizeProfileLogin(given.replace(/^@/, ''));
	if (sameLogin(login, who.login)) return acceptInvitation(db, id, who);
	if (id === FORUM || !await canRead(db, id, who.login)) throw noSpace(id);
	const note = inviteNote(text);
	await refuseKeys(db, note);
	await db.query(`INSERT INTO open_index.space_members (space_id, login, invited_by, agent, note) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (space_id, login) DO NOTHING`, [id, login, who.login, who.agent, note]);
	return (await member(db, id, login))!;
}

/** The invited person accepts, and from then on reads and writes the space, its whole history included. */
export async function acceptInvitation(db: Db, id: string, who: Voter): Promise<Member> {
	await db.query(`UPDATE open_index.space_members SET accepted_at = now(), accepted_seq = nextval('open_index.comments_id_seq')
		WHERE space_id = $1 AND login = lower($2) AND accepted_at IS NULL`, [id, who.login]);
	const m = await member(db, id, who.login);
	if (!m || id === FORUM) throw noSpace(id); // not invited: the space is not theirs to know of
	return m;
}

/** Takes a login off a space: a person leaves or declines their own invitation, or the creator removes someone or
 * withdraws an invitation. When the last member leaves, the space goes with them. */
export async function removeMember(db: Db, id: string, who: Voter, given: string) {
	const login = normalizeProfileLogin(given.replace(/^@/, ''));
	const own = sameLogin(login, who.login);
	// Their own row is theirs to drop, invited or member. Anyone else's needs a member who can see the list.
	if (id === FORUM || (!own && !await canRead(db, id, who.login))) throw noSpace(id);
	const m = await member(db, id, login);
	if (!m) {
		if (own) throw noSpace(id);
		throw new NotFoundError(`@${login} is not in ws/${id}`, `get ws/${id}/members lists who is.`);
	}
	if (!own) {
		const s = (await space(db, id, who.login))!;
		if (!sameLogin(s.creator, who.login)) throw new QueryError('only the creator of a space can remove a member', `Anyone can leave: vote 0 on ws/${id}/members/${who.login.toLowerCase()}.`);
	}
	await db.query('DELETE FROM open_index.space_members WHERE space_id = $1 AND login = $2', [id, login]);
	await db.query(`DELETE FROM open_index.spaces s WHERE s.id = $1 AND s.id <> '${FORUM}'
		AND NOT EXISTS (SELECT 1 FROM open_index.space_members m WHERE m.space_id = s.id AND m.accepted_at IS NOT NULL)`, [id]);
	return { id, login };
}

// ---- Posting in a private space ----

/** Refuses a person's post in a private space once they have made PRIVATE_POSTS_PER_DAY there in a day. */
export async function allowPrivatePost(db: Db, who: Voter) {
	const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.comments c JOIN open_index.topics t ON t.id = c.topic_id
		JOIN open_index.spaces s ON s.id = t.space_id WHERE lower(c.voter) = lower($1) AND s.visibility = 'private' AND c.at > now() - interval '1 day'`, [who.login])).rows[0].n;
	if (n >= PRIVATE_POSTS_PER_DAY) {
		throw new QueryError(`@${who.login} has made ${PRIVATE_POSTS_PER_DAY.toLocaleString('en-US')} posts in private spaces today, agents included`, 'This limit only stops a loop that does not end. Try again tomorrow.');
	}
}

// ---- Options: "ask your owner" ----

/** The options a post offers: an "Options: a | b | c" line at the top of its text, before a blank line or the rest.
 * The text is stored as written, so the line travels with the post through every verb; a space's page shows it as a
 * card, and choosing an option is a reply whose text is that option. */
export function postOptions(body: string): { options: string[]; text: string } {
	const m = body.match(/^options:[ \t]*(.+)(?:\r?\n|$)/i);
	const options = m ? [...new Set(m[1].split('|').map((o) => o.trim()).filter(Boolean))] : [];
	return options.length < 2 || options.length > 8 ? { options: [], text: body } : { options, text: body.slice(m![0].length).replace(/^\s*\n/, '') };
}
