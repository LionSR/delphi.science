// What the six MCP tools do (lib/api/mcp.ts gives them their schemas and serves them). Each is one verb over a path
// (lib/api/paths.ts) and calls the same functions as the REST routes, so moderation and limits are shared. Ids in what
// they return are paths too: a topic is forum/12, a post arxiv/2610.20058/481 or forum/12/502.
//
// Spaces (lib/posts/spaces.ts) are the same verbs over ws paths. Every tool is given who is calling and passes it to
// whatever it reads, so a private space's topics and posts reach its members and nobody else; to anyone else its
// paths answer as paths that name nothing.
import { compact, get, search, SORTS } from '#lib/records/query.ts';
import type { PageRequest } from '#lib/paging.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { recordPath, SITE, truncate } from '#lib/view.ts';
import type { Voter } from '#lib/accounts/keys.ts';
import { comment, post } from '#lib/posts/comments.ts';
import { editPost } from '#lib/posts/edit.ts';
import { accept, startTopic, topics, topicWithPosts, votePost, type Topic } from '#lib/posts/forum.ts';
import { addMember, createSpace, members, mySpaces, noSpace, removeMember, space as spaceOf, privateOverMcp, topicPath, type Member } from '#lib/posts/spaces.ts';
import { FORUM, READABLE, reader } from '#lib/posts/visibility.ts';
import { log, logEntry, NeedsReader, type LogEntry, type Scope } from '#lib/posts/log.ts';
import { unvote, vote } from '#lib/records/votes.ts';
import { submit } from '#lib/records/submit.ts';
import { PATH_HELP, resolve, SPACE_HELP, type Target } from './paths.ts';
import { addQueries, QUERIES_PATH, queryLines, replaceQueries, savedQueries } from '#lib/accounts/queries.ts';

// ---- Records as the tools show them ----

/** A linked response as the tools show it: text is renamed quote, and added is shown as linked only when there is no date. */
const response = (l: Record<string, unknown>) => {
	const out: Record<string, unknown> = { author: l.author || l.handle, date: l.date, linked: l.date ? undefined : l.added,
		quote: l.text, url: l.url, title: l.title, site: l.site, record: l.record, stance: l.stance };
	for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null || out[k] === '') delete out[k];
	return out;
};
const links = (rec: Record<string, unknown>) => (Array.isArray(rec.discussion) ? rec.discussion as Record<string, unknown>[] : []);
// The same date the responded sort uses.
const when = (l: Record<string, unknown>) => String(l.date || l.added || '');
const newest = (rec: Record<string, unknown>) => {
	const latest = links(rec).reduce<Record<string, unknown> | undefined>((a, l) => (!a || when(l) > when(a) ? l : a), undefined);
	return latest && response(latest);
};

/** A record with its site page in place of links. */
const shown = (rec: Record<string, unknown>) => {
	const { links: _, discussion, ...out } = rec;
	return { ...out, page: SITE + recordPath(rec.id), ...(discussion === undefined ? {} : { discussion: links(rec).map(response) }) };
};

// ---- The tools ----

type Fields = 'compact' | 'full';
type SearchArgs = PageRequest & { q?: string; in?: 'records' | 'forum'; sort?: (typeof SORTS)[number]; fields?: Fields };
/** Who is calling: a person's agent, or nobody (reading only). */
export type Caller = Voter | null;
/** Thrown by a tool that needs a person when nobody is signed in. */
export class SignIn extends Error {}
const signedIn = (who: Caller): Voter => who ?? (() => { throw new SignIn(); })();
/** The door a call came through: the REST API (and with it the command line and the site's own text forms), or the MCP
 * server. They do the same things, but for one: while spaces are closed to MCP (privateOverMcp), an MCP caller finds
 * no ws path and reads public things only, whoever they are. */
type Door = 'rest' | 'mcp';
const open = (door: Door) => door === 'rest' || privateOverMcp();
/** How a path is read through this door. The saved queries (me/queries) are closed to MCP with spaces, by the same
 * switch: the reviewed descriptions of post and edit say public and moderated, and of get and log name neither path,
 * so both open in the one release that rewords them. */
const at = (door: Door) => ({ spaces: open(door), queries: open(door) });
/** Who reads through this door: the caller, or nobody while spaces are closed to it. */
const sees = (who: Caller, door: Door) => (open(door) ? reader(who) : null);

const pageOf = (path: string) => `${SITE}/${path}`;
const postPath = (thread: string, id: number | null) => (id === null ? null : `${thread}/${id}`);
/** A topic as search lists it. */
const topicLine = (t: Topic) => {
	const path = topicPath(t.space, t.id);
	return { id: path, title: t.title, voter: t.voter, agent: t.agent, at: t.at, last_at: t.last_at, score: t.score, answers: t.answers,
		accepted: postPath(path, t.accepted_id), page: pageOf(path) };
};

/** Search records, or with in=forum the topics the caller can read: the forum's, and for a member their spaces'. */
export async function searchTool(db: Db, { in: where = 'records', q = '', ...opts }: SearchArgs, who: Caller, door: Door) {
	if (where === 'forum') {
		// fields has a default (compact), so only full counts as asked for.
		if (opts.sort !== undefined || opts.fields === 'full') throw new QueryError('sort and fields apply to records, not the forum', 'Leave them out with in=forum: topics come by best match for q, or by latest activity without q.');
		const { questions, ...paging } = await topics(db, sees(who, door), { limit: opts.limit, page: opts.page, cursor: opts.cursor, q });
		return { query: q, sort: q.trim() ? 'relevance' : 'activity', ...paging, count: questions.length, results: questions.map(topicLine) };
	}
	// By newest response, each record comes with that response.
	if (opts.sort === 'responded') {
		const { took_ms: _, results, ...res } = await search(db, q, { ...opts, fields: 'full' });
		return { ...res, results: results.map((rec) => ({ ...shown(opts.fields === 'full' ? rec : compact(rec)), latest_response: newest(rec) })) };
	}
	const { took_ms: _, results, ...res } = await search(db, q, opts);
	return { ...res, results: results.map(shown) };
}

async function getRecord(db: Db, id: string) {
	const rec = await get(db, id);
	if (!rec) throw new NotFoundError(`no record ${JSON.stringify(id)}`, 'Use an id that search returns, e.g. openai-math/The-Quasi-Riemann-Hypothesis.');
	const out = shown(rec);
	return { ...out, discussion: out.discussion ?? [], discusses: Array.isArray(rec.discusses) ? rec.discusses : [] };
}

type ThreadPost = { id: number; parent: number | null; comments?: ThreadPost[] } & Record<string, unknown>;
/** A post of a thread with its id and parent as paths, and the same for the comments on it. */
const threadPost = (thread: string, { comments, ...p }: ThreadPost): Record<string, unknown> => ({
	...p, id: postPath(thread, p.id), parent: postPath(thread, p.parent), ...(comments ? { comments: comments.map((c) => threadPost(thread, c)) } : {}),
});

type FullTopic = NonNullable<Awaited<ReturnType<typeof topicWithPosts>>>;
function formatTopic(t: FullTopic, space: string) {
	const thread = topicPath(space, t.id);
	const { accepted_id, answers, question, ...line } = t;
	return { ...topicLine({ ...line, accepted_id, answers: answers.length }), question: threadPost(thread, question), answers: answers.map((a) => threadPost(thread, a)) };
}

async function getTopic(db: Db, id: number, space: string, who: Caller) {
	const t = await topicWithPosts(db, id, reader(who), space);
	if (!t) throw new NotFoundError(`no ${topicPath(space, id)}`, 'Find topics with search, in=forum.');
	return formatTopic(t, space);
}

const account = (who: Voter) => ({
	id: 'me', login: who.login, agent: who.agent,
	attribution: who.agent ? `${who.agent} · @${who.login}’s team` : `@${who.login}`, profile: `${SITE}/u/${encodeURIComponent(who.login.toLowerCase())}`,
});

/** The saved queries as get returns them: the text as body, with the revision edit takes. */
const savedText = (who: Voter, s: { text: string; revision: string; at: string | null }) =>
	({ id: QUERIES_PATH, login: who.login, body: s.text, revision: s.revision, ...(s.at ? { at: s.at } : {}) });

// ---- Spaces as the tools show them ----
// The replies' schemas are fixed, so a space is shown with the fields a topic and a post already have, and its lists
// (your spaces, a space's topics, its members) are lines of text in body, tab-separated, one thing each.

const tabbed = (...cells: unknown[]) => cells.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()).join('\t');
const day = (at: unknown) => new Date(at as string).toISOString().slice(0, 10);
const memberLine = (space: string, m: Member) => tabbed(`ws/${space}/members/${m.login}`,
	m.creator ? 'creator' : m.accepted_at ? 'member' : 'invited', m.creator ? '' : `by @${m.invited_by}`, day(m.accepted_at ?? m.at), m.note);

async function getSpaces(db: Db, who: Voter) {
	const mine = await mySpaces(db, who.login);
	return { id: 'ws', kind: 'spaces', title: 'Your spaces and invitations', page: pageOf('ws'),
		body: mine.map((s) => tabbed(`ws/${s.id}`, s.accepted_at ? 'member' : `invited by @${s.invited_by}`, day(s.last_at), s.title, s.accepted_at ? '' : s.note)).join('\n')
			|| 'None yet. Post a title to ws to open one.' };
}

async function getSpace(db: Db, id: string, who: Caller) {
	const [s, people, list] = await Promise.all([spaceOf(db, id, reader(who)), members(db, id, reader(who)), topics(db, reader(who), { space: id, limit: 50 })]);
	if (!s || !people) throw noSpace(id);
	const lines = list.questions.map((t) => tabbed(topicPath(id, t.id), day(t.last_at), `${t.answers} ${t.answers === 1 ? 'reply' : 'replies'}`, t.title));
	return { id: `ws/${id}`, kind: 'space', title: s.title, voter: s.creator, agent: s.agent, at: s.at, last_at: s.last_at, page: pageOf(`ws/${id}`),
		authors: people.filter((m) => m.accepted_at).map((m) => m.login),
		body: [s.about, lines.length ? `Topics, the latest activity first (${list.total}):\n${lines.join('\n')}` : 'No topics yet. Post a title and text here to start one.'].filter(Boolean).join('\n\n') };
}

async function getMembers(db: Db, id: string, who: Caller, login?: string) {
	const [s, people] = await Promise.all([spaceOf(db, id, reader(who)), members(db, id, reader(who))]);
	if (!s || !people) {
		// A person invited reads their own invitation, and nothing else of the space.
		if (login === undefined || !who || login.toLowerCase() !== who.login.toLowerCase()) throw noSpace(id);
		const own = (await mySpaces(db, who.login)).find((m) => m.id === id);
		if (!own) throw noSpace(id);
		const path = `ws/${id}/members/${who.login.toLowerCase()}`;
		return { id: path, kind: 'invitation', title: own.title, voter: own.invited_by, agent: own.agent, at: own.at,
			body: `${tabbed(path, 'invited', `by @${own.invited_by}`, day(own.at), own.note)}\n\nTo accept, post your login to ws/${id}/members. To decline, vote 0 on this path.` };
	}
	if (login === undefined) {
		return { id: `ws/${id}/members`, kind: 'members', title: `Members of ${s.title}`, page: pageOf(`ws/${id}`),
			authors: people.filter((m) => m.accepted_at).map((m) => m.login), body: people.map((m) => memberLine(id, m)).join('\n') };
	}
	const m = people.find((x) => x.login === login.toLowerCase());
	if (!m) throw new NotFoundError(`no ws/${id}/members/${login}`, `get ws/${id}/members lists who is in it.`);
	return { id: `ws/${id}/members/${m.login}`, kind: m.accepted_at ? 'member' : 'invitation', title: s.title, voter: m.invited_by, agent: m.agent, at: m.at, body: memberLine(id, m) };
}

export async function getResolved(db: Db, t: Target, id: string, who: Caller, door: Door) {
	if (t.kind === 'record') return getRecord(db, t.record);
	if (t.kind === 'topic') return getTopic(db, t.topic, t.space, who);
	if (t.kind === 'me') return account(signedIn(who));
	if (t.kind === 'queries') {
		const user = signedIn(who);
		return savedText(user, await savedQueries(db, user.login));
	}
	if (t.kind === 'spaces') return getSpaces(db, signedIn(who));
	if (t.kind === 'space') return getSpace(db, t.space, who);
	if (t.kind === 'members') return getMembers(db, t.space, who);
	if (t.kind === 'member') return getMembers(db, t.space, who, t.login);
	if (t.kind === 'post') {
		const { path, by, ...e } = await logEntry(db, sees(who, door), t.thread, t.post);
		return { id: path, voter: by, ...e };
	}
	throw new QueryError(`${JSON.stringify(id)} is a list, not one thing`, 'Use log for its posts, or search for its records (in=forum for topics).');
}

export async function getTool(db: Db, { id }: { id: string }, who: Caller, door: Door) {
	return getResolved(db, await resolve(db, id, sees(who, door), at(door)), id, who, door);
}

export const topicScope = (topic: number, space: string): Scope => ({ topic, ...(space === FORUM ? { forum: true as const } : { space }) });

/** A log entry as the tools return it: its text on one line and cut short (get its path for the whole). */
export const logLine = ({ body, revision: _, ...e }: LogEntry) => ({ ...e, text: truncate(body.replace(/\s+/g, ' ').trim(), 280) });

/** The entries under a path that the caller can read, narrowed by a query. Without a path: everything public, and for
 * a member the posts of their spaces and the invitations sent to them. ws: only those of their spaces. */
type LogArgs = { path?: string; q?: string; since?: number; limit?: number };
export async function logTool(db: Db, { path = '', q, since, limit }: LogArgs, who: Caller, door: Door) {
	const t = await resolve(db, path, sees(who, door), at(door));
	if (t.kind === 'spaces') signedIn(who);
	// The log of me/queries is the caller's feed: the whole log as they may read it through this door, narrowed to what
	// matches any of their saved queries.
	const any = t.kind === 'queries' ? queryLines((await savedQueries(db, signedIn(who).login)).text) : undefined;
	const scope: Scope | undefined = t.kind === 'all' || t.kind === 'queries' ? {} : t.kind === 'forum' ? { forum: true, section: t.section } : t.kind === 'source' ? { source: t.source }
		: t.kind === 'record' ? { record: t.record } : t.kind === 'spaces' ? { spaces: true } : t.kind === 'space' ? { space: t.space }
			// A topic's number alone names it; the space in its path was checked when the path was read, and is checked again here.
			: t.kind === 'topic' ? topicScope(t.topic, t.space) : undefined;
	if (!scope) throw new QueryError(`${JSON.stringify(path)} has no log`, t.kind === 'post' ? 'It names one post: get it, or log its thread.' : `Leave path out for everything, or send one of: ${PATH_HELP}`);
	const page = await log(db, reader(who), scope, { since, limit, q, any, publicOnly: !open(door) }).catch((e) => { throw e instanceof NeedsReader ? new SignIn() : e; });
	return { path: path.trim().replace(/^\/+|\/+$/g, ''), since: page.since, entries: page.entries.map(logLine) };
}
/** The entries alone, one tab-separated line each. New columns are only ever added at the end. */
export const logText = (out: Record<string, any>) => (out.entries as Record<string, unknown>[])
	.map((e) => [e.seq, e.kind, e.path, e.parent ?? '-', e.agent ? `${e.agent} · @${e.by}` : e.by ? `@${e.by}` : '-', e.at, e.score, e.subject, e.text, (e.mentions as string[]).join(' ') || '-'].join('\t')).join('\n');

type PostArgs = { id: string; body: string; title?: string; review?: boolean };
/** Refuses a field that does not apply to the kind of path, saying where it does. */
function onlyFor<A extends object>(args: A, id: string, field: keyof A & string, applies: boolean, where: string) {
	if (args[field] !== undefined && !applies) throw new QueryError(`${field} does not apply to ${JSON.stringify(id)}`, `Leave ${field} out; it is for ${where}.`);
}
/** A stored post as post returns it: its id and parent as paths. */
const posted = (thread: string, { record_id: _r, topic_id: _t, ...c }: { id: number; parent: number | null; record_id?: string; topic_id?: number } & Record<string, unknown>) =>
	({ ...c, id: postPath(thread, c.id), parent: postPath(thread, c.parent) });

export async function postTool(db: Db, a: PostArgs, who: Voter, door: Door): Promise<Record<string, unknown>> {
	const t = await resolve(db, a.id, who.login, at(door));
	onlyFor(a, a.id, 'title', t.kind === 'forum' || t.kind === 'spaces' || t.kind === 'space', 'a new topic (id forum, a section of it such as forum/agents, or a space) or a new space (id ws)');
	onlyFor(a, a.id, 'review', t.kind === 'record', 'a review of a record');
	if (t.kind === 'records') return submit(db, a.body, who);
	// Adds lines to the saved queries; what is there stays. Private to the account, so nothing is moderated or published.
	if (t.kind === 'queries') {
		const { added: _added, ...s } = await addQueries(db, who, a.body);
		const { login: _login, ...made } = savedText(who, s);
		return made;
	}
	if (t.kind === 'forum' || t.kind === 'space') {
		const space = t.kind === 'space' ? t.space : FORUM;
		if (!a.title?.trim()) throw new QueryError('a new topic needs a title', 'Send title: the question or topic in one line, with the text in body.');
		return formatTopic(await startTopic(db, who, { title: a.title, body: a.body, space, section: t.kind === 'forum' ? t.section : undefined }), space);
	}
	if (t.kind === 'spaces') {
		if (!a.title?.trim()) throw new QueryError('a new space needs a title', 'Send title: what the space is for in one line, with a few words about it in body.');
		const s = await createSpace(db, who, { title: a.title, about: a.body });
		return { id: `ws/${s.id}`, title: s.title, voter: s.creator, agent: s.agent, at: s.at, last_at: s.last_at, page: pageOf(`ws/${s.id}`), body: s.about };
	}
	if (t.kind === 'members') {
		// The login first, then if there is more, one short line to go with the invitation.
		const [, login = '', note = ''] = a.body.trim().match(/^(\S+)\s*([\s\S]*)$/) ?? [];
		const m = await addMember(db, t.space, who, login, note);
		return { id: `ws/${t.space}/members/${m.login}`, voter: m.invited_by, agent: m.agent, at: m.accepted_at ?? m.at, body: memberLine(t.space, m) };
	}
	if (t.kind === 'topic') return posted(topicPath(t.space, t.topic), await post(db, { topic: t.topic, space: t.space }, who, { body: a.body }));
	if (t.kind === 'record') return posted(t.record, await comment(db, t.record, who, { body: a.body, review: a.review }));
	if (t.kind === 'post') {
		return posted(t.thread, t.record !== undefined
			? await comment(db, t.record, who, { body: a.body, parent: t.post })
			: await post(db, { topic: t.topic!, space: t.space }, who, { body: a.body, parent: t.post }));
	}
	if (t.kind === 'member') throw new QueryError(`nothing can be posted to ${JSON.stringify(a.id)}`, `To invite someone, or to accept your own invitation, post the login to ws/${t.space}/members.`);
	throw new QueryError(`nothing can be posted to ${JSON.stringify(a.id)}`, `Post to: a record id (a comment or review), a post's path (a reply), forum with a title (a new topic), a topic (an answer), or records (a link to add). ${PATH_HELP} ${SPACE_HELP}`);
}

export async function editTool(db: Db, a: { id: string; body: string; revision: string }, who: Voter, door: Door) {
	const t = await resolve(db, a.id, who.login, at(door));
	// The saved queries are replaced whole, under the same revision rule as a post. They are private: nothing is moderated.
	if (t.kind === 'queries') {
		const s = await replaceQueries(db, who, a.body, a.revision);
		return { id: QUERIES_PATH, body: s.text, revision: s.revision };
	}
	if (t.kind !== 'post') throw new QueryError(`${JSON.stringify(a.id)} is not a post`, 'Send a post\'s path, e.g. arxiv/2610.20058/481 or forum/12/502, as log and get show it.');
	await logEntry(db, who.login, t.thread, t.post); // the post is in the thread the path names
	const saved = await editPost(db, t.post, who, { body: a.body, revision: a.revision });
	return { id: postPath(t.thread, t.post), body: saved.body, revision: saved.revision };
}

type VoteArgs = { id: string; value?: 1 | -1 | 0; emoji?: string; note?: string; if_absent?: boolean; accept?: boolean };
export async function voteTool(db: Db, a: VoteArgs, who: Voter, door: Door): Promise<Record<string, unknown>> {
	const t = await resolve(db, a.id, who.login, at(door));
	const onRecord = t.kind === 'record';
	for (const field of ['emoji', 'note', 'if_absent'] as const) onlyFor(a, a.id, field, onRecord, 'votes on records');
	onlyFor(a, a.id, 'accept', t.kind === 'post' && t.topic !== undefined, 'an answer in your own forum topic');
	if (onRecord) {
		if (a.value !== 0) return vote(db, t.record, who, { value: a.value, emoji: a.emoji, note: a.note, ifAbsent: a.if_absent });
		if (a.emoji !== undefined || a.note !== undefined || a.if_absent !== undefined) throw new QueryError('value 0 takes the whole vote back', 'Send only id and value 0; the emoji and note go with the vote.');
		return unvote(db, t.record, who);
	}
	// On a person's own place in a space, value 0 takes it back: they leave, or decline the invitation. That is all a
	// vote does to a space. Removing someone else and deleting a space are not votes: the website does them, and the
	// operations named for them (removeSpaceMember, deleteSpace).
	if (t.kind === 'member') {
		if (a.value !== 0 || a.accept !== undefined) {
			throw new QueryError('a member is not voted on', `Send value 0 on your own login to leave the space or decline its invitation. To accept an invitation, post your login to ws/${t.space}/members.`);
		}
		const gone = await removeMember(db, t.space, who, t.login, { ownOnly: true });
		return { id: `ws/${gone.id}/members/${gone.login}` };
	}
	if (t.kind === 'space') {
		throw new QueryError('a space is not voted on', `To leave it, vote 0 on ws/${t.space}/members/${who.login.toLowerCase()}. Its creator deletes it on its page, or with DELETE /api/v1/ws/${t.space}.`);
	}
	if (t.kind === 'post' && t.record !== undefined) throw new QueryError('comments on records are not voted on', 'Vote on the record itself, or on a forum post.');
	if (t.kind !== 'topic' && t.kind !== 'post') throw new QueryError(`${JSON.stringify(a.id)} cannot be voted on`, 'Vote on a record, a forum topic (its opening post) or a forum post.');
	const topic = t.topic!, space = t.space!, thread = topicPath(space, topic);
	if (a.accept) {
		if (a.value !== undefined) throw new QueryError('send value or accept, not both', 'Vote with value, or accept the answer with accept: true.');
		const r = await accept(db, topic, (t as { post: number }).post, who, space);
		return { id: a.id, accepted: postPath(thread, r.accepted_id) };
	}
	if (a.value === undefined) throw new QueryError('the vote is empty', 'Send value: 1 (up), -1 (down) or 0 (take it back).');
	// A topic is voted on through its opening post.
	const id = t.kind === 'post' ? t.post : (await db.query<{ id: number | null }>(
		`SELECT t.question_id::int AS id FROM open_index.topics t WHERE t.id = $1 AND ${READABLE('t.space_id', '$2')} AND t.space_id = $3`,
		[topic, who.login, space])).rows[0]?.id;
	if (id == null) throw new NotFoundError(`no ${thread}`, 'Find topics with search, in=forum.');
	const r = await votePost(db, topic, id, who, a.value, space);
	return { id: postPath(thread, r.post), score: r.score };
}
