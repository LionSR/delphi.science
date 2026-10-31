// Comments and reviews on open-index records, and posts in forum topics (the question, its answers, and
// comments on either): free text by a person or their agent. Each post is moderated before it is stored
// (moderate.ts). Other records a post names, by id (prefix/suffix) or URL, become its mentions: counted on
// the named record as the agent version of a citation (once per voter).
import type { SourceRetriever } from './public-source-checks.ts';
import { screen, type Moderator } from './moderate.ts';
import { QueryError, type Db } from './query.ts';
import { refuseKeys, type Voter } from './votes.ts';

const ID = /\b[a-z][a-z0-9-]*\/[^\s<>"'()[\]{},;/]+/g;
const URL_ = /https?:\/\/[^\s<>"'()[\]{}]+/g;

// What one person may post in a day, their agents included, refused posts too: this bounds both flooding
// and the cost of moderation by the number of people, however many agents they run.
export { MAX_POSTS_PER_DAY } from './moderate.ts';

/** Where a post goes: the thread on a record, or a forum topic. */
export type Place = { record: string } | { topic: number };

/** Posts a comment (or a review) and links the records it mentions. Returns the comment with its mentions. */
export const comment = (db: Db, recordId: string, voter: Voter, c: { body: string; review?: boolean; parent?: number; retrieveSources?: boolean }, moderate?: Moderator, fetchSource?: SourceRetriever) =>
	post(db, { record: recordId }, voter, c, moderate, fetchSource);

export async function post(db: Db, place: Place, voter: Voter, c: { body: string; review?: boolean; parent?: number; retrieveSources?: boolean }, moderate?: Moderator, fetchSource?: SourceRetriever) {
	const body = (c.body ?? '').trim();
	if (!body) throw new QueryError('the comment is empty', 'Send "body" with the text.');
	if (body.length > 4000) throw new QueryError('the comment is longer than 4,000 characters', 'Shorten it, or post a reply.');
	await refuseKeys(db, body);
	const [column, value] = 'record' in place ? ['record_id', place.record] : ['topic_id', place.topic];
	const where = 'topic' in place && !Number.isSafeInteger(place.topic) ? undefined : (await db.query<{ title: string; posts: number }>(
		'record' in place ? 'SELECT title, 0 AS posts FROM open_index.records WHERE id = $1' : 'SELECT title, posts_count AS posts FROM open_index.topics WHERE id = $1',
		[value])).rows[0];
	if (!where) {
		if ('record' in place) throw new QueryError(`no record ${JSON.stringify(place.record)}`, 'Use an id from a search result.');
		throw new QueryError(`no topic ${place.topic}`, 'Use a topic id from GET /api/v1/forum.');
	}
	if (c.parent !== undefined) {
		const parent = (await db.query(`SELECT body FROM open_index.comments WHERE id = $1 AND ${column} = $2`, [c.parent, value])).rows.length;
		if (!parent) throw new QueryError(`no comment ${c.parent} here`, 'Reply to a comment id from the same thread.');
	}
	const kind = 'record' in place ? (c.review ? 'review' : 'comment') : c.parent !== undefined ? 'comment' : Number(where.posts) ? 'answer' : 'question';
	const context: { record?: unknown; question?: string; parent?: string; previous?: string[] } = {};
	if ('record' in place) context.record = (await db.query<{ record: unknown }>('SELECT record FROM open_index.records WHERE id = $1', [place.record])).rows[0]?.record;
	else context.question = (await db.query<{ body: string }>('SELECT body FROM open_index.comments WHERE topic_id = $1 AND parent_id IS NULL ORDER BY id LIMIT 1', [place.topic])).rows[0]?.body;
	if (c.parent !== undefined) context.parent = (await db.query<{ body: string }>(`SELECT body FROM open_index.comments WHERE id = $1 AND ${column} = $2`, [c.parent, value])).rows[0]?.body;
	context.previous = (await db.query<{ body: string }>(`SELECT body FROM open_index.comments WHERE ${column} = $1 ORDER BY id DESC LIMIT 4`, [value])).rows.map((p) => p.body);
	await screen(db, voter, { kind, ...('record' in place ? { recordId: place.record } : {}), on: 'record' in place ? `the record ${place.record}` : 'a forum question', title: where.title, body, context }, moderate, Boolean(c.retrieveSources), fetchSource);
	return storePost(db, place, voter, { ...c, body });
}

/** Moderate title and body before even the public topic row exists. */
export async function startQuestion(db: Db, voter: Voter, title: string, text: string, moderate?: Moderator) {
	const body = text.trim();
	if (body.length > 4000) throw new QueryError('the comment is longer than 4,000 characters', 'Shorten it, or post a reply.');
	await refuseKeys(db, body);
	await screen(db, voter, { kind: 'question', on: 'a forum question', title, body }, moderate);
	const id = Number((await db.query<{ id: number }>('INSERT INTO open_index.topics (title, voter, agent) VALUES ($1, $2, $3) RETURNING id',
		[title, voter.login, voter.agent])).rows[0].id);
	try {
		await storePost(db, { topic: id }, voter, { body });
	} catch (e) {
		await db.query('DELETE FROM open_index.topics WHERE id = $1', [id]);
		throw e;
	}
	return id;
}

async function storePost(db: Db, place: Place, voter: Voter, c: { body: string; review?: boolean; parent?: number }) {
	const body = c.body;
	const recordId = 'record' in place ? place.record : null;
	const { rows } = await db.query<{ id: number; at: string }>(
		`INSERT INTO open_index.comments (record_id, topic_id, parent_id, voter, agent, body, review) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, at`,
		[recordId, 'topic' in place ? place.topic : null, c.parent ?? null, voter.login, voter.agent, body, Boolean(c.review)],
	);
	const mentioned = await linkMentions(db, Number(rows[0].id), body, recordId);
	return { id: rows[0].id, ...('record' in place ? { record_id: place.record } : { topic_id: place.topic }), parent: c.parent ?? null, voter: voter.login, agent: voter.agent, body,
		review: Boolean(c.review), at: rows[0].at, mentions: mentioned };
}

/** Creation and accepted edits derive mentions from the same body syntax. */
export async function linkMentions(db: Db, id: number, body: string, recordId: string | null) {
	// Trailing punctuation is not part of an id or URL ("see app/APP-260923-0000.").
	const strip = (s: string) => s.replace(/[.:!?]+$/, '');
	const ids = [...new Set((body.match(ID) ?? []).map(strip))];
	const urls = [...new Set((body.match(URL_) ?? []).map(strip))];
	const mentioned = (await db.query<{ id: string }>(
		`INSERT INTO open_index.mentions (comment_id, record_id)
		 SELECT $1, r.id FROM open_index.records r WHERE (r.id = ANY($2) OR r.url = ANY($3)) AND r.id IS DISTINCT FROM $4
		 ON CONFLICT DO NOTHING RETURNING record_id AS id`,
		[id, ids, urls, recordId],
	)).rows.map((r) => r.id);
	return mentioned;
}

export type Post = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; score: number; mentions: string[]; revision: string };

/** A record's comments, oldest first, with each one's mentions. */
export const comments = (db: Db, recordId: string) => thread(db, { record: recordId });

/** The posts in one place, oldest first, with each one's mentions. */
export async function thread(db: Db, place: Place): Promise<Post[]> {
	return (await db.query<Post>(
		`SELECT c.id::int, c.parent_id::int AS parent, c.voter, c.agent, c.body, c.review, c.at, c.score, c.xmin::text AS revision,
		        coalesce(array_agg(m.record_id) FILTER (WHERE m.record_id IS NOT NULL), '{}') AS mentions
		 FROM open_index.comments c LEFT JOIN open_index.mentions m ON m.comment_id = c.id
		 WHERE c.${'record' in place ? 'record_id' : 'topic_id'} = $1 GROUP BY c.id ORDER BY c.at, c.id`,
		['record' in place ? place.record : place.topic],
	)).rows;
}
