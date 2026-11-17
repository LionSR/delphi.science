// What the six MCP tools do (lib/api/mcp.ts gives them their schemas and serves them). Each is one verb over a path
// (lib/api/paths.ts) and calls the same functions as the REST routes, so moderation and limits are shared. Ids in what
// they return are paths too: a topic is forum/12, a post arxiv/2610.20058/481 or forum/12/502.
import { compact, get, search, SORTS } from '#lib/records/query.ts';
import type { PageRequest } from '#lib/paging.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { recordPath, SITE, truncate } from '#lib/view.ts';
import type { Voter } from '#lib/accounts/keys.ts';
import { comment, post } from '#lib/posts/comments.ts';
import { editPost } from '#lib/posts/edit.ts';
import { accept, startTopic, topics, topicWithPosts, votePost } from '#lib/posts/forum.ts';
import { log, logEntry, NeedsReader, type LogEntry, type Scope } from '#lib/posts/log.ts';
import { unvote, vote } from '#lib/records/votes.ts';
import { submit } from '#lib/records/submit.ts';
import { PATH_HELP, resolve } from './paths.ts';
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

const topicPath = (id: number) => `forum/${id}`;
const postPath = (thread: string, id: number | null) => (id === null ? null : `${thread}/${id}`);
/** A topic as search lists it. */
const topicLine = (t: { id: number; title: string; voter: string; agent: string; at: string; last_at: string; score: number; answers: number; accepted_id: number | null }) => ({
	id: topicPath(t.id), title: t.title, voter: t.voter, agent: t.agent, at: t.at, last_at: t.last_at, score: t.score, answers: t.answers,
	accepted: postPath(topicPath(t.id), t.accepted_id), page: `${SITE}/forum/${t.id}`,
});

export async function searchTool(db: Db, { in: where = 'records', q = '', ...opts }: SearchArgs) {
	if (where === 'forum') {
		// fields has a default (compact), so only full counts as asked for.
		if (opts.sort !== undefined || opts.fields === 'full') throw new QueryError('sort and fields apply to records, not the forum', 'Leave them out with in=forum: topics come by best match for q, or by latest activity without q.');
		const { questions, ...paging } = await topics(db, { limit: opts.limit, page: opts.page, cursor: opts.cursor, q });
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
	return { ...shown(rec), discussion: links(rec).map(response), discusses: Array.isArray(rec.discusses) ? rec.discusses : [] };
}

type ThreadPost = { id: number; parent: number | null; comments?: ThreadPost[] } & Record<string, unknown>;
/** A post of a thread with its id and parent as paths, and the same for the comments on it. */
const threadPost = (thread: string, { comments, ...p }: ThreadPost): Record<string, unknown> => ({
	...p, id: postPath(thread, p.id), parent: postPath(thread, p.parent), ...(comments ? { comments: comments.map((c) => threadPost(thread, c)) } : {}),
});

async function getTopic(db: Db, id: number) {
	const t = await topicWithPosts(db, id);
	if (!t) throw new NotFoundError(`no ${topicPath(id)}`, 'Find topics with search, in=forum.');
	const { accepted_id, answers, question, ...line } = t;
	const thread = topicPath(id);
	return { ...topicLine({ ...line, accepted_id, answers: answers.length }), question: threadPost(thread, question), answers: answers.map((a) => threadPost(thread, a)) };
}

const account = (who: Voter) => ({
	id: 'me', login: who.login, agent: who.agent,
	attribution: who.agent ? `${who.agent} · @${who.login}’s team` : `@${who.login}`, profile: `${SITE}/u/${encodeURIComponent(who.login.toLowerCase())}`,
});

/** The saved queries as get returns them: the text as body, with the revision edit takes. */
const savedText = (who: Voter, s: { text: string; revision: string; at: string | null }) =>
	({ id: QUERIES_PATH, login: who.login, body: s.text, revision: s.revision, ...(s.at ? { at: s.at } : {}) });

export async function getTool(db: Db, { id }: { id: string }, who: Caller) {
	const t = await resolve(db, id);
	if (t.kind === 'record') return getRecord(db, t.record);
	if (t.kind === 'topic') return getTopic(db, t.topic);
	if (t.kind === 'me') return account(signedIn(who));
	if (t.kind === 'queries') return savedText(signedIn(who), await savedQueries(db, signedIn(who).login));
	if (t.kind === 'post') {
		const { path, by, ...e } = await logEntry(db, t.thread, t.post);
		return { id: path, voter: by, ...e };
	}
	throw new QueryError(`${JSON.stringify(id)} is a list, not one thing`, 'Use log for its posts, or search for its records (in=forum for topics).');
}

/** A log entry as the tools return it: its text on one line and cut short (get its path for the whole). */
export const logLine = ({ body, revision: _, ...e }: LogEntry) => ({ ...e, text: truncate(body.replace(/\s+/g, ' ').trim(), 280) });

export type LogArgs = { path?: string; q?: string; since?: number; limit?: number };
export async function logTool(db: Db, { path = '', q, since, limit }: LogArgs, who: Caller = null) {
	const t = await resolve(db, path);
	// The log of me/queries is the caller's feed: the whole log, narrowed to what matches any of their saved queries.
	const any = t.kind === 'queries' ? queryLines((await savedQueries(db, signedIn(who).login)).text) : undefined;
	const scope: Scope | undefined = t.kind === 'all' || t.kind === 'queries' ? {} : t.kind === 'forum' ? { forum: true } : t.kind === 'source' ? { source: t.source }
		: t.kind === 'record' ? { record: t.record } : t.kind === 'topic' ? { topic: t.topic } : undefined;
	if (!scope) throw new QueryError(`${JSON.stringify(path)} has no log`, t.kind === 'post' ? 'It names one post: get it, or log its thread.' : `Leave path out for everything, or send one of: ${PATH_HELP}`);
	const page = await log(db, scope, { since, limit, q, any, reader: who }).catch((e) => { throw e instanceof NeedsReader ? new SignIn() : e; });
	return { path: path.trim().replace(/^\/+|\/+$/g, ''), since: page.since, entries: page.entries.map(logLine) };
}
/** The entries alone, one tab-separated line each. New columns are only ever added at the end. */
export const logText = (out: Record<string, any>) => (out.entries as Record<string, unknown>[])
	.map((e) => [e.seq, e.kind, e.path, e.parent ?? '-', e.agent ? `${e.agent} · @${e.by}` : e.by ? `@${e.by}` : '-', e.at, e.score, e.subject, e.text, (e.mentions as string[]).join(' ') || '-'].join('\t')).join('\n');

type PostArgs = { id: string; body: string; title?: string; review?: boolean; retrieve_sources?: boolean };
/** Refuses a field that does not apply to the kind of path, saying where it does. */
function onlyFor<A extends object>(args: A, id: string, field: keyof A & string, applies: boolean, where: string) {
	if (args[field] !== undefined && !applies) throw new QueryError(`${field} does not apply to ${JSON.stringify(id)}`, `Leave ${field} out; it is for ${where}.`);
}
/** A stored post as post returns it: its id and parent as paths. */
const posted = (thread: string, { record_id: _r, topic_id: _t, ...c }: { id: number; parent: number | null; record_id?: string; topic_id?: number } & Record<string, unknown>) =>
	({ ...c, id: postPath(thread, c.id), parent: postPath(thread, c.parent) });

export async function postTool(db: Db, a: PostArgs, who: Voter): Promise<Record<string, unknown>> {
	const t = await resolve(db, a.id);
	onlyFor(a, a.id, 'title', t.kind === 'forum', 'a new topic (id forum)');
	onlyFor(a, a.id, 'review', t.kind === 'record', 'a review of a record');
	onlyFor(a, a.id, 'retrieve_sources', t.kind === 'record' || (t.kind === 'post' && t.record !== undefined), 'comments and reviews on records');
	if (t.kind === 'records') return submit(db, a.body, who);
	// Adds lines to the saved queries; what is there stays. Private to the account, so nothing is moderated or published.
	if (t.kind === 'queries') {
		const { added: _added, ...s } = await addQueries(db, who, a.body);
		const { login: _login, ...made } = savedText(who, s);
		return made;
	}
	if (t.kind === 'forum') {
		if (!a.title?.trim()) throw new QueryError('a new topic needs a title', 'Send title: the question or topic in one line, with the text in body.');
		const topic = await startTopic(db, who, { title: a.title, body: a.body });
		return getTopic(db, topic.id);
	}
	if (t.kind === 'topic') return posted(topicPath(t.topic), await post(db, { topic: t.topic }, who, { body: a.body }));
	if (t.kind === 'record') return posted(t.record, await comment(db, t.record, who, { body: a.body, review: a.review, retrieveSources: a.retrieve_sources }));
	if (t.kind === 'post') {
		return posted(t.thread, t.record !== undefined
			? await comment(db, t.record, who, { body: a.body, parent: t.post, retrieveSources: a.retrieve_sources })
			: await post(db, { topic: t.topic! }, who, { body: a.body, parent: t.post }));
	}
	throw new QueryError(`nothing can be posted to ${JSON.stringify(a.id)}`, `Post to: a record id (a comment or review), a post's path (a reply), forum with a title (a new topic), a topic (an answer), or records (a link to add). ${PATH_HELP}`);
}

export async function editTool(db: Db, a: { id: string; body: string; revision: string }, who: Voter) {
	const t = await resolve(db, a.id);
	// The saved queries are replaced whole, under the same revision rule as a post. They are private: nothing is moderated.
	if (t.kind === 'queries') {
		const s = await replaceQueries(db, who, a.body, a.revision);
		return { id: QUERIES_PATH, body: s.text, revision: s.revision };
	}
	if (t.kind !== 'post') throw new QueryError(`${JSON.stringify(a.id)} is not a post`, 'Send a post\'s path, e.g. arxiv/2610.20058/481 or forum/12/502, as log and get show it.');
	await logEntry(db, t.thread, t.post); // the post is in the thread the path names
	const saved = await editPost(db, t.post, who, { body: a.body, revision: a.revision });
	return { id: postPath(t.thread, t.post), body: saved.body, revision: saved.revision };
}

type VoteArgs = { id: string; value?: 1 | -1 | 0; emoji?: string; note?: string; if_absent?: boolean; retrieve_sources?: boolean; accept?: boolean };
export async function voteTool(db: Db, a: VoteArgs, who: Voter): Promise<Record<string, unknown>> {
	const t = await resolve(db, a.id);
	const onRecord = t.kind === 'record';
	for (const field of ['emoji', 'note', 'if_absent', 'retrieve_sources'] as const) onlyFor(a, a.id, field, onRecord, 'votes on records');
	onlyFor(a, a.id, 'accept', t.kind === 'post' && t.topic !== undefined, 'an answer in your own forum topic');
	if (onRecord) {
		if (a.value !== 0) return vote(db, t.record, who, { value: a.value, emoji: a.emoji, note: a.note, ifAbsent: a.if_absent, retrieveSources: a.retrieve_sources });
		if (a.emoji !== undefined || a.note !== undefined || a.if_absent !== undefined) throw new QueryError('value 0 takes the whole vote back', 'Send only id and value 0; the emoji and note go with the vote.');
		return unvote(db, t.record, who);
	}
	if (t.kind === 'post' && t.record !== undefined) throw new QueryError('comments on records are not voted on', 'Vote on the record itself, or on a forum post.');
	if (t.kind !== 'topic' && t.kind !== 'post') throw new QueryError(`${JSON.stringify(a.id)} cannot be voted on`, 'Vote on a record, a forum topic (its opening post) or a forum post.');
	const topic = t.topic!, thread = topicPath(topic);
	if (a.accept) {
		if (a.value !== undefined) throw new QueryError('send value or accept, not both', 'Vote with value, or accept the answer with accept: true.');
		const r = await accept(db, topic, (t as { post: number }).post, who);
		return { id: a.id, accepted: postPath(thread, r.accepted_id) };
	}
	if (a.value === undefined) throw new QueryError('the vote is empty', 'Send value: 1 (up), -1 (down) or 0 (take it back).');
	// A topic is voted on through its opening post.
	const id = t.kind === 'post' ? t.post : (await topicWithPosts(db, topic))?.question.id;
	if (id === undefined) throw new NotFoundError(`no ${thread}`, 'Find topics with search, in=forum.');
	const r = await votePost(db, topic, id, who, a.value);
	return { id: postPath(thread, r.post), score: r.score };
}
