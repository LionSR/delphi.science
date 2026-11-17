// DELETE /api/v1/ws/<slug>/members/<login>: take a person off a private space (removeSpaceMember). The creator removes
// a member or withdraws an invitation; anyone removes themselves. A caller who cannot read the space, and is not the
// person named, gets the same not-found as for a slug that names nothing.
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { PRIVATE } from '#lib/api/cache.ts';
import { removeMember } from '#lib/posts/spaces.ts';

export const DELETE = operation('removeSpaceMember', async ({ params, voter }) => {
	const gone = await removeMember(await db(), params.slug, voter, params.login);
	return Response.json({ removed: `ws/${gone.id}/members/${gone.login}` }, { headers: PRIVATE });
});
