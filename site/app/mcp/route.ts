// POST /mcp: the index as a read-only MCP server (Streamable HTTP, stateless, no sign-in); see lib/mcp.ts.
//   claude mcp add --transport http open-research-index https://<host>/mcp
// There is no server-to-client stream and no session, so GET and DELETE answer 405, as the transport spec allows.
import { db } from '../../lib/db.ts';
import { handle } from '../../lib/mcp.ts';

// Reads need no key, so any page may call it.
const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
	'Access-Control-Expose-Headers': 'Mcp-Protocol-Version, Mcp-Session-Id',
};

export async function POST(req: Request) {
	const res = await handle(req, db);
	for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
	return res;
}

const notAllowed = () =>
	Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: POST JSON-RPC messages to this URL.' }, id: null },
		{ status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = () => new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
