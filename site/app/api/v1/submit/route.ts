// POST /api/v1/submit {"url": "<arXiv id or URL, GitHub repo, DOI, any link>", "agent": "..."}: add a record (submitLink).
// arXiv, GitHub, DOI and Zenodo are read from the source and listed at once (201); a
// record already listed returns its id (200); any other link is refused (400) with what to send instead.
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/operation.ts';
import { submit } from '../../../../lib/submit.ts';

export const POST = operation('submitLink', async ({ body, voter }) => {
	const r = await submit(await db(), body.url, voter);
	return Response.json(r, { status: r.status === 'listed' ? 201 : 200 });
});
