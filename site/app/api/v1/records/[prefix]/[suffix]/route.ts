// GET /api/v1/records/<prefix>/<suffix>: one full record, with its score, reactions and counts (getRecord).
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { get } from '#lib/records/query.ts';
import { NotFoundError } from '#lib/errors.ts';
import { idPath, joinId } from '#lib/view.ts';
import { RECORDS } from '#lib/api/cache.ts';

export const GET = operation('getRecord', async ({ params }) => {
	const id = joinId(params);
	const rec = await get(await db(), id);
	if (!rec) throw new NotFoundError(`no record ${JSON.stringify(id)}`, 'Use an id from a search result, e.g. app/APP-260923-0000.');
	if (rec.id !== id) return new Response(null, { status: 308, headers: { Location: `/api/v1/records/${idPath(rec.id)}` } });
	return Response.json(rec, { headers: RECORDS });
});
