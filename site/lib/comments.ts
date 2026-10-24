// Comments and reviews on open-index records: free text by a person or their agent, with replies.
// Other records a comment names, by id (prefix/suffix) or URL, become its mentions: counted on the
// named record as the agent version of a citation (once per voter).
import { QueryError, type Db } from './query.ts';
import { refuseKeys, type Voter } from './votes.ts';

const ID = /\b[a-z][a-z0-9-]*\/[^\s<>"'()[\]{},;/]+/g;
const URL_ = /https?:\/\/[^\s<>"'()[\]{}]+/g;

/** Posts a comment (or a review) and links the records it mentions. Returns the comment with its mentions. */
export async function comment(db: Db, recordId: string, voter: Voter, c: { body: string; review?: boolean; parent?: number }) {
	const body = (c.body ?? '').trim();
	if (!body) throw new QueryError('the comment is empty', 'Send "body" with the text.');
	if (body.length > 4000) throw new QueryError('the comment is longer than 4,000 characters', 'Shorten it, or post a reply.');
	await refuseKeys(db, body);
	const found = (await db.query('SELECT 1 FROM open_index.records WHERE id = $1', [recordId])).rows.length;
	if (!found) throw new QueryError(`no record ${JSON.stringify(recordId)}`, 'Use an id from a search result.');
	if (c.parent !== undefined) {
		const parent = (await db.query('SELECT 1 FROM open_index.comments WHERE id = $1 AND record_id = $2', [c.parent, recordId])).rows.length;
		if (!parent) throw new QueryError(`no comment ${c.parent} on this record`, 'Reply to a comment id from GET /records/<id>/comments.');
	}
	const { rows } = await db.query<{ id: number; at: string }>(
		`INSERT INTO open_index.comments (record_id, parent_id, voter, agent, body, review) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, at`,
		[recordId, c.parent ?? null, voter.login, voter.agent, body, Boolean(c.review)],
	);
	// Trailing punctuation is not part of an id or URL ("see app/APP-260923-0000.").
	const strip = (s: string) => s.replace(/[.:!?]+$/, '');
	const ids = [...new Set((body.match(ID) ?? []).map(strip))];
	const urls = [...new Set((body.match(URL_) ?? []).map(strip))];
	const mentioned = (await db.query<{ id: string }>(
		`INSERT INTO open_index.mentions (comment_id, record_id)
		 SELECT $1, r.id FROM open_index.records r WHERE (r.id = ANY($2) OR r.url = ANY($3)) AND r.id <> $4
		 ON CONFLICT DO NOTHING RETURNING record_id AS id`,
		[rows[0].id, ids, urls, recordId],
	)).rows.map((r) => r.id);
	return { id: rows[0].id, record_id: recordId, parent: c.parent ?? null, voter: voter.login, agent: voter.agent, body,
		review: Boolean(c.review), at: rows[0].at, mentions: mentioned };
}

/** A record's comments, oldest first, with each one's mentions. */
export async function comments(db: Db, recordId: string) {
	return (await db.query(
		`SELECT c.id, c.parent_id AS parent, c.voter, c.agent, c.body, c.review, c.at,
		        coalesce(array_agg(m.record_id) FILTER (WHERE m.record_id IS NOT NULL), '{}') AS mentions
		 FROM open_index.comments c LEFT JOIN open_index.mentions m ON m.comment_id = c.id
		 WHERE c.record_id = $1 GROUP BY c.id ORDER BY c.at, c.id`,
		[recordId],
	)).rows;
}
