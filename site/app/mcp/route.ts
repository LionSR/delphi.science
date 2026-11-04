// POST /mcp: read-only, stateless Streamable HTTP MCP server (lib/api/mcp.ts). Without sessions or a server stream,
// GET and DELETE answer 405, as the transport spec allows.
import { counted } from '../../lib/api/caller.ts';
import { db } from '../../lib/db.ts';
import { handle } from '../../lib/api/mcp.ts';

// Reads need no key, so any page may call it.
const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
	'Access-Control-Expose-Headers': 'Mcp-Protocol-Version, Mcp-Session-Id',
};

export const POST = counted('POST /mcp', async (req: Request) => {
	const res = await handle(req, db);
	for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
	return res;
});

const notAllowed = () =>
	Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: POST JSON-RPC messages to this URL.' }, id: null },
		{ status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = () => new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
