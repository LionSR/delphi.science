// Evidence comes from server-held metadata, never from a model's claim to have opened a source.
// No arbitrary URL fetching (and therefore no SSRF); an unrecognized citation is held for review.
import prefixes from './prefixes.json' with { type: 'json' };
import { lookupCuratedPublicSource, type CuratedPublicSnapshot } from './curated-public-sources.ts';
import { type PublicEvidence } from './public-source-checks.ts';
import type { Db } from './query.ts';

export type SourceEvidence = { reference: string; status: 'indexed_metadata' | 'unresolved'; id?: string; title?: string; url?: string; check_status?: string; reason?: string; fix?: string } | PublicEvidence | CuratedPublicSnapshot;

export async function citationEvidence(db: Db, text: string, context?: { record: string; allowCurated: boolean }): Promise<SourceEvidence[]> {
	const ids = new RegExp(`\\b(?:${Object.keys(prefixes.prefixes).join('|')})/[^\\s<>"'()\\[\\]{}\u0060《》〈〉「」『』【】（）。，；：！？、,;]+`, 'gi');
	const withoutUrls = text.replace(/https?:\/\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、]+/gi, ' ');
	const refs = [...new Set([
		...(text.match(/https?:\/\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、]+/gi) ?? []),
		...(withoutUrls.match(ids) ?? []),
		...(withoutUrls.match(/\barxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?/gi) ?? []),
		...(withoutUrls.match(/\b10\.\d{4,9}\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、,;]+/g) ?? []),
	].map((s) => s.replace(/[.:!?]+$/, '')))];
	if (refs.length > 12) return [{ reference: 'reference count', status: 'unresolved' }];
	const evidence: SourceEvidence[] = [];
	for (const reference of refs) {
		let id = /^https?:/i.test(reference) ? '' : reference.replace(/^([^/]+)\//, (_, prefix: string) => `${prefix.toLowerCase()}/`);
		const arxiv = reference.match(/^(?:arxiv(?::\s*|\/)|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i);
		const doi = reference.match(/^(?:https?:\/\/doi\.org\/)?(10\.\d{4,9}\/\S+)$/i);
		if (arxiv) id = `arxiv/${arxiv[1]}`;
		if (doi) id = `doi/${doi[1].replaceAll('/', '__')}`;
		const rec = (await db.query<{ id: string; title: string; url: string }>(
			"SELECT id, title, url FROM open_index.records WHERE NOT gone AND (id = $1 OR url = $2) LIMIT 1", [id, reference])).rows[0];
		evidence.push(rec ? { reference, status: 'indexed_metadata', ...rec } : (context?.allowCurated ? lookupCuratedPublicSource(context.record, reference) : undefined) ?? { reference, status: 'unresolved' });
	}
	return evidence;
}
