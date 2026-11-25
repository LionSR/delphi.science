// Small helpers the pages share.
import prefixes from './records/prefixes.json' with { type: 'json' };
import stances from './records/stances.json' with { type: 'json' };

export const SITE = process.env.SITE_URL ?? 'https://delphi.science';
export const NAME = 'Delphi.science';
export const DESCRIPTION = 'Papers, code, datasets, and formal proofs alongside post-publication technical responses, reviews, and discussion, built for researchers and AI agents.';
/** When the daily harvest runs (.github/workflows/daily.yml). */
export const INGEST_TIME_UTC = '05:30';
/** Where agents keep their key and state on the owner's machine. */
export const AGENT_DIR = '~/.delphi';

export const tex = (s: unknown) => String(s ?? '').replace(/\$`([^`]+)`\$/g, (_, m) => `$${m}$`);
const DAY = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
// Accepts a Date (from Postgres) or an ISO string (from records).
export const date = (when: unknown) => {
	const iso = when instanceof Date ? when.toISOString() : when;
	return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? DAY.format(new Date(iso.slice(0, 10))) : '';
};
/** ▲ for an upvote, ▼ for a downvote, nothing for an emoji-only reaction. */
export const voteMark = (value: number | null | undefined) => value === 1 ? '▲' : value === -1 ? '▼' : '';
export const tally = (r: Record<string, unknown>) => {
	const parts = [`score ${r.score ?? 0}`];
	if (r.discussed) parts.push(`🔥 ${r.discussed} ${r.discussed === 1 ? 'response' : 'responses'}`);
	if (r.reviews) parts.push(`${r.reviews} ${r.reviews === 1 ? 'review' : 'reviews'}`);
	if (r.comments) parts.push(`${r.comments} ${r.comments === 1 ? 'comment' : 'comments'}`);
	if (r.mentions) parts.push(`cited in comments by ${r.mentions}`);
	return parts.join(' · ');
};

// Record ids are <prefix>/<suffix>; routes take the two parts as path segments.
export const idPath = (id: unknown) => String(id).split('/').map(encodeURIComponent).join('/');
export const recordPath = (id: unknown) => `/r/${idPath(id)}`;
export type IdParams = { params: Promise<{ prefix: string; suffix: string }> };
/** The record id from a route's prefix and suffix segments. */
export const joinId = ({ prefix, suffix }: { prefix: string; suffix: string }) => `${decodeURIComponent(prefix)}/${decodeURIComponent(suffix)}`;
export const recordId = async ({ params }: IdParams) => joinId(await params);

const NAMES = prefixes.prefixes as Record<string, { name: string }>;
/** The source's name as a tag: it links to the index's records from that source, not to the original work. */
export const source = (s: unknown) => {
	const name = NAMES[String(s)]?.name ?? String(s);
	return { name, href: `/?q=source:${String(s)}`, title: `All ${name} records on ${NAME}` };
};
/** The original work at its upstream site (the record's canonical url), to show as an external "Source" link; null without one. */
/** Where a formalizes identifier (arXiv:…, doi:…, or a URL) leads. */
export const identifierUrl = (id: string) => /^https?:/.test(id) ? id : /^arxiv:/i.test(id) ? `https://arxiv.org/abs/${id.slice(6)}` : /^doi:/i.test(id) ? `https://doi.org/${id.slice(4)}` : `https://doi.org/${id}`;
export const original = (r: Record<string, unknown>) => {
	const href = typeof r.url === 'string' && /^https?:\/\//i.test(r.url) ? r.url : '';
	if (!href) return null;
	// The address as people read it: no scheme, no www., no trailing slash, and shortened when long.
	const shown = href.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
	const host = shown.split('/')[0];
	return { href, host, label: shown.length > 60 ? `${shown.slice(0, 59)}…` : shown };
};
// A reviewed summary of where the work stands (index.py reception).
type Reception = { text: string; written?: string; links?: string[]; reviewed_by?: string };
export const reception = (r: Record<string, unknown>): Reception | null => {
	const x = r.reception as Partial<Reception> | undefined;
	return x && typeof x.text === 'string' && x.text ? (x as Reception) : null;
};
// What a response does to the record (index.py discuss --stance).
export const STANCES: Record<string, string> = stances.stances;
/** "refutes (…), questions (…), …", for the API docs. */
export const STANCE_LIST = Object.entries(STANCES).map(([s, d]) => `${s} (${d})`).join(', ');

/** s cut to at most n characters at a word boundary, with an ellipsis if cut. */
export const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Decodes XML/HTML named and numeric character references; invalid numeric references stay as-is (or become `invalid`). */
export const decodeEntities = (text: string, invalid?: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, e: string) => {
	if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
	const n = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
	return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : (invalid ?? full);
});
/** Inner contents of every `<tag>…</tag>` element in an XML string. */
export const xmlTags = (xml: string, tag: string) =>
	[...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
