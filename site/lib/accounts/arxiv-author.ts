// arXiv public author identifiers, ORCID links, and public paper feeds (https://arxiv.org/a/<id>.atom2).
// Identifiers are validated against strict formats before building any outbound arXiv URL.
import type { Db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { decodeEntities, recordPath, xmlTags } from '#lib/view.ts';

export const MAX_ARXIV_ID = 64;
export const MAX_ARXIV_INPUT = 160;

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const ARXIV_AUTHOR_RE = /^[a-z][a-z0-9_-]*_[a-z]_\d+$/;
const ARXIV_AUTHOR_URL_RE = /^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/a\/([^/?#]+?)(?:\.(?:html|atom2|atom|json|js))?\/?$/i;
const ORCID_URL_RE = /^(?:https?:\/\/)?(?:www\.)?orcid\.org\/([^/?#]+)\/?$/i;

const badArxivAuthor = () => new QueryError(
	'Use an arXiv public author link or ID (e.g. arxiv.org/a/surname_i_1) or an ORCID (0000-0000-0000-0000).',
	'Enable your public author identifier in arXiv account settings, or link your ORCID to arXiv, then paste the URL or ID.',
);

export const isOrcid = (id: string) => ORCID_RE.test(id);
export const arxivAuthorUrl = (id: string) => `https://arxiv.org/a/${encodeURIComponent(id)}.html`;
export const arxivAuthorFeedUrl = (id: string) => `https://arxiv.org/a/${encodeURIComponent(id)}.atom2`;
export const orcidUrl = (id: string) => `https://orcid.org/${encodeURIComponent(id)}`;

/** Normalizes an arXiv public author URL/ID or ORCID URL/ID to its canonical ID, or '' when blank. */
export function normalizeArxivAuthor(value: string): string {
	const raw = value.trim();
	if (!raw) return '';
	if ([...raw].length > MAX_ARXIV_INPUT) {
		throw new QueryError(`arXiv author link is longer than ${MAX_ARXIV_INPUT} characters.`, 'Paste just the arXiv author link, author ID, or ORCID.');
	}
	const orcid = raw.match(ORCID_URL_RE)?.[1]?.toUpperCase();
	if (orcid) {
		if (!ORCID_RE.test(orcid)) throw badArxivAuthor();
		return orcid;
	}
	const candidate = raw.match(ARXIV_AUTHOR_URL_RE)?.[1] ?? raw;
	if (ORCID_RE.test(candidate.toUpperCase())) return candidate.toUpperCase();
	const lower = candidate.toLowerCase();
	if (ARXIV_AUTHOR_RE.test(lower) && lower.length <= MAX_ARXIV_ID) return lower;
	throw badArxivAuthor();
}

export type IndexedPaperInfo = { permalink: string; score: number; discussed: number; disputed: boolean; reviews: number; comments: number; mentions: number };
export type ArxivAuthorPaper = { arxivId: string; recordId: string; title: string; authors: string[]; published: string; category: string; url: string; pdf: string; indexed?: IndexedPaperInfo };
export type ArxivAuthorFeedResult = { status: 'ok'; papers: ArxivAuthorPaper[] } | { status: 'not_found' | 'unavailable'; papers: [] };

const cleanXml = (raw = '') => decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/\s+/g, ' ').trim();

/** Parses an arXiv public author Atom2 feed into papers, newest first as listed by arXiv. */
export function parseArxivAuthorFeed(xml: string): ArxivAuthorPaper[] {
	const papers: ArxivAuthorPaper[] = [];
	const seen = new Set<string>();
	for (const entry of xmlTags(xml, 'entry')) {
		const arxivId = cleanXml(xmlTags(entry, 'id')[0]).match(/arxiv\.org\/abs\/([^?#\s]+)/i)?.[1].replace(/v\d+$/i, '') ?? '';
		if (!arxivId || seen.has(arxivId)) continue;
		seen.add(arxivId);
		const rawDate = cleanXml(xmlTags(entry, 'published')[0]) || cleanXml(xmlTags(entry, 'updated')[0]);
		// arXiv's .atom2 feed lists authors comma-separated in one <author><name>, while standard Atom uses one per author.
		const authors = xmlTags(entry, 'author').flatMap((a) => cleanXml(xmlTags(a, 'name')[0]).split(',').map((s) => s.trim())).filter(Boolean);
		const category = decodeEntities(
			entry.match(/<arxiv:primary_category\b[^>]*\bterm=["']([^"']+)["']/i)?.[1]
			?? entry.match(/<category\b[^>]*\bterm=["']([^"']+)["']/i)?.[1]
			?? '',
		);
		papers.push({
			arxivId,
			recordId: `arxiv/${arxivId}`,
			title: cleanXml(xmlTags(entry, 'title')[0]) || `arXiv:${arxivId}`,
			authors,
			published: /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : '',
			category,
			url: `https://arxiv.org/abs/${arxivId}`,
			pdf: `https://arxiv.org/pdf/${arxivId}`,
		});
	}
	return papers;
}

type IndexedRow = { id: string } & Omit<IndexedPaperInfo, 'permalink'>;

/** Fetches a researcher's public arXiv paper feed and cross-links any papers already indexed on Delphi. */
export async function fetchArxivAuthorPapers(db: Db, arxivId: string, fetcher?: typeof fetch): Promise<ArxivAuthorFeedResult> {
	let id = '';
	try { id = normalizeArxivAuthor(arxivId); } catch { return { status: 'not_found', papers: [] }; }
	if (!id) return { status: 'not_found', papers: [] };

	let papers: ArxivAuthorPaper[];
	try {
		const init: RequestInit & { next?: { revalidate: number } } = {
			headers: { accept: 'application/atom+xml, application/xml, text/xml', 'user-agent': 'Delphi.science (https://delphi.science)' },
			signal: AbortSignal.timeout(5000),
			...(fetcher ? {} : { next: { revalidate: 3600 } }),
		};
		const res = await (fetcher ?? globalThis.fetch)(arxivAuthorFeedUrl(id), init);
		if (res.status === 404) return { status: 'not_found', papers: [] };
		if (!res.ok) return { status: 'unavailable', papers: [] };
		const body = await res.text();
		if (!/<feed[\s>]/i.test(body)) return { status: 'not_found', papers: [] };
		papers = parseArxivAuthorFeed(body);
	} catch {
		return { status: 'unavailable', papers: [] };
	}

	if (!papers.length) return { status: 'ok', papers };
	const rows = await db.query<IndexedRow>(
		`SELECT id, score, comments_count AS comments, reviews_count AS reviews, mentions_count AS mentions, discussed, disputed
		 FROM open_index.records WHERE id = ANY($1) AND NOT gone`,
		[papers.map((p) => p.recordId)],
	).then((r) => r.rows, () => []);
	const byId = new Map<string, IndexedPaperInfo>(rows.map(({ id: rid, ...m }) => [rid, { permalink: recordPath(rid), ...m }]));
	return { status: 'ok', papers: papers.map((p) => (byId.has(p.recordId) ? { ...p, indexed: byId.get(p.recordId) } : p)) };
}
