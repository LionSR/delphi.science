// Paging, one way for every list the website, the API and the MCP tools serve: ask for a page by number (from 1), or
// pass the cursor from the previous reply. A cursor carries where the next page starts and the total, so later pages
// skip the count. Each reply says its page, how many pages there are, and the cursor for the next one.
import { QueryError } from './errors.ts';

/** The highest page number a request may ask for. */
export const MAX_PAGE = 10_000;

/** Which page to read: after `cursor`, else page `page`, else the first. */
export type PageRequest = { page?: number; cursor?: string | null };

type Start = { offset: number; total?: number };

/** Where the requested page of `limit` items starts, and the total when the cursor carries it. */
export function pageStart({ page = 1, cursor }: PageRequest, limit: number): Start {
	if (!cursor) return { offset: (page - 1) * limit };
	try {
		const { o, t } = JSON.parse(Buffer.from(cursor, 'base64url').toString()); // also reads standard base64
		if (Number.isSafeInteger(o) && o >= 0) return { offset: o, total: Number.isSafeInteger(t) ? t : undefined };
	} catch { /* fall through */ }
	throw new QueryError('the cursor is not valid', 'Pass next_cursor from the previous reply unchanged, or ask for a page by number.');
}

/** A reply's place in its list: `count` items from `start`, of `total`, `limit` to a page. */
export function pageInfo(start: Start, total: number, limit: number, count: number) {
	const next = start.offset + count;
	return {
		total,
		page: Math.floor(start.offset / limit) + 1,
		pages: Math.max(1, Math.ceil(total / limit)),
		next_cursor: count > 0 && next < total ? Buffer.from(JSON.stringify({ o: next, t: total })).toString('base64url') : null,
	};
}
