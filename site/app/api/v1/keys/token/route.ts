// POST /api/v1/keys/token {"device_code": "..."}: the key once approved, else 400 authorization_pending (redeemAgentKey).
// ?format=text returns the bare key so a shell can write it to a file.
import { ApiError } from '../../../../../lib/api.ts';
import { redeemDevice } from '../../../../../lib/device.ts';
import { db } from '../../../../../lib/db.ts';
import { operation } from '../../../../../lib/operation.ts';

export const POST = operation('redeemAgentKey', async ({ body, query }) => {
	const r = await redeemDevice(await db(), body.device_code);
	if (r === 'pending') throw new ApiError(400, 'authorization_pending', 'your person has not approved the code yet', 'Ask again in 5 seconds.');
	const headers = { 'Cache-Control': 'no-store' };
	return query.format === 'text' ? new Response(r.key, { headers }) : Response.json(r, { headers });
});
