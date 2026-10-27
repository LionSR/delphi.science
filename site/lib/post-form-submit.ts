import type { Db } from './query.ts';
import { QueryError } from './query.ts';
import { comment, post } from './comments.ts';
import { startTopic } from './forum.ts';
import type { Moderator } from './moderate.ts';
import { submit } from './submit.ts';
import type { Voter } from './votes.ts';
import { recordPath } from './view.ts';

export type PostInput = { kind: 'question' | 'answer' | 'comment' | 'record' | 'submission'; title: string; body: string;
	topic?: number; parent?: number; record?: string; review: boolean };

/** Browser and private integration tests share the actual publication path; a retry reuses identical own posts. */
export async function submitPostForm(db: Db, who: Voter, input: PostInput, moderate?: Moderator, fetcher: typeof fetch = fetch): Promise<string> {
	const body = input.body.trim();
	if (!body || body.length > 4000) throw new QueryError('The post needs 1–4,000 characters.', 'Keep the precise question, argument or evidence and shorten unrelated background.');
	if (input.kind === 'submission') {
		if (body.length > 2000) throw new QueryError('The link is longer than 2,000 characters.', 'Send one scholarly URL or identifier.');
		const result = await submit(db, body, who, fetcher, moderate);
		return recordPath(result.id);
	}
	if (input.kind === 'question') {
		const title = input.title.trim().replace(/\s+/g, ' ');
		if (!title || title.length > 200) throw new QueryError('The title needs 1–200 characters.', 'State the research question in one line.');
		const existing = (await db.query<{ id: number }>(
			`SELECT t.id::int FROM open_index.topics t JOIN open_index.comments c ON c.topic_id=t.id
			 WHERE t.voter=$1 AND t.title=$2 AND c.voter=$1 AND c.body=$3 AND c.parent_id IS NULL
			 AND c.id=(SELECT min(q.id) FROM open_index.comments q WHERE q.topic_id=t.id AND q.parent_id IS NULL) LIMIT 1`, [who.login, title, body])).rows[0];
		return `/forum/${existing?.id ?? (await startTopic(db, who, { title, body }, moderate)).id}`;
	}
	if (input.kind === 'record') {
		if (!input.record) throw new QueryError('No record was selected.', 'Open an indexed record and use its comment form.');
		const existing = (await db.query<{ id: number }>(
			`SELECT id::int FROM open_index.comments WHERE record_id=$1 AND voter=$2 AND body=$3 AND review=$4 AND parent_id IS NULL LIMIT 1`,
			[input.record, who.login, body, input.review])).rows[0];
		const p = existing ?? await comment(db, input.record, who, { body, review: input.review }, moderate);
		return `${recordPath(input.record)}#p${p.id}`;
	}
	if (!Number.isSafeInteger(input.topic) || Number(input.topic) < 1 || (input.kind === 'comment' && (!Number.isSafeInteger(input.parent) || Number(input.parent) < 1))) {
		throw new QueryError('No valid thread was selected.', 'Open the question and use its answer or comment form.');
	}
	const parent = input.kind === 'comment' ? input.parent : undefined;
	const existing = (await db.query<{ id: number }>(
		`SELECT id::int FROM open_index.comments WHERE topic_id=$1 AND voter=$2 AND body=$3 AND parent_id IS NOT DISTINCT FROM $4
		 AND ($5 <> 'answer' OR id>(SELECT min(q.id) FROM open_index.comments q WHERE q.topic_id=$1 AND q.parent_id IS NULL)) LIMIT 1`,
		[input.topic, who.login, body, parent ?? null, input.kind])).rows[0];
	const p = existing ?? await post(db, { topic: input.topic! }, who, { body, parent }, moderate);
	return `/forum/${input.topic}#p${p.id}`;
}
