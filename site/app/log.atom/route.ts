// GET /log.atom?path=…&q=…: the log as an Atom feed, for a feed reader. The same call as GET /api/v1/log with
// format=atom: the same entries, read as nobody.
import { GET as log } from '#app/api/v1/log/route.ts';

export const GET = (req: Request) => {
	const url = new URL(req.url);
	url.pathname = '/api/v1/log';
	url.searchParams.set('format', 'atom');
	return log(new Request(url, { headers: req.headers }));
};
