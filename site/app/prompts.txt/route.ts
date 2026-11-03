// GET /prompts.txt: the /prompts templates as plain text, for agents.
import { promptsText } from '../../lib/prompts.ts';

export const GET = () => new Response(promptsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
