// GET /id/<prefix>/<suffix>: redirects to the record's source, or returns the record for Accept: application/json.
import { counted, handle } from '../../../../lib/api/caller.ts';
import { db } from '../../../../lib/db.ts';
import { get } from '../../../../lib/records/query.ts';
import { NotFoundError } from '../../../../lib/errors.ts';
import { recordId, type IdParams } from '../../../../lib/view.ts';

export const GET = counted('GET /id/{prefix}/{suffix}', (req: Request, ctx: IdParams) =>
	handle(async () => {
		const id = await recordId(ctx);
		const rec = await get(await db(), id);
		if (!rec) throw new NotFoundError(`no record ${JSON.stringify(id)}`, 'Check the id, or search for it at /api/v1/search.');
		if (req.headers.get('accept')?.includes('application/json')) return Response.json(rec, { headers: { Vary: 'Accept' } });
		return new Response(null, { status: 302, headers: { Location: String(rec.url), Vary: 'Accept' } });
	}));
