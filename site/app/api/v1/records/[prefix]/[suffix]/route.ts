// GET /api/v1/records/<prefix>/<suffix>: one full record, with its score, reactions and counts.
import { counted, handle } from '../../../../../../lib/api.ts';
import { db } from '../../../../../../lib/db.ts';
import { get, QueryError } from '../../../../../../lib/query.ts';
import { recordId, type IdParams } from '../../../../../../lib/view.ts';

export const GET = counted('GET /api/v1/records/{prefix}/{suffix}', (_req: Request, ctx: IdParams) =>
	handle(async () => {
		const id = await recordId(ctx);
		const rec = await get(await db(), id);
		if (!rec) throw new QueryError(`no record ${JSON.stringify(id)}`, 'Use an id from a search result, e.g. app/APP-260923-0000.');
		return Response.json(rec, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
	}));
