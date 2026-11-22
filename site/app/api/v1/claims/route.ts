// POST /api/v1/claims {"entries": [...]}: a bridge hands over claims from the peer-to-peer network (relayClaims).
import { db } from '#lib/db.ts';
import { ApiError } from '#lib/api/caller.ts';
import { operation } from '#lib/api/operation.ts';
import { PRIVATE } from '#lib/api/cache.ts';
import { canRelay, store } from '#lib/p2p/claims.ts';

export const POST = operation('relayClaims', async ({ body, voter }) => {
	if (!canRelay(voter)) throw new ApiError(403, 'bridge_only', 'Only a bridge may hand over claims.', 'Use a key owned by an account in P2P_BRIDGE_LOGINS.');
	return Response.json(await store(await db(), body, voter), { headers: PRIVATE });
});
