// Citation evidence comes from server-held metadata, never from a model's claim to have opened a source.
// Nothing is fetched here; a citation that is not indexed or curated stays unresolved.
import prefixes from './prefixes.json' with { type: 'json' };
import { lookupCuratedPublicSource, type CuratedPublicSnapshot } from './curated-public-sources.ts';
import { type PublicEvidence } from './public-source-checks.ts';
import type { Db } from './query.ts';

export type SourceEvidence = { reference: string; status: 'indexed_metadata' | 'unresolved'; id?: string; title?: string; url?: string; check_status?: string; reason?: string; fix?: string } | PublicEvidence | CuratedPublicSnapshot;

// Characters that end a reference in running text, including CJK punctuation.
const BREAK = '\\s<>"\'()\\[\\]{}\u0060《》〈〉「」『』【】（）。，；：！？、';
const URLS = new RegExp(`https?://[^${BREAK}]+`, 'gi');
const PREFIXED_IDS = new RegExp(`\\b(?:${Object.keys(prefixes.prefixes).join('|')})/[^${BREAK},;]+`, 'gi');
const ARXIV_IDS = /\barxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?/gi;
const DOIS = new RegExp(`\\b10\\.\\d{4,9}/[^${BREAK},;]+`, 'g');

/** The distinct URLs, record IDs, arXiv IDs and DOIs cited in `text`, without trailing punctuation. */
function references(text: string): string[] {
	const withoutUrls = text.replace(URLS, ' ');
	return [...new Set([
		...(text.match(URLS) ?? []),
		...(withoutUrls.match(PREFIXED_IDS) ?? []),
		...(withoutUrls.match(ARXIV_IDS) ?? []),
		...(withoutUrls.match(DOIS) ?? []),
	].map((s) => s.replace(/[.:!?]+$/, '')))];
}

/** The record ID a reference would have in the index, or '' for a URL that is not arXiv or doi.org. */
function recordId(reference: string): string {
	const arxiv = reference.match(/^(?:arxiv(?::\s*|\/)|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i);
	const doi = reference.match(/^(?:https?:\/\/doi\.org\/)?(10\.\d{4,9}\/\S+)$/i);
	if (doi) return `doi/${doi[1].replaceAll('/', '__')}`;
	if (arxiv) return `arxiv/${arxiv[1]}`;
	return /^https?:/i.test(reference) ? '' : reference.replace(/^([^/]+)\//, (_, prefix: string) => `${prefix.toLowerCase()}/`);
}

export async function citationEvidence(db: Db, text: string, context?: { record: string; allowCurated: boolean }): Promise<SourceEvidence[]> {
	const refs = references(text);
	if (refs.length > 12) return [{ reference: 'reference count', status: 'unresolved' }];
	const evidence: SourceEvidence[] = [];
	for (const reference of refs) {
		const rec = (await db.query<{ id: string; title: string; url: string }>(
			'SELECT id, title, url FROM open_index.records WHERE NOT gone AND (id = $1 OR url = $2) LIMIT 1', [recordId(reference), reference])).rows[0];
		const curated = context?.allowCurated ? lookupCuratedPublicSource(context.record, reference) : undefined;
		evidence.push(rec ? { reference, status: 'indexed_metadata', ...rec } : curated ?? { reference, status: 'unresolved' });
	}
	return evidence;
}
