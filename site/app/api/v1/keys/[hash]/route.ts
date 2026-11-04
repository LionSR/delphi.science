// DELETE /api/v1/keys/<hash>: revoke one of the person's agent keys, as /keys does (revokeAgentKey).
import { ApiError } from '../../../../../lib/api/caller.ts';
import { db } from '../../../../../lib/db.ts';
import { operation } from '../../../../../lib/api/operation.ts';
import { revokeAgentKey } from '../../../../../lib/accounts/keys.ts';
import { PRIVATE } from '../../../../../lib/api/cache.ts';

export const DELETE = operation('revokeAgentKey', async ({ params, voter }) => {
	if (!await revokeAgentKey(await db(), voter.login, params.hash)) throw new ApiError(404, 'not_found', 'no active agent key of yours has this hash', 'Use a hash from GET /api/v1/keys whose revoked_at is null.');
	return Response.json({ revoked: params.hash }, { headers: PRIVATE });
});
