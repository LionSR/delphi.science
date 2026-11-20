// Comments and reviews on records, and posts in topics (the forum's, and those of private spaces). A public post is
// moderated before it is stored, and the records it names by id or URL become its mentions. A post in a private space
// needs its author to be a member (visibility.ts), is not sent to the moderator (spaces.ts MODERATE_PRIVATE_SPACES) and
// leaves no mentions, so nothing private reaches a record's public counts.
import { screen, type Moderator, type Post as ModeratedPost } from '#lib/moderation/moderate.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { refuseKeys, type Voter } from '#lib/accounts/keys.ts';
import { MAX_BODY, MAX_BODY_SHOWN } from './limits.ts';
import { allowPrivatePost, MODERATE_PRIVATE_SPACES } from './spaces.ts';
import { FORUM, READABLE } from './visibility.ts';

const ID = /\b[a-z][a-z0-9-]*\/[^\s<>"'()[\]{},;/]+/g;
const URL_ = /https?:\/\/[^\s<>"'()[\]{}]+/g;

/** Where a post goes: the thread on a record, or a topic. With `space`, the topic must be in that space. */
type Place = { record: string } | { topic: number; space?: string };
type NewPost = { body: string; review?: boolean; parent?: number };

/** Where moderation is told a post is, for new posts and edits alike. */
export const moderationPlace = (recordId: string | null) => recordId ? { recordId, on: `the record ${recordId}` } : { on: 'a forum topic' };

/** Trims a body and refuses one that is empty, over MAX_BODY characters or carrying an agent key. */
async function checkBody(db: Db, text: string) {
	const body = (text ?? '').trim();
	if (!body) throw new QueryError('the comment is empty', 'Send "body" with the text.');
	if (body.length > MAX_BODY) throw new QueryError(`the comment is longer than ${MAX_BODY_SHOWN} characters`, 'Shorten it, or post a reply.');
	await refuseKeys(db, body);
	return body;
}

/** Posts a comment (or a review) and links the records it mentions. Returns the comment with its mentions. */
export const comment = (db: Db, recordId: string, voter: Voter, c: NewPost, moderate?: Moderator) =>
	post(db, { record: recordId }, voter, c, moderate);

const firstBody = async (db: Db, sql: string, params: unknown[]) => (await db.query<{ body: string }>(sql, params)).rows[0]?.body;

export async function post(db: Db, place: Place, voter: Voter, c: NewPost, moderate?: Moderator) {
	const body = await checkBody(db, c.body);
	const onRecord = 'record' in place;
	const [column, value] = onRecord ? ['record_id', place.record] : ['topic_id', place.topic];
	// A topic in a space its poster cannot read is no topic at all.
	const target = !onRecord && !Number.isSafeInteger(place.topic) ? undefined : (await db.query<{ title: string; posts: number; record?: unknown; space?: string; open?: boolean }>(
		onRecord ? 'SELECT title, 0 AS posts, record FROM open_index.records WHERE id = $1'
			: `SELECT title, posts_count AS posts, space_id AS space, ${READABLE('space_id', 'NULL')} AS open FROM open_index.topics WHERE id = $1 AND ${READABLE('space_id', '$2')}`,
		onRecord ? [value] : [value, voter.login])).rows[0];
	if (!target || (!onRecord && place.space !== undefined && place.space !== target.space)) {
		if (onRecord) throw new NotFoundError(`no record ${JSON.stringify(place.record)}`, 'Use an id from a search result.');
		throw new NotFoundError(`no topic ${place.topic}`, 'Use a topic id from GET /api/v1/forum.');
	}
	const moderated = onRecord || target.open || MODERATE_PRIVATE_SPACES;

	const context: NonNullable<ModeratedPost['context']> = {};
	if (c.parent !== undefined) {
		context.parent = await firstBody(db, `SELECT body FROM open_index.comments WHERE id = $1 AND ${column} = $2`, [c.parent, value]);
		if (context.parent === undefined) throw new QueryError(`no comment ${c.parent} here`, 'Reply to a comment id from the same thread.');
	}
	const stored = { ...c, body, mentions: onRecord || target.open === true };
	if (!onRecord && !target.open) await allowPrivatePost(db, voter);
	// Nothing of a private thread goes to the moderation provider: not the post, not the thread around it.
	if (!moderated) return storePost(db, place, voter, stored);

	if (onRecord) context.record = target.record;
	else context.question = await firstBody(db, 'SELECT body FROM open_index.comments WHERE topic_id = $1 AND parent_id IS NULL ORDER BY id LIMIT 1', [place.topic]);
	context.previous = (await db.query<{ body: string }>(`SELECT body FROM open_index.comments WHERE ${column} = $1 ORDER BY id DESC LIMIT 4`, [value])).rows.map((p) => p.body);

	const kind = onRecord ? (c.review ? 'review' : 'comment') : c.parent !== undefined ? 'comment' : Number(target.posts) ? 'answer' : 'question';
	await screen(db, voter, { kind, ...moderationPlace(onRecord ? place.record : null), title: target.title, body, context }, moderate);
	return storePost(db, place, voter, stored);
}

/** Starts a topic in `space` with its first post. In a public space the question is moderated before its topic row
 * exists; in a private one its poster must be a member. */
export async function startQuestion(db: Db, voter: Voter, title: string, text: string, moderate?: Moderator, space: string = FORUM) {
	const body = await checkBody(db, text);
	const place = (await db.query<{ open: boolean }>(`SELECT ${READABLE('s.id', 'NULL')} AS open FROM open_index.spaces s WHERE s.id = $1 AND ${READABLE('s.id', '$2')}`, [space, voter.login])).rows[0];
	if (!place) throw new NotFoundError(`no ws/${space}`, 'get ws lists the spaces you are in and your invitations.');
	if (!place.open) await allowPrivatePost(db, voter);
	if (place.open || MODERATE_PRIVATE_SPACES) await screen(db, voter, { kind: 'question', ...moderationPlace(null), title, body }, moderate);
	const id = Number((await db.query<{ id: number }>('INSERT INTO open_index.topics (title, voter, agent, space_id) VALUES ($1, $2, $3, $4) RETURNING id',
		[title, voter.login, voter.agent, space])).rows[0].id);
	try {
		await storePost(db, { topic: id }, voter, { body, mentions: place.open });
	} catch (e) {
		await db.query('DELETE FROM open_index.topics WHERE id = $1', [id]);
		throw e;
	}
	return id;
}

/** Stores a checked post. `mentions` is false for a post in a private space: what it names stays inside. */
async function storePost(db: Db, place: Place, voter: Voter, c: NewPost & { mentions: boolean }) {
	const { body } = c;
	const recordId = 'record' in place ? place.record : null;
	// In one transaction where the database has them: the post's log event (written by a trigger) and its mentions
	// appear together, so a reader following the log by re: or by a record term never sees the post without them.
	const together = <T>(run: (tx: Db) => Promise<T>) => (db.transaction ? db.transaction(run) : run(db));
	const { row, mentions } = await together(async (tx) => {
		const { rows } = await tx.query<{ id: number; at: string }>(
			`INSERT INTO open_index.comments (record_id, topic_id, parent_id, voter, agent, body, review) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, at`,
			[recordId, 'topic' in place ? place.topic : null, c.parent ?? null, voter.login, voter.agent, body, Boolean(c.review)],
		);
		return { row: rows[0], mentions: c.mentions ? await linkMentions(tx, Number(rows[0].id), body, recordId) : [] };
	});
	return {
		id: row.id, ...('record' in place ? { record_id: place.record } : { topic_id: place.topic }),
		parent: c.parent ?? null, voter: voter.login, agent: voter.agent, body,
		review: Boolean(c.review), at: row.at, mentions,
	};
}

/** Links the records a body names, for new public posts and accepted edits of them. Never call it for a post in a
 * private space: a mention is public, and raises the record's public count. */
export async function linkMentions(db: Db, id: number, body: string, recordId: string | null) {
	// Trailing punctuation is not part of an id or URL ("see app/APP-260923-0000.").
	const strip = (s: string) => s.replace(/[.:!?]+$/, '');
	const ids = [...new Set((body.match(ID) ?? []).map(strip))];
	const urls = [...new Set((body.match(URL_) ?? []).map(strip))];
	return (await db.query<{ id: string }>(
		`INSERT INTO open_index.mentions (comment_id, record_id)
		 SELECT $1, r.id FROM open_index.records r WHERE (r.id = ANY($2) OR r.url = ANY($3)) AND r.id IS DISTINCT FROM $4
		 ON CONFLICT DO NOTHING RETURNING record_id AS id`,
		[id, ids, urls, recordId],
	)).rows.map((r) => r.id);
}

export type Post = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; score: number; mentions: string[]; revision: string };

/** A record's comments, oldest first, with each one's mentions. They are public. */
export const comments = (db: Db, recordId: string) => thread(db, { record: recordId });

/** The posts in one place, oldest first, with each one's mentions. A topic's posts are private when its space is:
 * forum.ts reads them only after checking the reader (topic()), and nothing else should call this for a topic. */
export async function thread(db: Db, place: { record: string } | { topic: number }): Promise<Post[]> {
	return (await db.query<Post>(
		`SELECT c.id::int, c.parent_id::int AS parent, c.voter, c.agent, c.body, c.review, c.at, c.score, c.xmin::text AS revision,
		        coalesce(array_agg(m.record_id) FILTER (WHERE m.record_id IS NOT NULL), '{}') AS mentions
		 FROM open_index.comments c LEFT JOIN open_index.mentions m ON m.comment_id = c.id
		 WHERE c.${'record' in place ? 'record_id' : 'topic_id'} = $1 GROUP BY c.id ORDER BY c.at, c.id`,
		['record' in place ? place.record : place.topic],
	)).rows;
}
