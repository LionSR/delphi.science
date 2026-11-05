// Paging, one way for every list the website, the API and the MCP tools serve, declared here as schema. Each list has a
// page size (pageSize); a request gives a limit and asks for a page by number or passes the cursor from the previous
// reply (pageParameters); every reply says where it sits in its list (PAGING). lib/api/openapi.ts builds its list
// operations from these, the MCP tools read them from there, and the website's pager (lib/pager.ts) reads the same
// replies. A cursor carries where the next page starts and the total, so later pages skip the count.
import { QueryError } from './errors.ts';
import type { FromSchema } from './api/schema.ts';

/** The highest page number a request may ask for. */
export const MAX_PAGE = 10_000;

/** How to page, as a clause for guides ("To finish a scan, …"). */
export const PAGING_HELP = 'ask for page=<n>, up to the reply\'s pages, or pass next_cursor back unchanged.';

/** A list's page size: `items` per page, from 1 to `max`, `fallback` when a request gives no limit. */
export type PageSize = { items: string; max: number; fallback: number };
export const pageSize = (items: string, max: number, fallback: number): PageSize => ({ items, max, fallback });

/** The request side of a list with page size `size`, as OpenAPI query parameters: limit, page and cursor. */
export const pageParameters = ({ items, max, fallback }: PageSize) => [
	{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: max, default: fallback }, description: `${items} per page, from 1 to ${max}; ${fallback} if left out.` },
	{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE, default: 1 }, description: `Page number, from 1 to ${MAX_PAGE}, of limit items each; pages in the reply says how many there are. Ignored when cursor is given.` },
	{ name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'next_cursor from the previous reply, unchanged.' },
] as const;

/** The reply side, as JSON Schema: the fields every paged reply carries. */
export const PAGING = { type: 'object', required: ['total', 'page', 'pages', 'next_cursor'], properties: {
	total: { type: 'integer', description: 'How many items match.' },
	page: { type: 'integer', description: 'This page\'s number, from 1.' },
	pages: { type: 'integer', description: 'How many pages of limit items there are (at least 1).' },
	next_cursor: { type: ['string', 'null'], description: 'Pass as cursor for the next page; null on the last.' },
} } as const;
export type Paging = FromSchema<typeof PAGING>;

type PageParameter = ReturnType<typeof pageParameters>[number];
/** Which page to read, and how long, typed by the parameters' schemas: after `cursor` (a reply's next_cursor, as it
 * is), else page `page`, else the first; `limit` items. */
export type PageRequest = { [P in Exclude<PageParameter, { name: 'cursor' }> as P['name']]?: FromSchema<P['schema']> } & { cursor?: Paging['next_cursor'] };

type Start = { offset: number; limit: number; total?: number };

const whole = (n: number, max: number) => Number.isSafeInteger(n) && n >= 1 && n <= max;

/** A request's limit, checked against the list's page size (as the API's schema checks it). */
export function pageLimit(limit: number | undefined, size: PageSize): number {
	const n = limit ?? size.fallback;
	if (!whole(n, size.max)) throw new QueryError(`limit must be from 1 to ${size.max}`, `Send limit: ${size.items} per page, from 1 to ${size.max}; ${size.fallback} if left out.`);
	return n;
}

/** Where the requested page starts, how long it is, and the total when the cursor carries it. */
export function pageStart({ limit: asked, page = 1, cursor }: PageRequest, size: PageSize): Start {
	const limit = pageLimit(asked, size);
	if (!cursor) {
		if (!whole(page, MAX_PAGE)) throw new QueryError(`page must be from 1 to ${MAX_PAGE}`, `Send page: a whole number from 1 to ${MAX_PAGE}.`);
		return { offset: (page - 1) * limit, limit };
	}
	try {
		const { o, t } = JSON.parse(Buffer.from(cursor, 'base64url').toString()); // also reads standard base64
		if (Number.isSafeInteger(o) && o >= 0) return { offset: o, limit, total: Number.isSafeInteger(t) ? t : undefined };
	} catch { /* fall through */ }
	throw new QueryError('the cursor is not valid', 'Pass next_cursor from the previous reply unchanged, or ask for a page by number.');
}

/** A reply's place in its list: `count` items from `start`, of `total`. */
export function pageInfo({ offset, limit }: Start, total: number, count: number): Paging {
	const next = offset + count;
	return {
		total,
		page: Math.floor(offset / limit) + 1,
		pages: Math.max(1, Math.ceil(total / limit)),
		next_cursor: count > 0 && next < total ? Buffer.from(JSON.stringify({ o: next, t: total })).toString('base64url') : null,
	};
}
