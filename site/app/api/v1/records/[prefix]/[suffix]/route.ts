// GET /api/v1/records/<prefix>/<suffix>: one full record, with its score, reactions and counts (getRecord).
import { db } from '../../../../../../lib/db.ts';
import { operation } from '../../../../../../lib/operation.ts';
import { get, QueryError } from '../../../../../../lib/query.ts';
import { joinId } from '../../../../../../lib/view.ts';

export const GET = operation('getRecord', async ({ params }) => {
	const id = joinId(params);
	const rec = await get(await db(), id);
	if (!rec) throw new QueryError(`no record ${JSON.stringify(id)}`, 'Use an id from a search result, e.g. app/APP-260923-0000.');
	return Response.json(rec, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
});
