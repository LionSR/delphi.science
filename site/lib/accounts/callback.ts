// Keep GitHub sign-in and code exchange on the origin that owns the state cookie.
// Register both production callbacks with the GitHub App before serving both hosts.
// Previews and local development retain their own origin; SITE remains the canonical site URL.
export function callbackUrl(origin: string): string {
	return `${new URL(origin).origin}/auth/callback`;
}
