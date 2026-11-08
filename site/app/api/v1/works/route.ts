import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { canonicalWork } from '#lib/records/query.ts';
import { NotFoundError } from '#lib/errors.ts';
import { RECORDS } from '#lib/api/cache.ts';
export const GET = operation('getWork',async({query})=>{
	const work=await canonicalWork(await db(),query.id);
	if (!work) throw new NotFoundError(`no work ${JSON.stringify(query.id)}`,'Use a work_id returned by search or a source record.');
	return Response.json(work,{headers:RECORDS});
});
