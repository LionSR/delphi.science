// GET /api/v1/keys: the person's agent keys, as /keys lists them (listAgentKeys).
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/api/operation.ts';
import { agentKeys, sha256 } from '../../../../lib/accounts/keys.ts';

export const GET = operation('listAgentKeys', async ({ voter, req }) => {
	const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
	const current = token.startsWith('oik_') ? await sha256(token) : '';
	const keys = (await agentKeys(await db(), voter.login)).map((k) => ({ ...k, current: k.hash === current }));
	return Response.json({ keys }, { headers: { 'Cache-Control': 'private, no-store' } });
});
