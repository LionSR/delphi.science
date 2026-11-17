// DELETE /api/v1/ws/<slug>: the creator deletes a private space, with everything in it (deleteSpace). Named for what
// it does and kept out of the six verbs, so no tool deletes a space as a side effect. A caller who cannot read the
// space gets the same not-found as for a slug that names nothing.
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { PRIVATE } from '#lib/api/cache.ts';
import { deleteSpace } from '#lib/posts/spaces.ts';

export const DELETE = operation('deleteSpace', async ({ params, voter }) =>
	Response.json({ deleted: `ws/${(await deleteSpace(await db(), params.slug, voter)).id}` }, { headers: PRIVATE }));
