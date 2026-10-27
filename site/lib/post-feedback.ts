import { QueryError } from './query.ts';

export type PostFeedback = { code: string; message: string; fix: string };
export type PostFormState = { status: 'idle' | 'failed' | 'posted'; feedback?: PostFeedback; location?: string };

/** Classification is set by server control flow, never guessed from a model's prose. */
export class ModerationError extends QueryError {
	readonly code: 'moderation_rejected' | 'moderation_review_needed' | 'moderation_unavailable';
	readonly status: 409 | 422 | 503;
	constructor(code: 'moderation_rejected' | 'moderation_review_needed' | 'moderation_unavailable', message: string, fix: string) {
		super(message, fix);
		this.code = code;
		this.status = code === 'moderation_rejected' ? 422 : code === 'moderation_review_needed' ? 409 : 503;
	}
}

/** Unexpected failures may happen after a write: ask the author to check the thread before retrying. */
export function postFeedback(error: unknown): PostFeedback {
	if (error instanceof ModerationError) return { code: error.code, message: error.message, fix: error.fix };
	if (error instanceof QueryError) return { code: 'bad_request', message: error.message, fix: error.fix };
	return { code: 'posting_unconfirmed', message: 'Posting could not be confirmed.',
		fix: 'Your draft is retained. Check the thread before trying again, in case the post was saved.' };
}
