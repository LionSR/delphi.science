// Small helpers the pages share.
import prefixes from './prefixes.json' with { type: 'json' };

export const SITE = process.env.SITE_URL ?? 'https://open-research-index.vercel.app';
export const tex = (s: unknown) => String(s ?? '').replace(/\$`([^`]+)`\$/g, (_, m) => `$${m}$`);
// Postgres returns timestamps as Date objects, records carry them as ISO strings.
export const date = (when: unknown) => {
	const iso = when instanceof Date ? when.toISOString() : when;
	return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)
		? new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10)))
		: '';
};
// Record ids are <prefix>/<suffix>, like a DOI; routes take the two parts as path segments.
export const idPath = (id: unknown) => String(id).split('/').map(encodeURIComponent).join('/');
const NAMES = prefixes.prefixes as Record<string, { name: string }>;
/** The source's name, linked to its records. */
export const source = (s: unknown) => ({ name: NAMES[String(s)]?.name ?? String(s), href: `/?q=source:${String(s)}` });
export const recordPath = (id: unknown) => `/r/${idPath(id)}`;
export type IdParams = { params: Promise<{ prefix: string; suffix: string }> };
export const recordId = async ({ params }: IdParams) => {
	const { prefix, suffix } = await params;
	return `${decodeURIComponent(prefix)}/${decodeURIComponent(suffix)}`;
};
// Where the work stands, in a sentence or two a person reviewed (index.py reception); the build serves only reviewed ones.
export type Reception = { text: string; written?: string; links?: string[]; reviewed_by?: string };
export const reception = (r: Record<string, unknown>): Reception | null => {
	const x = r.reception as Partial<Reception> | undefined;
	return x && typeof x.text === 'string' && x.text ? (x as Reception) : null;
};
// What a response does to the record, set by a person (index.py discuss --stance): the record page's tooltips,
// and discussion[].stance in /api/v1 and its OpenAPI document.
export const STANCES: Record<string, string> = {
	refutes: 'finds an error that breaks the main result', questions: 'a gap, a Lean/prose mismatch, a weaker statement than claimed, or priority',
	confirms: 'checks or formalizes it independently', simplifies: 'a shorter or human-readable proof', extends: 'builds on it', reacts: 'no technical claim',
};
/** The stances with their meanings, for the API docs: "refutes (…), questions (…), …". */
export const STANCE_LIST = Object.entries(STANCES).map(([s, d]) => `${s} (${d})`).join(', ');
export const tally = (r: Record<string, unknown>) => {
	const parts = [`score ${r.score ?? 0}`];
	if (r.discussed) parts.push(`🔥 ${r.discussed} ${r.discussed === 1 ? 'post' : 'posts'}`);
	if (r.disputed) parts.push('disputed');
	if (r.reviews) parts.push(`${r.reviews} reviews`);
	if (r.comments) parts.push(`${r.comments} comments`);
	if (r.mentions) parts.push(`cited in comments by ${r.mentions}`);
	return parts.join(' · ');
};
