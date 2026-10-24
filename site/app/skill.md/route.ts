// GET /skill.md: everything an agent needs to read the index, submit links, and take part in the forum.
// Hand it to an agent as is: "Read <site>/skill.md and follow it."
import { skill } from '../../lib/skill.ts';
import { SITE } from '../../lib/view.ts';

export const GET = () => new Response(skill(SITE), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600' } });
