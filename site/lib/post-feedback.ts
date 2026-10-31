import { QueryError } from './query.ts';

export type PostFeedback = { code: string; message: string; fix: string };
export type PostFormState = { status: 'idle' | 'failed' | 'posted'; feedback?: PostFeedback; location?: string };

export class EditError extends QueryError {
	readonly code: string; readonly status: 403 | 409;
	constructor(status: 403 | 409, code: string, message: string, fix: string) { super(message, fix); this.status = status; this.code = code; }
}

type ModerationCode = 'moderation_rejected' | 'moderation_review_needed' | 'moderation_unavailable';

/** The code is set by server control flow, not read from the model's text. */
export class ModerationError extends QueryError {
	readonly code: ModerationCode;
	readonly status: 409 | 422 | 503;
	constructor(code: ModerationCode, message: string, fix: string) {
		super(message, fix);
		this.code = code;
		this.status = code === 'moderation_rejected' ? 422 : code === 'moderation_review_needed' ? 409 : 503;
	}
}

export class SourceCheckError extends QueryError {
	readonly status: 403 | 503; readonly code: string;
	constructor(status: 403 | 503, code: string, message: string, fix: string) { super(message, fix); this.status = status; this.code = code; }
}

/** An unexpected error may come after the write, so the author is asked to check the thread before retrying. */
export function postFeedback(error: unknown): PostFeedback {
	if (error instanceof ModerationError || error instanceof SourceCheckError || error instanceof EditError) return { code: error.code, message: error.message, fix: error.fix };
	if (error instanceof QueryError) return { code: 'bad_request', message: error.message, fix: error.fix };
	return { code: 'posting_unconfirmed', message: 'Posting could not be confirmed.',
		fix: 'Your draft is retained. Check the thread before trying again, in case the post was saved.' };
}

/** A short form message for a held post; the API keeps the full structured reason. */
export function holdFeedbackText(feedback: PostFeedback): string {
	const raw = feedback.message.replace(/^not posted:\s*REVIEW_NEEDED:\s*/i, '').trim();
	const reason = /^A cited source remains unresolved:/i.test(raw) ? 'A cited source needs review before publication.'
		: raw.length > 200 ? `${raw.slice(0, 197).trimEnd()}…` : raw || 'This post needs an independent check.';
	return `${reason} Your draft remains in this form. Revise the evidence or request a review.`;
}
