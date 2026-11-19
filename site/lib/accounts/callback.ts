// Keep GitHub sign-in and code exchange on the origin that owns the state cookie.
// Register both production callbacks with the GitHub App before serving both hosts.
// Previews and local development retain their own origin; SITE remains the canonical site URL.
export function callbackUrl(origin: string): string {
	return `${new URL(origin).origin}/auth/callback`;
}

/** A local path to return to after signing in; anything else goes home. A browser reads `\` as `/` and drops tabs and
 * newlines, so `/\host` and `/<tab>/host` name another site: those are refused, and the path must resolve on one origin. */
export function safeNext(next: unknown): string {
	if (typeof next !== 'string' || !next.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(next)) return '/';
	const base = 'https://local.invalid';
	try {
		const url = new URL(next, base);
		return url.origin === base ? url.pathname + url.search + url.hash : '/';
	} catch { return '/'; }
}
