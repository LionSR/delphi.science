// GET /api/v1/stats?weeks=8: aggregate API usage, for administrators (usageStats).
import { db } from '../../../../lib/db.ts';
import { ApiError } from '../../../../lib/api/caller.ts';
import { operation } from '../../../../lib/api/operation.ts';
import { canReadUsage } from '../../../../lib/api/usage-admin.ts';
import { USAGE_NOTE, usage } from '../../../../lib/api/usage.ts';
import { PRIVATE } from '../../../../lib/api/cache.ts';

export const GET = operation('usageStats', async ({ query, voter }) => {
	if (!canReadUsage(voter)) throw new ApiError(403, 'admin_only', 'Usage statistics require an administrator.', 'Use a key owned by an account in ORI_STATS_ADMINS.');
	return Response.json({ ...(await usage(await db(), query.weeks)), note: USAGE_NOTE }, { headers: { ...PRIVATE, Vary: 'Authorization, Cookie' } });
});
