// Where GitHub sends people back after sign-in.
// The GitHub App lists one callback URL, on the site's own address (SITE). Visitors on the www
// variant still get that address: the host redirect brings them back to www with the code and
// state intact, so the state cookie set on www still matches. Other hosts (previews, local) use their own.
import { SITE } from '#lib/view.ts';

const bare = (u: URL) => `${u.protocol}//${u.host.replace(/^www\./, '')}`;

export function callbackUrl(origin: string, site = SITE): string {
	const from = new URL(origin), home = new URL(site);
	return `${bare(from) === bare(home) ? home.origin : from.origin}/auth/callback`;
}
