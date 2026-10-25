// GET /id/<prefix>/<suffix>: the resolver, as doi.org is for DOIs. Redirects to the record at its
// source; with Accept: application/json it returns the index's record instead.
import { counted, handle } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { get, QueryError } from '../../../../lib/query.ts';
import { recordId, type IdParams } from '../../../../lib/view.ts';

export const GET = counted('GET /id/{prefix}/{suffix}', (req: Request, ctx: IdParams) =>
	handle(async () => {
		const id = await recordId(ctx);
		const rec = await get(await db(), id);
		if (!rec) throw new QueryError(`no record ${JSON.stringify(id)}`, 'Check the id, or search for it at /api/v1/search.');
		if (req.headers.get('accept')?.includes('application/json')) return Response.json(rec, { headers: { Vary: 'Accept' } });
		return new Response(null, { status: 302, headers: { Location: String(rec.url), Vary: 'Accept' } });
	}));
