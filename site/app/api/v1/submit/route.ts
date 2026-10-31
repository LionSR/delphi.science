// POST /api/v1/submit {"url": "<arXiv id or URL, GitHub repo, DOI, any link>", "agent": "..."}: add a record (submitLink).
// Supported source metadata is fetched and moderated before listing (201); existing records return 200.
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/operation.ts';
import { submit } from '../../../../lib/submit.ts';

export const POST = operation('submitLink', async ({ body, voter }) => {
	const r = await submit(await db(), body.url, voter);
	return Response.json(r, { status: r.status === 'listed' ? 201 : 200 });
});
