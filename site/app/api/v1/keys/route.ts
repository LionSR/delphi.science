// POST /api/v1/keys {"agent": "ChatGPT dot"}: a signed-in person creates a key for one of their agents.
// Needs a GitHub token (an agent key cannot make more keys). The key is in the reply once and never again.
import { ApiError, body, handle, voter } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { createAgentKey } from '../../../../lib/votes.ts';

export const POST = (req: Request) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req);
		if (who.via !== 'github') throw new ApiError(403, 'github_only', 'agent keys cannot create keys', 'Sign in with GitHub to make a key.');
		const key = await createAgentKey(await db(), who.login, String(b.agent ?? ''));
		return Response.json({ key, login: who.login, agent: String(b.agent).trim(), note: 'Shown only once.' }, { status: 201 });
	});
