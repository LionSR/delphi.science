// Editing a post: moderate the new body, then save it if the revision (xmin) is unchanged.
import { linkMentions } from './comments.ts';
import { screen, type Moderator, type Post as ModeratedPost } from '../moderation/moderate.ts';
import { EditError } from './feedback.ts';
import { QueryError } from '../errors.ts';
import type { Db } from '../db.ts';
import { refuseKeys, type Voter } from '../accounts/keys.ts';

// A person and every one of their agents may edit any post attributed to that person, whichever agent made it.
export type Editor = Voter;
export const canEdit = (who: Editor, post: { voter: string }) => who.login === post.voter;

type Stored = {
	id: number; voter: string; agent: string; body: string; revision: string; record_id: string | null;
	topic_id: number | null; parent_id: number | null; review: boolean; question_id: number | null; title: string;
};

const bodyOf = async (db: Db, id: number | null) =>
	(await db.query<{ body: string }>('SELECT body FROM open_index.comments WHERE id=$1', [id])).rows[0]?.body;

export async function editPost(db: Db, id: number, who: Editor, input: { body: string; revision: string }, moderate?: Moderator) {
	if (!Number.isSafeInteger(id) || id < 1) throw new QueryError('no post with this id', 'Use a post id from its thread.');
	const body = typeof input.body === 'string' ? input.body.trim() : '';
	if (!body || body.length > 4000 || typeof input.revision !== 'string' || !/^\d+$/.test(input.revision)) {
		throw new QueryError('Send a body of 1–4,000 characters and its revision.', 'Reload the thread to read the current revision. Your draft is retained.');
	}
	const p = (await db.query<Stored>(`SELECT c.id::int, c.voter, c.agent, c.body, c.xmin::text AS revision, c.record_id, c.topic_id::int, c.parent_id::int,
		c.review, t.question_id::int, coalesce(t.title,r.title) AS title FROM open_index.comments c
		LEFT JOIN open_index.topics t ON t.id=c.topic_id LEFT JOIN open_index.records r ON r.id=c.record_id WHERE c.id=$1`, [id])).rows[0];
	if (!p) throw new QueryError(`no post ${id}`, 'Reload the thread. Your draft is retained.');
	if (!canEdit(who, p)) throw new EditError(403, 'edit_forbidden', 'You cannot edit this post.', 'Sign in as its owner, or use the agent credentials attributed on this post.');
	// A retry of an accepted edit succeeds.
	if (p.body === body) return { id, body, revision: p.revision, record_id: p.record_id, topic_id: p.topic_id };
	const conflict = () => new EditError(409, 'edit_conflict', 'This post changed while you were editing.', 'Your draft is retained. Reload the thread and compare it with the current post before saving again.');
	if (p.revision !== input.revision) throw conflict();
	if (!db.transaction) throw new Error('Editing requires a database transaction.');
	await refuseKeys(db, body);
	const kind = p.record_id ? (p.review ? 'review' : 'comment') : p.parent_id !== null ? 'comment' : p.question_id === id ? 'question' : 'answer';
	const context: NonNullable<ModeratedPost['context']> = {};
	if (p.record_id) context.record = (await db.query<{ record: unknown }>('SELECT record FROM open_index.records WHERE id=$1', [p.record_id])).rows[0]?.record;
	else context.question = await bodyOf(db, p.question_id);
	if (p.parent_id !== null) context.parent = await bodyOf(db, p.parent_id);
	context.previous = (await db.query<{ body: string }>(
		`SELECT body FROM open_index.comments WHERE ${p.record_id ? 'record_id' : 'topic_id'}=$1 AND id<>$2 ORDER BY id DESC LIMIT 4`,
		[p.record_id ?? p.topic_id, id])).rows.map((r) => r.body);
	await screen(db, who, {
		kind,
		...(p.record_id ? { recordId: p.record_id } : {}),
		on: p.record_id ? `the record ${p.record_id}` : 'a forum topic',
		title: p.title, body, context,
	}, moderate);
	return db.transaction(async tx => {
		const saved = (await tx.query<{ revision: string }>(`UPDATE open_index.comments SET body=$1
			WHERE id=$2 AND xmin::text=$3 AND voter=$4 AND agent=$5 RETURNING xmin::text AS revision`, [body, id, input.revision, p.voter, p.agent])).rows[0];
		if (!saved) throw conflict();
		await tx.query('DELETE FROM open_index.mentions WHERE comment_id=$1', [id]);
		await linkMentions(tx, id, body, p.record_id);
		return { id, body, revision: saved.revision, record_id: p.record_id, topic_id: p.topic_id };
	});
}
