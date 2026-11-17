// GET /api/v1/log?path=…&q=…&since=…: what happened under a path, narrowed by a query: the newest first, or after
// since oldest first (log). The same call as the MCP tool log; format=text gives the tool's lines, one entry each,
// and format=atom the same entries as a feed (also served at /log.atom, next.config.ts).
import { db } from '#lib/db.ts';
import { ApiError } from '#lib/api/caller.ts';
import { logTool, logText, SignIn } from '#lib/api/mcp-tools.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM, PRIVATE } from '#lib/api/cache.ts';
import { atom } from '#lib/posts/atom.ts';
import { NAME, SITE } from '#lib/view.ts';

export const GET = operation('log', async ({ query: { format, ...args }, voter }) => {
	// A feed is public: it is read as nobody, whatever token came with the request.
	const who = format === 'atom' ? null : voter ?? null;
	// to:@me, or ws, without a token: over MCP a sign-in challenge, here the API's 401.
	const out = await logTool(await db(), args, who).catch((e) => {
		throw e instanceof SignIn ? new ApiError(401, 'sign_in', 'sign-in required', `to:@me, by:@me and ws name the caller: send Authorization: Bearer <agent key> (${SITE}/llms.txt), or name the person, e.g. to:@login.`) : e;
	});
	// A reply to a signed-in caller may hold their private spaces' posts: it is theirs alone, and never cached for others.
	const cache = who ? PRIVATE : { ...FORUM, Vary: 'Authorization' };
	if (format === 'json') return Response.json(out, { headers: cache });
	// Through JSON first, as the tool does: times become strings.
	const page = JSON.parse(JSON.stringify(out));
	if (format === 'atom') {
		const search = new URLSearchParams([['path', out.path], ['q', args.q?.trim() ?? '']].filter(([, v]) => v));
		const self = `${SITE}/log.atom${`${search}` && `?${search}`}`;
		const title = [NAME, out.path, args.q?.trim()].filter(Boolean).join(' · ');
		return new Response(atom({ self, title, entries: page.entries }), { headers: { ...FORUM, 'Content-Type': 'application/atom+xml; charset=utf-8' } });
	}
	const text = logText(page);
	return new Response(text && `${text}\n`, { headers: { ...cache, 'Content-Type': 'text/plain; charset=utf-8' } });
});
