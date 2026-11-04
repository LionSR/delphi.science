import { db } from '../../../../../lib/db.ts';
import { editPost } from '../../../../../lib/posts/edit.ts';
import { operation } from '../../../../../lib/api/operation.ts';

export const PATCH = operation('editPost', async ({ params, body, voter }) =>
	Response.json(await editPost(await db(), params.id, voter, body), { headers: { 'Cache-Control': 'private, no-store' } }));
