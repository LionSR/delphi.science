// GET /api/v1/stats?weeks=8: how the API is used, in aggregate (usageStats in lib/openapi.ts). Calls per week (and
// by AI clients alone), the top endpoints and the top clients, named from the user agent (lib/usage.ts).
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/operation.ts';
import { USAGE_NOTE, usage } from '../../../../lib/usage.ts';

export const GET = operation('usageStats', async ({ query }) =>
	Response.json({ ...(await usage(await db(), query.weeks)), note: USAGE_NOTE }, { headers: { 'Cache-Control': 'public, s-maxage=300' } }));
