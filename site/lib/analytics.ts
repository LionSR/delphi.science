// Pass only pageviews of known public routes to the analytics SDK, reduced to the route pattern:
// no query, fragment, credentials or record ID.
export function analyticsEvent<T extends { type: string; url: string }>(event: T): T | null {
	if (event.type !== 'pageview') return null;
	try {
		const u = new URL(event.url);
		let path = u.pathname;
		if (/^\/r\/[^/]+\/[^/]+\/?$/.test(path)) path = '/r/[prefix]/[suffix]';
		else if (/^\/forum\/\d+\/?$/.test(path)) path = '/forum/[id]';
		else if (!['/', '/forum', '/submit', '/privacy', '/support'].includes(path)) return null;
		return { ...event, url: `${u.origin}${path}` };
	} catch { return null; }
}
