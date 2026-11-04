// GET /api/v1/profile: the caller's own public name and affiliation (getMyProfile).
// PATCH {"name", "affiliation"}: change either (updateMyProfile), as the profile page's form does.
import { db } from '../../../../lib/db.ts';
import { operation } from '../../../../lib/api/operation.ts';
import { editPublicName, ownName } from '../../../../lib/accounts/people.ts';

const noStore = { headers: { 'Cache-Control': 'private, no-store' } };

export const GET = operation('getMyProfile', async ({ voter }) => Response.json(await ownName(await db(), voter.login), noStore));

export const PATCH = operation('updateMyProfile', async ({ voter, body }) => Response.json(await editPublicName(await db(), voter.login, body), noStore));
