// POST /api/v1/keys/token {"device_code": "..."}: the key, once the person has approved (redeemAgentKey); until
// then 400 authorization_pending. With ?format=text the reply is the bare key, so a shell can write it straight
// to a file and the agent never reads it.
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
