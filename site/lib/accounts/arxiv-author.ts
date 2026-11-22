// arXiv public author identifiers, ORCID links, and public paper feeds (https://arxiv.org/a/<id>.atom2).
// Identifiers are validated against strict formats before constructing any outbound arXiv URL.
import type { Db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { recordPath } from '#lib/view.ts';

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
	const orcidMatch = raw.match(ORCID_URL_RE);
	if (orcidMatch) {
		const candidate = orcidMatch[1].toUpperCase();
		if (!ORCID_RE.test(candidate)) throw badArxivAuthor();
		return candidate;
	}
	const arxivMatch = raw.match(ARXIV_AUTHOR_URL_RE);
	const candidate = arxivMatch ? arxivMatch[1] : raw;
	const upper = candidate.toUpperCase();
	if (ORCID_RE.test(upper)) return upper;
	const lower = candidate.toLowerCase();
	if (ARXIV_AUTHOR_RE.test(lower) && lower.length <= MAX_ARXIV_ID) return lower;
	throw badArxivAuthor();
}

export type IndexedPaperInfo = {
	permalink: string;
	score: number;
	discussed: number;
	disputed: boolean;
	reviews: number;
	comments: number;
	mentions: number;
};

export type ArxivAuthorPaper = {
	arxivId: string;
	recordId: string;
	title: string;
	authors: string[];
	published: string;
	category: string;
	url: string;
	pdf: string;
	indexed?: IndexedPaperInfo;
};

export type ArxivAuthorFeedResult =
	| { status: 'ok'; papers: ArxivAuthorPaper[] }
	| { status: 'not_found'; papers: [] }
	| { status: 'unavailable'; papers: [] };

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (full, entity: string) => {
		const lower = entity.toLowerCase();
		if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower];
		const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
		if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return full;
		try {
			return String.fromCodePoint(code);
		} catch {
			return full;
		}
	});
}

const cleanText = (raw: string) => decodeXml(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/\s+/g, ' ').trim();

function tagText(xml: string, tag: string): string {
	const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
	return m ? cleanText(m[1]) : '';
}

/** Parses an arXiv public author Atom2 feed into papers, newest first as listed by arXiv. */
export function parseArxivAuthorFeed(xml: string): ArxivAuthorPaper[] {
	const papers: ArxivAuthorPaper[] = [];
	const seen = new Set<string>();
	for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
		const entry = match[1];
		const rawId = tagText(entry, 'id');
		const idMatch = rawId.match(/arxiv\.org\/abs\/([^?#\s]+)/i);
		const arxivId = idMatch ? idMatch[1].replace(/v\d+$/i, '') : '';
		if (!arxivId || seen.has(arxivId)) continue;
		seen.add(arxivId);

		const title = tagText(entry, 'title') || `arXiv:${arxivId}`;
		const rawDate = tagText(entry, 'published') || tagText(entry, 'updated');
		const published = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : '';

		// arXiv's .atom2 feed lists all authors comma-separated in one <author><name>, while standard Atom uses one per author.
		const authors: string[] = [];
		for (const authorMatch of entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)) {
			const name = tagText(authorMatch[1], 'name');
			if (!name) continue;
			for (const part of name.split(',')) {
				const trimmed = part.trim();
				if (trimmed) authors.push(trimmed);
			}
		}

		const primaryCat = entry.match(/<arxiv:primary_category\b[^>]*\bterm=["']([^"']+)["']/i)?.[1]
			?? entry.match(/<category\b[^>]*\bterm=["']([^"']+)["']/i)?.[1]
			?? '';

		papers.push({
			arxivId,
			recordId: `arxiv/${arxivId}`,
			title,
			authors,
			published,
			category: decodeXml(primaryCat),
			url: `https://arxiv.org/abs/${arxivId}`,
			pdf: `https://arxiv.org/pdf/${arxivId}`,
		});
	}
	return papers;
}

const FEED_TTL_MS = 15 * 60 * 1000;
const FEED_CACHE_MAX = 500;
const feedCache = new Map<string, { at: number; papers: ArxivAuthorPaper[] }>();

function cachedPapers(id: string): ArxivAuthorPaper[] | null {
	const hit = feedCache.get(id);
	if (!hit) return null;
	if (Date.now() - hit.at > FEED_TTL_MS) {
		feedCache.delete(id);
		return null;
	}
	return hit.papers;
}

function storeCachedPapers(id: string, papers: ArxivAuthorPaper[]) {
	if (feedCache.size >= FEED_CACHE_MAX) {
		const oldest = feedCache.keys().next().value;
		if (oldest !== undefined) feedCache.delete(oldest);
	}
	feedCache.set(id, { at: Date.now(), papers });
}

type RecordRow = {
	id: string;
	score: number;
	comments_count: number;
	reviews_count: number;
	mentions_count: number;
	discussed: number;
	disputed: boolean;
};

/** Fetches a researcher's public arXiv paper feed and cross-links any papers already indexed on Delphi. */
export async function fetchArxivAuthorPapers(
	db: Db,
	arxivId: string,
	options: { fetch?: typeof fetch; bypassCache?: boolean } = {},
): Promise<ArxivAuthorFeedResult> {
	let id: string;
	try {
		id = normalizeArxivAuthor(arxivId);
	} catch {
		return { status: 'not_found', papers: [] };
	}
	if (!id) return { status: 'not_found', papers: [] };

	let rawPapers = options.bypassCache ? null : cachedPapers(id);
	if (!rawPapers) {
		const doFetch = options.fetch ?? globalThis.fetch;
		try {
			const init: RequestInit & { next?: { revalidate: number } } = {
				headers: { accept: 'application/atom+xml, application/xml, text/xml', 'user-agent': 'Delphi.science (https://delphi.science)' },
				signal: AbortSignal.timeout(5000),
				...(options.fetch ? {} : { next: { revalidate: 3600 } }),
			};
			const res = await doFetch(arxivAuthorFeedUrl(id), init);
			if (res.status === 404) return { status: 'not_found', papers: [] };
			if (!res.ok) return { status: 'unavailable', papers: [] };
			const body = await res.text();
			if (!/<feed[\s>]/i.test(body)) return { status: 'not_found', papers: [] };
			rawPapers = parseArxivAuthorFeed(body);
			if (!options.bypassCache) storeCachedPapers(id, rawPapers);
		} catch {
			return { status: 'unavailable', papers: [] };
		}
	}

	if (!rawPapers.length) return { status: 'ok', papers: [] };
	const ids = rawPapers.map((p) => p.recordId);
	const rows = await db.query<RecordRow>(
		`SELECT id, score, comments_count, reviews_count, mentions_count, discussed, disputed
		 FROM open_index.records WHERE id = ANY($1) AND NOT gone`,
		[ids],
	).then((r) => r.rows, () => []);
	const byId = new Map<string, IndexedPaperInfo>(rows.map((r) => [r.id, {
		permalink: recordPath(r.id),
		score: Number(r.score ?? 0),
		discussed: Number(r.discussed ?? 0),
		disputed: Boolean(r.disputed),
		reviews: Number(r.reviews_count ?? 0),
		comments: Number(r.comments_count ?? 0),
		mentions: Number(r.mentions_count ?? 0),
	}]));

	return {
		status: 'ok',
		papers: rawPapers.map((p) => {
			const indexed = byId.get(p.recordId);
			return indexed ? { ...p, indexed } : { ...p };
		}),
	};
}
