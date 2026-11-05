// The route pattern of a known public page, or null. The same pattern goes in the event URL and in the SDK's separate
// dynamic-path field.
export function analyticsPath(path: string): string | null {
	if (/^\/r\/[^/]+\/[^/]+\/?$/.test(path)) return '/r/[prefix]/[suffix]';
	if (/^\/forum\/\d+\/?$/.test(path)) return '/forum/[id]';
	return ['/', '/forum', '/submit', '/privacy', '/support'].includes(path) ? path : null;
}

// The hosted script adds referrer and stored attribution separately from beforeSend's event URL.
// Skip collection if those fields could carry a path, query, or user-provided identifier.
export function analyticsContextSafe(referrer: string, attribution: string | null): boolean {
	if (attribution !== null) return false;
	if (!referrer) return true;
	try {
		const u = new URL(referrer);
		return ['https:', 'http:'].includes(u.protocol) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password;
	} catch { return false; }
}

// Pass only pageviews of known public routes: no query, fragment, credentials or record ID.
export function analyticsEvent<T extends { type: string; url: string }>(event: T): T | null {
	if (event.type !== 'pageview') return null;
	try {
		const u = new URL(event.url);
		if (!['https:', 'http:'].includes(u.protocol)) return null;
		const path = analyticsPath(u.pathname);
		if (!path) return null;
		return { ...event, url: `${u.origin}${path}` };
	} catch { return null; }
}
