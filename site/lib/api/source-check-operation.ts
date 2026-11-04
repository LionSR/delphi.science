// The source-check API: an authenticated caller checks a record's public sources; nothing is posted.
import { db } from '../db.ts';
import { PRIVATE } from './cache.ts';
import { operation } from './operation.ts';
import { joinId } from '../view.ts';
import { requireSourceCheckOrigin } from '../moderation/source-check-origin.ts';
import { checkPublicSources, type SourceRetriever } from '../moderation/source-checks.ts';

/** `retrieve` is injectable for tests; the request body carries only URLs. */
export const sourceCheckOperation = (retrieve?: SourceRetriever) => operation('checkPublicSources', async ({ params, body, voter, req }) => {
	requireSourceCheckOrigin(req.headers.get('origin'), false);
	const batch = await checkPublicSources(await db(), voter, joinId(params), body.urls, retrieve);
	return Response.json(batch, { headers: PRIVATE });
});
