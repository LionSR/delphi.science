// POST /oauth/token: exchanges an authorization code (with its PKCE verifier) for an access token.
import { token } from '#lib/accounts/oauth.ts';
import { fields, oauthReply, preflight } from '#lib/api/oauth-http.ts';
import { db } from '#lib/db.ts';

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

export const POST = (req: Request) => oauthReply(async () => {
	const f = await fields(req);
	return token(await db(), { grant_type: text(f.grant_type), code: text(f.code), client_id: text(f.client_id),
		redirect_uri: text(f.redirect_uri), code_verifier: text(f.code_verifier), resource: text(f.resource) });
});
export const OPTIONS = preflight;
