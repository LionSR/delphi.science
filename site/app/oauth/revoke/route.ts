// POST /oauth/revoke: token revocation (RFC 7009). The access token stops working; the reply is 200 either way.
import { revoke } from '#lib/accounts/oauth.ts';
import { fields, oauthReply, preflight } from '#lib/api/oauth-http.ts';
import { db } from '#lib/db.ts';

export const POST = (req: Request) => oauthReply(async () => {
	await revoke(await db(), (await fields(req)).token);
	return {};
});
export const OPTIONS = preflight;
