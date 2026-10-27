import { db } from './db.ts';
import { operation } from './operation.ts';
import { joinId } from './view.ts';
import { requireSourceCheckOrigin } from './source-check-origin.ts';
import { checkPublicSources, type SourceRetriever } from './public-source-checks.ts';

/** Dependency injection is server/test-only; request bodies accept URLs and no verification results. */
export const sourceCheckOperation=(retrieve?:SourceRetriever)=>operation('checkPublicSources',async({params,body,voter,req})=>{
 requireSourceCheckOrigin(req.headers.get('origin'),false);
 return Response.json(await checkPublicSources(await db(),voter,joinId(params),body.urls,retrieve),{headers:{'Cache-Control':'private, no-store'}});
});
