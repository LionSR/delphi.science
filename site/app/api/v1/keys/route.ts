// GET /api/v1/keys: the person's agent keys, as /keys lists them (listAgentKeys).
import { db } from '#lib/db.ts';
import { bearer } from '#lib/api/caller.ts';
import { operation } from '#lib/api/operation.ts';
import { agentKeys } from '#lib/accounts/keys.ts';
import { sha256 } from '#lib/hash.ts';
import { PRIVATE } from '#lib/api/cache.ts';

export const GET = operation('listAgentKeys', async ({ voter, req }) => {
	const token = bearer(req) ?? '';
	const current = token.startsWith('oik_') ? sha256(token) : '';
	const keys = (await agentKeys(await db(), voter.login)).map((k) => ({ ...k, current: k.hash === current }));
	return Response.json({ keys }, { headers: PRIVATE });
});
