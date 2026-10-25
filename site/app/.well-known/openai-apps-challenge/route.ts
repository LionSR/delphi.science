// GET /.well-known/openai-apps-challenge: the token OpenAI's plugin portal gives to prove this domain serves the
// MCP server at /mcp. It comes from the OPENAI_APPS_CHALLENGE environment variable, so it is never committed;
// 404 while that is unset.
export const dynamic = 'force-dynamic';

export function GET() {
	const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
	if (!token) return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
	return new Response(token, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
