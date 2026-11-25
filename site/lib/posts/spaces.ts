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
import { SITE } from '#lib/view.ts';
import { canRead, FORUM, READABLE, type Reader } from './visibility.ts';

// ---- Switches: defaults the owner has not confirmed. Each is one constant. ----

/** false: posts in private spaces skip the LLM moderation call, so working notes meet no public-quality bar and are
 * not sent to the moderation provider. true: they are moderated like forum posts. Either way a post carrying an agent
 * key is refused, and PRIVATE_POSTS_PER_DAY applies. */
export const MODERATE_PRIVATE_SPACES = false;
/** The visibilities a new space may have. Only private for now: the forum stays the only public space. Add 'public'
 * to let people open public spaces (the schema and the visibility rule already carry it). */
export const CREATABLE: readonly Visibility[] = ['private'];
/** How many people a space may invite as it opens. More are invited from the space, one at a time. */
export const MAX_INVITED_AT_OPENING = 10;
/** The longest line of text an invitation may carry; 0 turns invitation notes off. */
export const MAX_INVITE_NOTE = 200;

/** Whether the MCP server (/mcp) reaches what is private: spaces (ws paths) and a person's saved queries (me/queries,
 * lib/accounts/queries.ts). One switch for both, off unless ORI_MCP_PRIVATE is "true". The plugin directories reviewed
 * tools whose descriptions say they read and write public, moderated content at the paths they name, so until those
 * descriptions say otherwise an MCP caller, signed in or not, finds no ws path and no me/queries and reads nothing
 * private (lib/api/mcp-tools.ts). REST, the command line and the website are not affected. Turn it on in the one
 * release that carries the reworded tool descriptions. The rule until then: whatever /mcp reaches is public, or the
 * caller's own identity through get me; moderated where it is text; and named in the tool's description. */
export const privateOverMcp = (env: Record<string, string | undefined> = process.env) => env.ORI_MCP_PRIVATE === 'true';

/** A person's posts in private spaces in a day, their agents' included: generous, a guard against a broken loop only. */
export const PRIVATE_POSTS_PER_DAY = 2000;

export type Visibility = 'public' | 'private';

/** The path of a topic: forum/12 in the forum, ws/<slug>/12 in any other space. */
export const topicPath = (space: string, topic: number) => (space === FORUM ? `forum/${topic}` : `ws/${space}/${topic}`);

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

/** Opens a space with its creator as the only member, and an invitation for each login in `invite`. All of it or none. */
export async function createSpace(db: Db, who: Voter, s: { title: string; about?: string; visibility?: Visibility; invite?: string[] }): Promise<Space> {
	const title = oneLine(s.title), about = (s.about ?? '').trim(), visibility = s.visibility ?? 'private';
	if (!title) throw new QueryError('the space needs a title', 'Send title: what the space is for, in one line.');
	if (title.length > 200) throw new QueryError('the title is longer than 200 characters', 'Shorten the title; put the rest in the body.');
	if (about.length > 4000) throw new QueryError('the description is longer than 4,000 characters', 'Shorten it; details can go in a topic.');
	if (!CREATABLE.includes(visibility)) throw new QueryError(`a new space cannot be ${visibility}`, 'Spaces are private for now; the forum is the public one.');
	// Every login is checked before anything is written: one that cannot be a login opens no space.
	const invited = [...new Set((s.invite ?? []).map((given) => {
		try { return normalizeProfileLogin(given.replace(/^@/, '')); } catch { throw new QueryError(`${JSON.stringify(given)} is not a GitHub login, so the space was not opened`, 'Write GitHub logins separated by spaces, or leave the field empty and invite from the space.'); }
	}))].filter((l) => !sameLogin(l, who.login));
	if (invited.length > MAX_INVITED_AT_OPENING) throw new QueryError(`a space opens with at most ${MAX_INVITED_AT_OPENING} invitations`, 'Invite the others from the space, one at a time.');
	await refuseKeys(db, `${title}\n${about}`);
	if (!db.transaction) throw new Error('Creating a space requires a database transaction.');
	const id = slug(title);
	return db.transaction(async (tx) => {
		const created = (await tx.query<Space>(
			'INSERT INTO open_index.spaces (id, title, about, creator, agent, visibility) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, about, creator, agent, visibility, at, at AS last_at, 0::int AS topics',
			[id, title, about, who.login, who.agent, visibility])).rows[0];
		await tx.query('INSERT INTO open_index.space_members (space_id, login, invited_by, agent, accepted_at) VALUES ($1, lower($2), $2, $3, now())', [id, who.login, who.agent]);
		// One at a time: each invitation takes its own place in the log (the trigger on space_members).
		for (const login of invited) await tx.query('INSERT INTO open_index.space_members (space_id, login, invited_by, agent) VALUES ($1, $2, $3, $4)', [id, login, who.login, who.agent]);
		return created;
	});
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
async function acceptInvitation(db: Db, id: string, who: Voter): Promise<Member> {
	if (id === FORUM) throw noSpace(id);
	await db.query(`UPDATE open_index.space_members SET accepted_at = now()
		WHERE space_id = $1 AND login = lower($2) AND accepted_at IS NULL`, [id, who.login]);
	const m = await member(db, id, who.login);
	if (!m) throw noSpace(id); // not invited: the space is not theirs to know of
	return m;
}

/** Takes a login off a space: a person leaves or declines their own invitation, or the creator removes someone or
 * withdraws an invitation. When the last member leaves, the space goes with them.
 * `ownOnly` is how the six verbs call it (vote, value 0): there a person only takes back their own place, and never
 * the last one, so no vote removes another person or deletes a space. Those two are for the website and for the
 * operations named for them (removeSpaceMember, deleteSpace). */
export async function removeMember(db: Db, id: string, who: Voter, given: string, { ownOnly = false } = {}) {
	const login = normalizeProfileLogin(given.replace(/^@/, ''));
	const own = sameLogin(login, who.login);
	if (id === FORUM) throw noSpace(id);
	// Their own row is theirs to drop, invited or member. Anyone else's needs a member who can see the list.
	const creator = own ? null : (await db.query<{ creator: string }>(`SELECT creator FROM open_index.spaces WHERE id = $1 AND ${READABLE('id', '$2')}`, [id, who.login])).rows[0]?.creator;
	if (!own && !creator) throw noSpace(id);
	const m = await member(db, id, login);
	if (!m) {
		if (own) throw noSpace(id);
		throw new NotFoundError(`@${login} is not in ws/${id}`, `get ws/${id}/members lists who is.`);
	}
	if (!own) {
		if (ownOnly) throw new QueryError('a vote takes back only your own place in a space', `Its creator removes a member on the space's page, or with DELETE /api/v1/ws/${id}/members/${login}.`);
		if (!sameLogin(creator!, who.login)) throw new QueryError('only the creator of a space can remove a member', `Anyone can leave: vote 0 on ws/${id}/members/${who.login.toLowerCase()}.`);
	}
	if (ownOnly && m.accepted_at && (await db.query('SELECT 1 FROM open_index.space_members WHERE space_id = $1 AND accepted_at IS NOT NULL AND login <> $2 LIMIT 1', [id, login])).rows.length === 0) {
		throw new QueryError('you are the last member, and leaving would delete the space', `Delete it on its page, or with DELETE /api/v1/ws/${id}.`);
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

/** In SQL, whether the text in `column` starts with an options line. It is looser than postOptions (which also wants
 * two to eight different options), so what it finds is checked with postOptions wherever the difference matters. */
export const OFFERS_OPTIONS = (column: string) => `${column} ~* '^options:[^\\n]*\\|'`;

/** The options a post offers: an "Options: a | b | c" line at the top of its text, before a blank line or the rest.
 * The text is stored as written, so the line travels with the post through every verb; a space's page shows it as a
 * card, and choosing an option is a reply whose text is that option. */
export function postOptions(body: string): { options: string[]; text: string } {
	const m = body.match(/^options:[ \t]*(.+)(?:\r?\n|$)/i);
	const options = m ? [...new Set(m[1].split('|').map((o) => o.trim()).filter(Boolean))] : [];
	return options.length < 2 || options.length > 8 ? { options: [], text: body } : { options, text: body.slice(m![0].length).replace(/^\s*\n/, '') };
}

// ---- Working on a forum topic ----

/** The forum topics a text names, each once, in the order they are named: by path (forum/12), as a link on this site
 * (/forum/12), or by the page's address. A path inside another site's address names nothing here. */
export function topicsNamed(text: string): number[] {
	const here = text.replaceAll(`${SITE}/`, ' ').replace(/\]\(\//g, '](');
	return [...new Set([...here.matchAll(/(?<![\w\/-])forum\/([1-9]\d{0,15})(?![\w-])/g)].map((m) => Number(m[1])))];
}

/** Whether a text names a record: by its id (arxiv/2406.01234), as a link on this site (/r/arxiv/2406.01234), or by the
 * page's address. An id inside another site's address names nothing here. */
export function namesRecord(text: string, id: string): boolean {
	const here = text.replaceAll(`${SITE}/`, ' ').replace(/\]\(\//g, '](');
	return new RegExp(`(?<![\\w/-])(?:r/)?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(here);
}

/** The spaces of `login` that say they work on a forum topic (a number) or a record (its id): their description
 * names it. That text is the only tie between a space and what it works on, so it is read here, for the member alone,
 * and stored nowhere else: a topic or record never learns which spaces name it. */
export async function spacesOn(db: Db, login: string, subject: number | string): Promise<{ id: string; title: string }[]> {
	const mine = (await db.query<{ id: string; title: string; about: string }>(
		`SELECT s.id, s.title, s.about FROM open_index.spaces s JOIN open_index.space_members m ON m.space_id = s.id
		 WHERE m.login = lower($1) AND m.accepted_at IS NOT NULL AND s.visibility = 'private' AND strpos(s.about, $2) > 0 ORDER BY s.at DESC, s.id`,
		[login, typeof subject === 'number' ? 'forum/' : subject])).rows;
	return mine.filter((s) => (typeof subject === 'number' ? topicsNamed(s.about).includes(subject) : namesRecord(s.about, subject))).map(({ id, title }) => ({ id, title }));
}

// ---- Questions waiting for an answer ----

export type OpenQuestion = { id: number; space: string; space_title: string; topic: number; topic_title: string; voter: string; agent: string; at: string; text: string; options: string[] };

/** The posts that offer options and that nobody has answered yet, in the spaces of `login`, the newest first: what an
 * agent or another member is waiting for. A person's own question, written by themself, waits for others and is not
 * in their list. An answer is a reply whose text is one of the options (the topic page's buttons post exactly that). */
export async function openQuestions(db: Db, login: string, limit = 20): Promise<OpenQuestion[]> {
	const rows = (await db.query<Omit<OpenQuestion, 'text' | 'options'> & { body: string; replies: string[] }>(
		`SELECT c.id::int, s.id AS space, s.title AS space_title, t.id::int AS topic, t.title AS topic_title, c.voter, c.agent, c.at, c.body,
			ARRAY(SELECT r.body FROM open_index.comments r WHERE r.parent_id = c.id) AS replies
		 FROM open_index.comments c JOIN open_index.topics t ON t.id = c.topic_id JOIN open_index.spaces s ON s.id = t.space_id
		 JOIN open_index.space_members m ON m.space_id = s.id AND m.login = lower($1) AND m.accepted_at IS NOT NULL
		 WHERE s.visibility = 'private' AND ${OFFERS_OPTIONS('c.body')} AND NOT (lower(c.voter) = lower($1) AND c.agent = '')
		 ORDER BY c.id DESC LIMIT 200`, [login])).rows;
	return rows.flatMap(({ body, replies, ...q }) => {
		const { options, text } = postOptions(body);
		return options.length && !replies.some((r) => options.includes(r.trim())) ? [{ ...q, text, options }] : [];
	}).slice(0, limit);
}
