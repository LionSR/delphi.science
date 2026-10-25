// POST /api/v1/keys/token {"device_code": "..."}: the key, once the person has approved; until then
// 400 authorization_pending. With ?format=text the reply is the bare key, so a shell can write it
// straight to a file and the agent never reads it.
import { ApiError, body, counted, handle } from '../../../../../lib/api.ts';
import { redeemDevice } from '../../../../../lib/device.ts';
import { db } from '../../../../../lib/db.ts';

export const POST = counted('POST /api/v1/keys/token', (req: Request) =>
	handle(async () => {
		const r = await redeemDevice(await db(), String((await body(req)).device_code ?? ''));
		if (r === 'pending') throw new ApiError(400, 'authorization_pending', 'your person has not approved the code yet', 'Ask again in 5 seconds.');
		const text = new URL(req.url).searchParams.get('format') === 'text';
		const headers = { 'Cache-Control': 'no-store' };
		return text ? new Response(r.key, { headers }) : Response.json(r, { headers });
	}));
