// GET /api/v1/users/<login>: a person's public activity, as /u/<login> shows it (getUserActivity).
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { publicName } from '#lib/accounts/people.ts';
import { profile } from '#lib/accounts/profile.ts';

export const GET = operation('getUserActivity', async ({ params, query }) => {
	const d = await db();
	const { login, ...rest } = await profile(d, params.login, { tab: query.tab, cursor: query.cursor, limit: query.limit });
	return Response.json({ login, ...await publicName(d, login), ...rest });
});
