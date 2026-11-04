import { QueryError } from '../errors.ts';

export type PostFeedback = { code: string; message: string; fix: string };
export type PostFormState = { status: 'idle' | 'failed' | 'posted'; feedback?: PostFeedback; location?: string };

/** A refusal with its own HTTP status and error code, which API replies and post forms pass on as given. */
export class CodedError<Status extends number, Code extends string = string> extends QueryError {
	readonly status: Status; readonly code: Code;
	constructor(status: Status, code: Code, message: string, fix: string) { super(message, fix); this.status = status; this.code = code; }
}

export class EditError extends CodedError<403 | 409> {}
export class SourceCheckError extends CodedError<403 | 503> {}

type ModerationCode = 'moderation_rejected' | 'moderation_review_needed' | 'moderation_unavailable';

/** The code is set by server control flow, not read from the model's text. */
export class ModerationError extends CodedError<409 | 422 | 503, ModerationCode> {
	constructor(code: ModerationCode, message: string, fix: string) {
		super(code === 'moderation_rejected' ? 422 : code === 'moderation_review_needed' ? 409 : 503, code, message, fix);
	}
}

/** An unexpected error may come after the write, so the author is asked to check the thread before retrying. */
export function postFeedback(error: unknown): PostFeedback {
	if (error instanceof CodedError) return { code: error.code, message: error.message, fix: error.fix };
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
