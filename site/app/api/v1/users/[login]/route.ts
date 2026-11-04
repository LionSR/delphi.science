// GET /api/v1/users/<login>: a person's public activity, as /u/<login> shows it (getUserActivity).
import { ApiError } from '../../../../../lib/api/caller.ts';
import { db } from '../../../../../lib/db.ts';
import { operation } from '../../../../../lib/api/operation.ts';
import { publicName } from '../../../../../lib/accounts/people.ts';
import { profile, ProfileUnavailable } from '../../../../../lib/accounts/profile.ts';

export const GET = operation('getUserActivity', async ({ params, query }) => {
	try {
		const d = await db();
		const page = await profile(d, params.login, { tab: query.tab, cursor: query.cursor, limit: query.limit });
		const { login, ...rest } = page;
		return Response.json({ login, ...await publicName(d, login), ...rest });
	} catch (e) {
		if (e instanceof ProfileUnavailable) throw new ApiError(503, 'unavailable', e.message, e.fix);
		throw e;
	}
});
