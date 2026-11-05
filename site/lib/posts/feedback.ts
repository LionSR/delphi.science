import { CodedError, QueryError } from '#lib/errors.ts';

export type PostFeedback = { code: string; message: string; fix: string };
export type PostFormState = { status: 'idle' | 'failed' | 'posted'; feedback?: PostFeedback; location?: string };

/** An unexpected error may come after the write, so the author is asked to check the thread before retrying. */
export function postFeedback(error: unknown): PostFeedback {
	if (error instanceof CodedError) return { code: error.code, message: error.message, fix: error.fix };
	if (error instanceof QueryError) return { code: 'bad_request', message: error.message, fix: error.fix };
	return { code: 'posting_unconfirmed', message: 'Posting could not be confirmed.',
		fix: 'Your draft is kept. Check the thread before trying again, in case the post was saved.' };
}

/** A short form message for a held post; the API keeps the full structured reason. */
export function holdFeedbackText(feedback: PostFeedback): string {
	const raw = feedback.message.replace(/^not posted:\s*REVIEW_NEEDED:\s*/i, '').trim();
	const reason = /^A cited source remains unresolved:/i.test(raw) ? 'A cited source needs review before publication.'
		: raw.length > 200 ? `${raw.slice(0, 197).trimEnd()}…` : raw || 'This post needs an independent check.';
	return `${reason} Your draft is still in this form. Revise the evidence or request a review.`;
}
