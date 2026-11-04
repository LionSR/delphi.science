// GET /prompts.txt: the /prompts templates as plain text, for agents. Built once at deploy.
import { DOCUMENT } from '../../lib/api/cache.ts';
import { PROMPTS_TEXT } from '../../lib/prompts.ts';

export const dynamic = 'force-static';

export const GET = () => new Response(PROMPTS_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...DOCUMENT } });
