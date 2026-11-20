// The paths the MCP tools take as ids. Everything on the site that a tool reads or writes has one:
//   arxiv/2610.20058        a record            arxiv/2610.20058/481   a post on it
//   forum/12                a forum topic       forum/12/502           a post in it
//   arxiv                   a source's records  forum                  the forum
//   records                 where links are submitted                  me   the signed-in account
//   me/queries              the signed-in person's saved queries (lib/accounts/queries.ts)
//   ws                      the caller's spaces     ws/<slug>              a space (private: its members only)
//   ws/<slug>/12            a topic in it           ws/<slug>/12/502       a post in that topic
//   ws/<slug>/members       who is in it            ws/<slug>/members/<login>   one member or invitation
// A record id may itself hold slashes and end in digits, so a path is read as a record first.
import prefixes from '#lib/records/prefixes.json' with { type: 'json' };
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { QUERIES_PATH } from '#lib/accounts/queries.ts';
import { canRead, FORUM, type Reader } from '#lib/posts/visibility.ts';
import { NAMED } from '#lib/records/query.ts';

export type Target = { kind: 'all' } | { kind: 'me' } | { kind: 'queries' } | { kind: 'records' } | { kind: 'forum' } | { kind: 'source'; source: string }
	| { kind: 'record'; record: string } | { kind: 'topic'; topic: number; space: string }
	| { kind: 'post'; post: number; thread: string; record?: string; topic?: number; space?: string }
	| { kind: 'spaces' } | { kind: 'space'; space: string } | { kind: 'members'; space: string } | { kind: 'member'; space: string; login: string };

export const PATH_HELP = 'A path: a record id (arxiv/2610.20058), a post on it (arxiv/2610.20058/481), forum, a forum topic (forum/12) or a post in it (forum/12/502).';
/** The paths of spaces, for messages (PATH_HELP is part of the published tool descriptions and stays as it is). */
export const SPACE_HELP = 'Spaces: ws lists yours and your invitations; ws/<slug> is one, ws/<slug>/<number> a topic in it, ws/<slug>/<number>/<number> a post, ws/<slug>/members who is in it.';
const NUMBER = /^[1-9][0-9]{0,15}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** The id of the record a path names, following a merged entry to the record it was merged into; null for none. */
const recordAt = async (db: Db, id: string) =>
	(await db.query<{ id: string }>(`SELECT r.id FROM open_index.records r WHERE r.id = ${NAMED}`, [id])).rows[0]?.id ?? null;

/** What a path names, for `who`. Throws NotFoundError for a path that names nothing here, and the same for a space
 * `who` cannot read, or anything in it. With `spaces` false no ws path names anything, for anyone: that is how the
 * MCP server reads paths while spaces are closed to it (lib/posts/spaces.ts privateOverMcp). With `queries` false
 * me/queries names nothing either, in the same way: the MCP server passes the same switch for both. */
export async function resolve(db: Db, given: unknown, who: Reader, { spaces = true, queries = true } = {}): Promise<Target> {
	const path = typeof given === 'string' ? given.trim().replace(/^\/+|\/+$/g, '') : '';
	if (!path) return { kind: 'all' };
	if (path.length > 320) throw new QueryError('the path is too long', PATH_HELP);
	if (path === 'me' || path === 'records' || path === 'forum') return { kind: path };
	if (path === QUERIES_PATH) {
		if (!queries) throw new NotFoundError(`no ${path}`, PATH_HELP);
		return { kind: 'queries' };
	}
	const parts = path.split('/');
	// Closed: ws is a word like any other that names no source.
	if (parts[0] === 'ws' && !spaces) throw new NotFoundError(`no ${path}`, PATH_HELP);
	if (path === 'ws') return { kind: 'spaces' };
	if (parts[0] === 'ws') {
		const none = () => new NotFoundError(`no ${path}`, SPACE_HELP);
		const space = parts[1];
		if (!SLUG.test(space) || space === FORUM) throw none();
		// The member list answers for itself (lib/posts/spaces.ts): a person invited may act on their own entry before they can read the space.
		if (parts[2] === 'members' && parts.length <= 4) return parts.length === 3 ? { kind: 'members', space } : { kind: 'member', space, login: parts[3] };
		if (parts.length > 4 || !parts.slice(2).every((p) => NUMBER.test(p)) || !await canRead(db, space, who)) throw none();
		if (parts.length === 2) return { kind: 'space', space };
		const topic = Number(parts[2]);
		return parts.length === 3 ? { kind: 'topic', topic, space } : { kind: 'post', post: Number(parts[3]), thread: `ws/${space}/${topic}`, topic, space };
	}
	if (parts[0] === 'forum') {
		if (parts.length > 3 || !parts.slice(1).every((p) => NUMBER.test(p))) throw new NotFoundError(`no ${path}`, 'A topic is forum/<number> and a post in it forum/<number>/<number>; search with in=forum to find one.');
		const topic = Number(parts[1]);
		return parts.length === 2 ? { kind: 'topic', topic, space: FORUM } : { kind: 'post', post: Number(parts[2]), thread: `forum/${topic}`, topic, space: FORUM };
	}
	if (parts.length === 1) {
		if (path in prefixes.prefixes) return { kind: 'source', source: path };
		throw new NotFoundError(`no ${path}`, PATH_HELP);
	}
	const whole = await recordAt(db, path);
	if (whole) return { kind: 'record', record: whole };
	const last = parts.at(-1)!;
	const record = parts.length > 2 && NUMBER.test(last) ? await recordAt(db, parts.slice(0, -1).join('/')) : null;
	if (record) return { kind: 'post', post: Number(last), thread: record, record };
	throw new NotFoundError(`no record ${JSON.stringify(path)}`, 'Use an id that search returns, e.g. arxiv/2610.20058.');
}
