// Errors a caller can act on. The message says what is wrong, and `fix` says what to send instead. API routes turn them
// into {"error": {code, message, fix}} (lib/api/caller.ts handle): a QueryError is 400 bad_request, a NotFoundError
// 404 not_found, and a CodedError carries its own status and code. Post forms show the same fields (posts/feedback.ts).
export class QueryError extends Error {
	readonly fix: string;
	constructor(message: string, fix: string) {
		super(message);
		this.fix = fix;
	}
}

/** A record, topic or post that does not exist (or is gone). */
export class NotFoundError extends QueryError {}

/** A refusal with its own HTTP status and error code, which API replies and post forms pass on as given. */
export class CodedError extends QueryError {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string, fix: string) {
		super(message, fix);
		this.status = status;
		this.code = code;
	}
}

export class EditError extends CodedError {}
export class SourceCheckError extends CodedError {}

type ModerationCode = 'moderation_rejected' | 'moderation_review_needed' | 'moderation_unavailable';

/** The code is set by server control flow, not read from the model's text. */
export class ModerationError extends CodedError {
	constructor(code: ModerationCode, message: string, fix: string) {
		super(code === 'moderation_rejected' ? 422 : code === 'moderation_review_needed' ? 409 : 503, code, message, fix);
	}
}
