// The browser SDK receives only approved public route patterns. Private/unknown routes and custom
// events are dropped; queries, fragments, URL credentials and resolved record IDs never leave here.
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
