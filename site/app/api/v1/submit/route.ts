// POST /api/v1/submit {"url": "..."}: add a record (submitLink). 201 when listed, 200 if it already exists.
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/api/operation.ts';
import { submit } from '../../../../lib/records/submit.ts';

export const POST = operation('submitLink', async ({ body, voter }) => {
	const r = await submit(await db(), body.url, voter);
	return Response.json(r, { status: r.status === 'listed' ? 201 : 200 });
});
