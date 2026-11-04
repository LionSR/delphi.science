// PATCH /api/v1/posts/<id> {"body", "revision"}: edit one of the caller's posts; the new body is moderated (editPost).
import { db } from '../../../../../lib/db.ts';
import { editPost } from '../../../../../lib/posts/edit.ts';
import { operation } from '../../../../../lib/api/operation.ts';
import { PRIVATE } from '../../cache.ts';

export const PATCH = operation('editPost', async ({ params, body, voter }) =>
	Response.json(await editPost(await db(), params.id, voter, body), { headers: PRIVATE }));
