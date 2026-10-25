// GET /api/v1/stats?weeks=8: how the API is used, in aggregate. Calls per week (and by AI clients
// alone), the top endpoints and the top clients, named from the user agent (lib/usage.ts).
import { counted } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { USAGE_NOTE, usage } from '../../../../lib/usage.ts';

export const GET = counted('GET /api/v1/stats', async (req: Request) => {
	const weeks = Math.min(26, Math.max(1, Math.trunc(Number(new URL(req.url).searchParams.get('weeks'))) || 8));
	return Response.json({ ...(await usage(await db(), weeks)), note: USAGE_NOTE }, { headers: { 'Cache-Control': 'public, s-maxage=300' } });
});
