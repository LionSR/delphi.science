// GET /api/v1/users/<login>: a person's public activity, as /u/<login> shows it (getUserActivity).
import { ApiError } from '../../../../../lib/api.ts';
import { db } from '../../../../../lib/db.ts';
import { operation } from '../../../../../lib/operation.ts';
import { profile, ProfileUnavailable } from '../../../../../lib/profile.ts';

export const GET = operation('getUserActivity', async ({ params, query }) => {
	try {
		return Response.json(await profile(await db(), params.login, { tab: query.tab, cursor: query.cursor, limit: query.limit }));
	} catch (e) {
		if (e instanceof ProfileUnavailable) throw new ApiError(503, 'unavailable', e.message, e.fix);
		throw e;
	}
});
