// Repository-reviewed historical observations of public sources, shipped with the server.
import { createHash } from 'node:crypto';
import registryData from './curated-sources.json' with { type: 'json' };
import { canonicalSource, type SourceAdapter } from './source-fetch.ts';

const RECORD_ID = /^[a-z][a-z0-9-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_PROCESS = 'Server-shipped repository data; changes require an owner-reviewed PR. Draft observations require review before production activation.';
const LIMITS = Object.freeze([
	'Historical observed-content evidence only; current availability has not been checked by this lookup.',
	'Public visibility at observation time does not prove the claim is true, the proof is correct, or the attributed author has a verified real-world identity.',
	'Summaries are reviewed paraphrases, not verbatim excerpts. A model must still ACCEPT; hold if current availability or stronger proof is essential.',
	'A failed current network attempt must remain a failure; this snapshot must not silently replace it.',
]);

// Drive files are a curated-only identity: they are never fetched.
type CuratedSourceAdapter = SourceAdapter | 'drive_file';
type Observation = Readonly<{
	record_id: string;
	reference: string;
	adapter: CuratedSourceAdapter;
	method: 'signed_out_browser';
	observed_window_utc: Readonly<{ start: string; end: string }>;
	visibility: 'public_at_observation';
	title: string;
	attributed_author?: string;
	factual_summary: string;
	attribution_caveats: readonly string[];
	review: Readonly<{ reviewed_by: string; process: typeof REVIEW_PROCESS }>;
}>;
export type CuratedPublicSnapshot = Observation & Readonly<{
	status: 'curated_public_snapshot';
	digest: string;
	digest_kind: 'reviewed_observation_record_sha256';
	evidence_limits: readonly string[];
}>;

const invalid = (): never => { throw new Error('Invalid server-owned curated public-source registry.'); };
const key = (recordId: string, reference: string) => `${recordId}\n${reference}`;

/** `value` as an object with exactly these keys, plus any of the optional ones. */
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
	const result = value as Record<string, unknown>;
	if (Object.keys(result).some(k => !keys.includes(k) && !optional.includes(k)) || keys.some(k => !Object.hasOwn(result, k))) return invalid();
	return result;
}
/** Bounded, trimmed, inert text with no markup, control characters or credential-shaped strings. */
function text(value: unknown, max: number): string {
	if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max
		|| /[<>\u0000-\u001f\u007f]/u.test(value)
		|| /(?:oik_[a-f0-9]{48}|\bsk-[a-z0-9_-]{16,}|\bgh[pousr]_[a-z0-9]{20,}|\bbearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(value)) return invalid();
	// Embedded links must be plain https URLs: no credentials, query or fragment.
	for (const link of value.match(/https?:\/\/[^\s)]+/g) ?? []) {
		let url: URL; try { url = new URL(link); } catch { return invalid(); }
		if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return invalid();
	}
	return value;
}
function strings(value: unknown): readonly string[] {
	if (!Array.isArray(value) || !value.length || value.length > 8) return invalid();
	return Object.freeze(value.map(item => text(item, 600)));
}
/** A valid UTC timestamp written to the second, e.g. 2026-01-02T03:04:05Z. */
function utcSecond(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value))
		&& new Date(value).toISOString() === value.replace('Z', '.000Z');
}
function sourceIdentity(value: string): { canonical: string; adapter: CuratedSourceAdapter } {
	try { return canonicalSource(value); } catch { /* fall through to the curated-only Drive file identity */ }
	const drive = /^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,100})\/view(?:\?usp=(?:sharing|drive_link))?$/.exec(value);
	if (!drive) return invalid();
	return { canonical: `https://drive.google.com/file/d/${drive[1]}/view`, adapter: 'drive_file' };
}
function parseRegistry(raw: unknown): readonly CuratedPublicSnapshot[] {
	const root = object(raw, ['schema_version', 'observations']);
	if (root.schema_version !== 1 || !Array.isArray(root.observations) || root.observations.length > 32) return invalid();
	const seen = new Set<string>();
	return Object.freeze(root.observations.map(rawObservation => {
		const value = object(rawObservation, ['record_id', 'reference', 'adapter', 'method', 'observed_window_utc', 'visibility', 'title', 'factual_summary', 'attribution_caveats', 'review'], ['attributed_author']);
		if (typeof value.record_id !== 'string' || !RECORD_ID.test(value.record_id) || value.method !== 'signed_out_browser' || value.visibility !== 'public_at_observation') return invalid();
		const reference = text(value.reference, 2000);
		const target = sourceIdentity(reference);
		if (target.canonical !== reference || target.adapter !== value.adapter) return invalid();
		if (seen.has(key(value.record_id, reference))) return invalid();
		seen.add(key(value.record_id, reference));
		const window = object(value.observed_window_utc, ['start', 'end']);
		const start = text(window.start, 24), end = text(window.end, 24);
		if (!utcSecond(start) || !utcSecond(end) || Date.parse(end) < Date.parse(start) || Date.parse(end) - Date.parse(start) > DAY_MS) return invalid();
		const review = object(value.review, ['reviewed_by', 'process']);
		if (review.process !== REVIEW_PROCESS) return invalid();
		const observation: Observation = Object.freeze({
			record_id: value.record_id, reference, adapter: target.adapter, method: 'signed_out_browser',
			observed_window_utc: Object.freeze({ start, end }), visibility: 'public_at_observation',
			title: text(value.title, 240),
			...(value.attributed_author === undefined ? {} : { attributed_author: text(value.attributed_author, 200) }),
			factual_summary: text(value.factual_summary, 2000), attribution_caveats: strings(value.attribution_caveats),
			review: Object.freeze({ reviewed_by: text(review.reviewed_by, 200), process: REVIEW_PROCESS }),
		});
		// The digest covers this reviewed record, not the remote page bytes.
		const digest = createHash('sha256').update(JSON.stringify({ schema_version: 1, observation })).digest('hex');
		return Object.freeze({ ...observation, status: 'curated_public_snapshot' as const, digest,
			digest_kind: 'reviewed_observation_record_sha256' as const, evidence_limits: LIMITS });
	}));
}

/** Throws unless `raw` is a valid registry; it never adds to the shipped one. */
export function validateCuratedPublicSourceRegistry(raw: unknown): void { parseRegistry(raw); }
const byReference = new Map(parseRegistry(registryData).map(observation => [key(observation.record_id, observation.reference), observation]));

/** The shipped observation of `sourceUrl` for exactly this record. The caller must first check that the record exists. */
export function lookupCuratedPublicSource(recordId: string, sourceUrl: string): CuratedPublicSnapshot | undefined {
	if (typeof recordId !== 'string' || !RECORD_ID.test(recordId) || typeof sourceUrl !== 'string') return undefined;
	let reference: string; try { reference = sourceIdentity(sourceUrl).canonical; } catch { return undefined; }
	return byReference.get(key(recordId, reference));
}
