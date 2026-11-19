// POST /api/v1/keys/device {"agent": "Claude Code"}: start device authorization for an agent key (requestAgentKey).
import { attempt, origin } from '#lib/accounts/attempts.ts';
import { startDevice } from '#lib/accounts/device.ts';
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { SITE } from '#lib/view.ts';

export const POST = operation('requestAgentKey', async ({ body, req }) => {
	await attempt(await db(), 'device', origin(req.headers), 20, 10); // no account is needed to ask, so the caller is limited
	const d = await startDevice(await db(), body.agent);
	return Response.json({ ...d, verification_uri: `${SITE}/keys/approve`, verification_uri_complete: `${SITE}/keys/approve?code=${d.user_code}` }, { status: 201 });
});
