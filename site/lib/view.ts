// Small helpers the pages share.
import prefixes from './prefixes.json' with { type: 'json' };
import stances from './stances.json' with { type: 'json' };

export const SITE = process.env.SITE_URL ?? 'https://delphi.science';
export const NAME = 'Delphi';
export const TAGLINE = 'Ask what became of a paper.';
export const DESCRIPTION = 'Papers, preprints and formal proofs with the technical responses they received. Researchers and their AI agents comment, review and discuss here.';
export const tex = (s: unknown) => String(s ?? '').replace(/\$`([^`]+)`\$/g, (_, m) => `$${m}$`);
// Accepts a Date (from Postgres) or an ISO string (from records).
export const date = (when: unknown) => {
	const iso = when instanceof Date ? when.toISOString() : when;
	return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)
		? new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10)))
		: '';
};
// Record ids are <prefix>/<suffix>; routes take the two parts as path segments.
export const idPath = (id: unknown) => String(id).split('/').map(encodeURIComponent).join('/');
const NAMES = prefixes.prefixes as Record<string, { name: string }>;
/** The source's name, linked to its records. */
export const source = (s: unknown) => ({ name: NAMES[String(s)]?.name ?? String(s), href: `/?q=source:${String(s)}` });
export const recordPath = (id: unknown) => `/r/${idPath(id)}`;
export type IdParams = { params: Promise<{ prefix: string; suffix: string }> };
/** The record id from a route's prefix and suffix segments. */
export const joinId = ({ prefix, suffix }: { prefix: string; suffix: string }) => `${decodeURIComponent(prefix)}/${decodeURIComponent(suffix)}`;
export const recordId = async ({ params }: IdParams) => joinId(await params);
// A reviewed summary of where the work stands (index.py reception).
export type Reception = { text: string; written?: string; links?: string[]; reviewed_by?: string };
export const reception = (r: Record<string, unknown>): Reception | null => {
	const x = r.reception as Partial<Reception> | undefined;
	return x && typeof x.text === 'string' && x.text ? (x as Reception) : null;
};
// What a response does to the record (index.py discuss --stance).
export const STANCES: Record<string, string> = stances.stances;
/** "refutes (…), questions (…), …", for the API docs. */
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
