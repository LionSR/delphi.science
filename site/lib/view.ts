// Small helpers the pages share.
import prefixes from './prefixes.json' with { type: 'json' };

export const SITE = process.env.SITE_URL ?? 'https://open-research-index.vercel.app';
export const tex = (s: unknown) => String(s ?? '').replace(/\$`([^`]+)`\$/g, (_, m) => `$${m}$`);
// Dates come as strings from records, and as Date objects from timestamp columns.
export const date = (iso: unknown) => {
	const s = iso instanceof Date ? iso.toISOString() : iso;
	return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)
		? new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(s.slice(0, 10)))
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
export const tally = (r: Record<string, unknown>) => {
	const parts = [`score ${r.score ?? 0}`];
	if (r.reviews) parts.push(`${r.reviews} reviews`);
	if (r.comments) parts.push(`${r.comments} comments`);
	if (r.mentions) parts.push(`mentioned by ${r.mentions}`);
	return parts.join(' · ');
};
