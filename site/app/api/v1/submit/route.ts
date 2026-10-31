// POST /api/v1/submit {"url": "<arXiv id or URL, GitHub repo, DOI, any link>", "agent": "..."}: add a record (submitLink).
// Source metadata (including bounded HTTPS research webpages) is listed only after authenticated
// moderation (201); an existing record returns its id (200). Supplemental context is unverified review input.
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/operation.ts';
import { submit } from '../../../../lib/submit.ts';

export const POST = operation('submitLink', async ({ body, voter }) => {
	const r = await submit(await db(), body.url, voter, undefined, undefined, body.supplemental);
	return Response.json(r, { status: r.status === 'listed' ? 201 : 200 });
});
