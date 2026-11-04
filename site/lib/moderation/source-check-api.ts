import { db } from '../db.ts';
import { operation } from '../api/operation.ts';
import { joinId } from '../view.ts';
import { requireSourceCheckOrigin } from './source-check-origin.ts';
import { checkPublicSources, type SourceRetriever } from './source-checks.ts';

/** `retrieve` is injectable for tests; the request body carries only URLs. */
export const sourceCheckOperation = (retrieve?: SourceRetriever) => operation('checkPublicSources', async ({ params, body, voter, req }) => {
  requireSourceCheckOrigin(req.headers.get('origin'), false);
  const batch = await checkPublicSources(await db(), voter, joinId(params), body.urls, retrieve);
  return Response.json(batch, { headers: { 'Cache-Control': 'private, no-store' } });
});
