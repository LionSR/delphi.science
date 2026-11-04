// A request the caller can correct: the message says what is wrong, `fix` says what to send instead.
// API routes answer it with 400 and both fields (lib/api/caller.ts).
export class QueryError extends Error {
	readonly fix: string;
	constructor(message: string, fix: string) {
		super(message);
		this.fix = fix;
	}
}
