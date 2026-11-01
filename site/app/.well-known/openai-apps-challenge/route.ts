// GET /.well-known/openai-apps-challenge: OpenAI's domain-verification token, from OPENAI_APPS_CHALLENGE (404 if unset).
export const dynamic = 'force-dynamic';

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

export function GET() {
	const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
	if (!token) return new Response('Not found\n', { status: 404, headers: TEXT });
	return new Response(token, { headers: { ...TEXT, 'Cache-Control': 'no-store' } });
}
