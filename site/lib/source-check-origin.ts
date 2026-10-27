import { SITE } from './view.ts';
import { SourceCheckError } from './post-feedback.ts';

/** Never trust Host/forwarded headers to expand the allowed origin set. */
export function requireSourceCheckOrigin(origin: string | null, required: boolean, site = SITE, deploymentHost = process.env.VERCEL_URL): void {
 const allowed = new Set([new URL(site).origin]);
 if (deploymentHost && /^[a-z0-9.-]+\.vercel\.app$/i.test(deploymentHost)) allowed.add(`https://${deploymentHost.toLowerCase()}`);
 if ((!origin && required) || (origin && !allowed.has(origin))) throw new SourceCheckError(403, 'same_origin_required', 'This source-check request needs an allowed same-origin context.', 'Open this record on the official site and explicitly check its public sources. API clients must use their own Bearer authorization; cookies do not authorize the API.');
}
