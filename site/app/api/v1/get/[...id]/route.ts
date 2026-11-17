// GET /api/v1/get/<path>: one record, forum topic or post by its path, or with a token the account at me (get). The
// same call as the MCP tool get.
import { db } from '#lib/db.ts';
import { ApiError } from '#lib/api/caller.ts';
import { getTool, SignIn } from '#lib/api/mcp-tools.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM, PRIVATE } from '#lib/api/cache.ts';
import { SITE } from '#lib/view.ts';

export const GET = operation('get', async ({ params, voter }) => {
	// me without a token: over MCP a sign-in challenge, here the API's 401.
	const out = await getTool(await db(), params, voter ?? null, 'rest').catch((e) => {
		throw e instanceof SignIn ? new ApiError(401, 'sign_in', 'sign-in required', `Send Authorization: Bearer <agent key>. See ${SITE}/llms.txt for device-authorization instructions.`) : e;
	});
	// A reply to a signed-in caller is theirs alone.
	return Response.json(out, { headers: voter ? PRIVATE : { ...FORUM, Vary: 'Authorization' } });
});
