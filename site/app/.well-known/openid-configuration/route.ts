// GET /.well-known/openid-configuration: the same authorization server metadata, for clients that look for it under
// OpenID Connect discovery's name. The site issues no ID tokens.
import { authorizationServer } from '#lib/accounts/oauth.ts';
import { metadata, preflight } from '#lib/api/oauth-http.ts';

export const GET = () => metadata(authorizationServer());
export const OPTIONS = preflight;
