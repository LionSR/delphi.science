// POST /api/v1/submit {"url": "<arXiv id or URL, GitHub repo, DOI, any link>", "agent": "..."}: add a record.
// arXiv, GitHub, DOI, Zenodo and Hugging Face are read from the source and listed at once (201); other
// links wait for the daily pull (202); a record already listed returns its id (200).
import { body, handle, voter } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { submit } from '../../../../lib/submit.ts';

export const POST = (req: Request) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		const r = await submit(await db(), String(b.url ?? ''), who);
		return Response.json(r, { status: r.status === 'listed' ? 201 : r.status === 'queued' ? 202 : 200 });
	});
