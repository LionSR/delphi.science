// GET /api/v1/records/<id>: one full record, with its score, reactions and counts.
import { handle } from '../../../../../lib/api.ts';
import { db } from '../../../../../lib/db.ts';
import { get, QueryError } from '../../../../../lib/query.ts';

export const GET = (_req: Request, { params }: { params: Promise<{ id: string }> }) =>
	handle(async () => {
		const id = decodeURIComponent((await params).id);
		const rec = await get(await db(), id);
		if (!rec) throw new QueryError(`no record ${JSON.stringify(id)}`, 'Use an id from a search result, e.g. app:APP-260923-0000.');
		return Response.json(rec, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
	});
