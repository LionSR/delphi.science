// Evidence comes from server-held metadata, never from a model's claim to have opened a source.
// Extraction never fetches URLs. Explicit retrieval uses the separate bounded public-source transport.
import prefixes from './prefixes.json' with { type: 'json' };
import { lookupCuratedPublicSource, type CuratedPublicSnapshot } from './curated-public-sources.ts';
import { canonicalSource, isPublicIPv4 } from './public-source-fetch.ts';
import { type PublicEvidence } from './public-source-checks.ts';
import type { Db } from './query.ts';

export type SourceEvidence = { reference: string; status: 'indexed_metadata' | 'unresolved'; id?: string; title?: string; url?: string; check_status?: string; private_input?: boolean; reason?: string; fix?: string } | { reference: 'Additional references'; status: 'not_checked'; count: number; fix: string } | PublicEvidence | CuratedPublicSnapshot;

export async function citationEvidence(db: Db, text: string, context?: { record: string; allowCurated: boolean }): Promise<SourceEvidence[]> {
	const ids = new RegExp(`\\b(?:${Object.keys(prefixes.prefixes).join('|')})/[^\\s<>"'()\\[\\]{}\u0060《》〈〉「」『』【】（）。，；：！？、,;]+`, 'gi');
	const urls = /https?:\/\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、]+/gi;
	const withoutUrls = text.replace(urls, match => ' '.repeat(match.length));
	// Keep the author's actual order, including bare identifiers ahead of later URLs.
	const refs = [...new Set([
		...text.matchAll(urls), ...withoutUrls.matchAll(ids),
		...withoutUrls.matchAll(/\barxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?/gi),
		...withoutUrls.matchAll(/\b10\.\d{4,9}\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、,;]+/g),
	].sort((a, b) => a.index! - b.index!).map(m => m[0].replace(/[.:!?]+$/, '')))];
	if (refs.some(privateReference)) return [{ reference: 'Private or credential-bearing source input', status: 'unresolved', private_input: true }];
	const evidence: SourceEvidence[] = [];
	for (const reference of refs.slice(0, 12)) {
		let id = /^https?:/i.test(reference) ? '' : reference.replace(/^([^/]+)\//, (_, prefix: string) => `${prefix.toLowerCase()}/`);
		const arxiv = reference.match(/^(?:arxiv(?::\s*|\/)|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i);
		const doi = reference.match(/^(?:https?:\/\/doi\.org\/)?(10\.\d{4,9}\/\S+)$/i);
		if (arxiv) id = `arxiv/${arxiv[1]}`;
		if (doi) id = `doi/${doi[1].replaceAll('/', '__')}`;
		const rec = (await db.query<{ id: string; title: string; url: string }>(
			"SELECT id, title, url FROM open_index.records WHERE NOT gone AND (id = $1 OR url = $2) LIMIT 1", [id, reference])).rows[0];
		evidence.push(rec ? { reference, status: 'indexed_metadata', ...rec } : (context?.allowCurated ? lookupCuratedPublicSource(context.record, reference) : undefined) ?? { reference, status: 'unresolved' });
	}
	if (refs.length > 12) evidence.push({ reference: 'Additional references', status: 'not_checked', count: refs.length - 12, fix: 'Only the first twelve distinct references were checked. Put essential sources first, remove optional links, or split a long bibliography into scoped follow-ups. Do not rely on unchecked sources for an essential claim.' });
	return evidence;
}

function privateReference(reference: string): boolean {
	if (!/^https?:/i.test(reference)) return false;
	try {
		const u = new URL(reference);
		let safeQuery = !u.search;
		try { canonicalSource(reference); safeQuery = true; } catch { /* opaque queries stay out of provider input */ }
		return Boolean(u.username || u.password || !safeQuery || !u.hostname.includes('.')
			|| /(?:^|\.)(?:local|localhost|internal)$/.test(u.hostname) || u.hostname.includes(':')
			|| (/^[0-9.]+$/.test(u.hostname) && !isPublicIPv4(u.hostname)));
	} catch { return true; }
}

/** Recognizable private/capability URLs must not be sent to the moderator, even as ancillary context. */
export function hasPrivateSourceInput(text: string): boolean {
	return (text.match(/https?:\/\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、]+/gi) ?? []).some(privateReference);
}
