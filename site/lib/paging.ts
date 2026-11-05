// Paging, one way for every list the website, the API and the MCP tools serve, declared here as schema: a request asks
// for a page by number (from 1) or passes the cursor from the previous reply (PAGE_PARAMETERS, limitParameter); every
// reply says where it sits in its list (PAGING). lib/api/openapi.ts builds its list operations from these, the MCP
// tools read them from there, and the website's pager (lib/pager.ts) reads the same replies. A cursor carries where the
// next page starts and the total, so later pages skip the count.
import { QueryError } from './errors.ts';
import type { FromSchema } from './api/schema.ts';

/** The highest page number a request may ask for. */
export const MAX_PAGE = 10_000;

/** The request side, as OpenAPI query parameters. */
export const PAGE_PARAMETERS = [
	{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE, default: 1 }, description: `Page number, from 1 to ${MAX_PAGE}, of limit items each; pages in the reply says how many there are. Ignored when cursor is given.` },
	{ name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'next_cursor from the previous reply, unchanged.' },
] as const;

/** A list's page size, as an OpenAPI query parameter: `items` per page, from 1 to `max`, `fallback` when left out. */
export const limitParameter = <Max extends number, Fallback extends number>(items: string, max: Max, fallback: Fallback) => ({
	name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: max, default: fallback }, description: `${items} per page, from 1 to ${max}; ${fallback} if left out.`,
}) as const;

/** The reply side, as JSON Schema: the fields every paged reply carries. */
export const PAGING = { type: 'object', required: ['total', 'page', 'pages', 'next_cursor'], properties: {
	total: { type: 'integer', description: 'How many items match.' },
	page: { type: 'integer', description: 'This page\'s number, from 1.' },
	pages: { type: 'integer', description: 'How many pages of limit items there are (at least 1).' },
	next_cursor: { type: ['string', 'null'], description: 'Pass as cursor for the next page; null on the last.' },
} } as const;
export type Paging = FromSchema<typeof PAGING>;

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
export function pageInfo(start: Start, total: number, limit: number, count: number): Paging {
	const next = start.offset + count;
	return {
		total,
		page: Math.floor(start.offset / limit) + 1,
		pages: Math.max(1, Math.ceil(total / limit)),
		next_cursor: count > 0 && next < total ? Buffer.from(JSON.stringify({ o: next, t: total })).toString('base64url') : null,
	};
}
