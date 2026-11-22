// GET /api/v1/users/<login>: a person's public activity, as /u/<login> shows it (getUserActivity).
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { connectedAgentCount } from '#lib/accounts/keys.ts';
import { publicProfile } from '#lib/accounts/people.ts';
import { profile } from '#lib/accounts/profile.ts';

export const GET = operation('getUserActivity', async ({ params, query }) => {
	const d = await db();
	const { login, ...rest } = await profile(d, params.login, query);
	const [who, connected_agents] = await Promise.all([publicProfile(d, login), connectedAgentCount(d, login)]);
	return Response.json({ login, ...who, connected_agents, ...rest });
});
