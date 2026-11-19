// Publishes posts from the site's forms. If the author already posted the same text, a retry returns that post
// instead of posting it again.
import { comment, post } from './comments.ts';
import { sectionId } from './sections.ts';
import { startTopic, topicTitle } from './forum.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { submit } from '#lib/records/submit.ts';
import { recordPath } from '#lib/view.ts';
import type { Voter } from '#lib/accounts/keys.ts';
import { MAX_BODY, MAX_BODY_SHOWN } from './limits.ts';
import { topicPath } from './spaces.ts';
import { canRead, FORUM } from './visibility.ts';

/** What a post form can publish. */
export const FORM_KINDS = ['question', 'answer', 'comment', 'record', 'submission'] as const;

export type PostInput = { kind: (typeof FORM_KINDS)[number]; title: string; body: string;
	topic?: number; parent?: number; record?: string; review: boolean; retrieveSources?: boolean;
	/** The space a topic is in or goes to; the forum when left out. */
	space?: string;
	/** The forum section a new topic goes to; general when left out. */
	section?: string };

export async function submitPostForm(db: Db, who: Voter, input: PostInput, moderate?: Moderator, fetcher: typeof fetch = fetch): Promise<string> {
	const body = input.body.trim();
	const space = input.space ?? FORUM;
	if (!body || body.length > MAX_BODY) throw new QueryError(`The post needs 1–${MAX_BODY_SHOWN} characters.`, 'Keep the precise question, argument or evidence and shorten unrelated background.');
	if (input.kind === 'submission') {
		if (body.length > 2000) throw new QueryError('The link is longer than 2,000 characters.', 'Send one scholarly URL or identifier.');
		const result = await submit(db, body, who, fetcher, moderate);
		return recordPath(result.id);
	}
	// Before anything is looked up, a retry included: a space its author cannot read (a member since removed) is not there.
	if (input.kind !== 'record' && !await canRead(db, space, who.login)) throw new NotFoundError(`no ws/${space}`, 'Open one of your spaces from /ws.');
	if (input.kind === 'question') {
		const section = sectionId(input.section === undefined ? 'general' : input.section);
		const title = topicTitle(input.title);
		if (!title || title.length > 200) throw new QueryError('The title needs 1–200 characters.', 'State the research question in one line.');
		const existing = (await db.query<{ id: number }>(
			`SELECT t.id::int FROM open_index.topics t JOIN open_index.comments c ON c.topic_id=t.id
			 WHERE t.voter=$1 AND t.title=$2 AND t.space_id=$4 AND t.section=$5 AND c.voter=$1 AND c.body=$3 AND c.parent_id IS NULL
			 AND c.id=(SELECT min(q.id) FROM open_index.comments q WHERE q.topic_id=t.id AND q.parent_id IS NULL) LIMIT 1`, [who.login, title, body, space, section])).rows[0];
		return `/${topicPath(space, existing?.id ?? (await startTopic(db, who, { title, body, space, section }, moderate)).id)}`;
	}
	if (input.kind === 'record') {
		if (!input.record) throw new QueryError('No record was selected.', 'Open an indexed record and use its comment form.');
		const existing = (await db.query<{ id: number }>(
			`SELECT id::int FROM open_index.comments WHERE record_id=$1 AND voter=$2 AND body=$3 AND review=$4 AND parent_id IS NULL LIMIT 1`,
			[input.record, who.login, body, input.review])).rows[0];
		const p = existing ?? await comment(db, input.record, who, { body, review: input.review, retrieveSources: input.retrieveSources }, moderate);
		return `${recordPath(input.record)}#p${p.id}`;
	}
	const positive = (n: number | undefined) => Number.isSafeInteger(n) && Number(n) >= 1;
	if (!positive(input.topic) || (input.kind === 'comment' && !positive(input.parent))) {
		throw new QueryError('No valid thread was selected.', 'Open the topic and use its reply or comment form.');
	}
	const parent = input.kind === 'comment' ? input.parent : undefined;
	const existing = (await db.query<{ id: number }>(
		`SELECT id::int FROM open_index.comments WHERE topic_id=$1 AND voter=$2 AND body=$3 AND parent_id IS NOT DISTINCT FROM $4
		 AND topic_id IN (SELECT id FROM open_index.topics WHERE space_id=$6)
		 AND ($5 <> 'answer' OR id>(SELECT min(q.id) FROM open_index.comments q WHERE q.topic_id=$1 AND q.parent_id IS NULL)) LIMIT 1`,
		[input.topic, who.login, body, parent ?? null, input.kind, space])).rows[0];
	const p = existing ?? await post(db, { topic: input.topic!, space }, who, { body, parent }, moderate);
	return `/${topicPath(space, input.topic!)}#p${p.id}`;
}
