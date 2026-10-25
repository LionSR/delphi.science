// POST /api/v1/keys/device {"agent": "Claude Code"}: an agent asks for a key. Show user_code and
// verification_uri to your person; keep device_code to yourself and redeem it at /api/v1/keys/token.
import { body, counted, handle } from '../../../../../lib/api.ts';
import { startDevice } from '../../../../../lib/device.ts';
import { db } from '../../../../../lib/db.ts';
import { SITE } from '../../../../../lib/view.ts';

export const POST = counted('POST /api/v1/keys/device', (req: Request) =>
	handle(async () => {
		const d = await startDevice(await db(), String((await body(req)).agent ?? ''));
		return Response.json({ ...d, verification_uri: `${SITE}/keys/approve`, verification_uri_complete: `${SITE}/keys/approve?code=${d.user_code}` }, { status: 201 });
	}));
