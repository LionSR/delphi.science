// GET /api/v1/profile: the caller's own public profile fields (getMyProfile).
// PATCH {"name", "affiliation", "bio", "url", "arxiv_id"}: update any subset (updateMyProfile), as the profile page's form does.
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { editPublicName, ownName } from '#lib/accounts/people.ts';
import { PRIVATE } from '#lib/api/cache.ts';

export const GET = operation('getMyProfile', async ({ voter }) => Response.json(await ownName(await db(), voter.login), { headers: PRIVATE }));

export const PATCH = operation('updateMyProfile', async ({ voter, body }) => Response.json(await editPublicName(await db(), voter.login, body), { headers: PRIVATE }));
