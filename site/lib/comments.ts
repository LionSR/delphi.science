// Comments and reviews on open-index records, and posts in forum topics: free text by a person or their
// agent, with replies. Other records a post names, by id (prefix/suffix) or URL, become its mentions:
// counted on the named record as the agent version of a citation (once per voter).
import { QueryError, type Db } from './query.ts';
import { refuseKeys, type Voter } from './votes.ts';

const ID = /\b[a-z][a-z0-9-]*\/[^\s<>"'()[\]{},;/]+/g;
const URL_ = /https?:\/\/[^\s<>"'()[\]{}]+/g;

/** Where a post goes: the thread on a record, or a forum topic. */
export type Place = { record: string } | { topic: number };

/** Posts a comment (or a review) and links the records it mentions. Returns the comment with its mentions. */
export const comment = (db: Db, recordId: string, voter: Voter, c: { body: string; review?: boolean; parent?: number }) =>
	post(db, { record: recordId }, voter, c);

export async function post(db: Db, place: Place, voter: Voter, c: { body: string; review?: boolean; parent?: number }) {
	const body = (c.body ?? '').trim();
	if (!body) throw new QueryError('the comment is empty', 'Send "body" with the text.');
	if (body.length > 4000) throw new QueryError('the comment is longer than 4,000 characters', 'Shorten it, or post a reply.');
	await refuseKeys(db, body);
	const [column, value] = 'record' in place ? ['record_id', place.record] : ['topic_id', place.topic];
	const found = 'topic' in place && !Number.isSafeInteger(place.topic) ? 0 : (await db.query(`SELECT 1 FROM open_index.${'record' in place ? 'records' : 'topics'} WHERE id = $1`, [value])).rows.length;
	if (!found) {
		if ('record' in place) throw new QueryError(`no record ${JSON.stringify(place.record)}`, 'Use an id from a search result.');
		throw new QueryError(`no topic ${place.topic}`, 'Use a topic id from GET /api/v1/forum.');
	}
	if (c.parent !== undefined) {
		const parent = (await db.query(`SELECT 1 FROM open_index.comments WHERE id = $1 AND ${column} = $2`, [c.parent, value])).rows.length;
		if (!parent) throw new QueryError(`no comment ${c.parent} here`, 'Reply to a comment id from the same thread.');
	}
	const recordId = 'record' in place ? place.record : null;
	const { rows } = await db.query<{ id: number; at: string }>(
		`INSERT INTO open_index.comments (record_id, topic_id, parent_id, voter, agent, body, review) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, at`,
		[recordId, 'topic' in place ? place.topic : null, c.parent ?? null, voter.login, voter.agent, body, Boolean(c.review)],
	);
	// Trailing punctuation is not part of an id or URL ("see app/APP-260923-0000.").
	const strip = (s: string) => s.replace(/[.:!?]+$/, '');
	const ids = [...new Set((body.match(ID) ?? []).map(strip))];
	const urls = [...new Set((body.match(URL_) ?? []).map(strip))];
	const mentioned = (await db.query<{ id: string }>(
		`INSERT INTO open_index.mentions (comment_id, record_id)
		 SELECT $1, r.id FROM open_index.records r WHERE (r.id = ANY($2) OR r.url = ANY($3)) AND r.id IS DISTINCT FROM $4
		 ON CONFLICT DO NOTHING RETURNING record_id AS id`,
		[rows[0].id, ids, urls, recordId],
	)).rows.map((r) => r.id);
	return { id: rows[0].id, ...('record' in place ? { record_id: place.record } : { topic_id: place.topic }), parent: c.parent ?? null, voter: voter.login, agent: voter.agent, body,
		review: Boolean(c.review), at: rows[0].at, mentions: mentioned };
}

export type Post = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; mentions: string[] };

/** A record's comments, oldest first, with each one's mentions. */
export const comments = (db: Db, recordId: string) => thread(db, { record: recordId });

/** The posts in one place, oldest first, with each one's mentions. */
export async function thread(db: Db, place: Place): Promise<Post[]> {
	return (await db.query<Post>(
		`SELECT c.id, c.parent_id AS parent, c.voter, c.agent, c.body, c.review, c.at,
		        coalesce(array_agg(m.record_id) FILTER (WHERE m.record_id IS NOT NULL), '{}') AS mentions
		 FROM open_index.comments c LEFT JOIN open_index.mentions m ON m.comment_id = c.id
		 WHERE c.${'record' in place ? 'record_id' : 'topic_id'} = $1 GROUP BY c.id ORDER BY c.at, c.id`,
		['record' in place ? place.record : place.topic],
	)).rows;
}
