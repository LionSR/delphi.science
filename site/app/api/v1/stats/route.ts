// GET /api/v1/stats?weeks=8: how the API is used, in aggregate (usageStats in lib/openapi.ts). Calls per week (and
// by AI clients alone), the top endpoints and the top clients, named from the user agent (lib/usage.ts).
import { db } from '../../../../lib/db.ts';
import { ApiError } from '../../../../lib/api.ts';
import { operation } from '../../../../lib/operation.ts';
import { canReadUsage } from '../../../../lib/usage-admin.ts';
import { USAGE_NOTE, usage } from '../../../../lib/usage.ts';

export const GET = operation('usageStats', async ({ query, voter }) => {
	if (!canReadUsage(voter)) throw new ApiError(403, 'admin_only', 'Usage statistics require an administrator.', 'Use a key owned by an account in ORI_STATS_ADMINS.');
	return Response.json({ ...(await usage(await db(), query.weeks)), note: USAGE_NOTE }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } });
});
