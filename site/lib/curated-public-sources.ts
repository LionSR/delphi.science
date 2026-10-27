// Server-owned, repository-reviewed historical observations. Never import a client registry.
import { createHash } from 'node:crypto';
import registryData from './curated-public-sources.json' with { type: 'json' };
import { canonicalSource, type SourceAdapter } from './public-source-fetch.ts';

const RECORD_ID = /^[a-z][a-z0-9-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const REVIEW_PROCESS = 'Server-shipped repository data; changes require an owner-reviewed PR. Draft observations require review before production activation.';
const LIMITS = Object.freeze([
  'Historical observed-content evidence only; current availability has not been checked by this lookup.',
  'Public visibility at observation time does not prove the claim is true, the proof is correct, or the attributed author has a verified real-world identity.',
  'Summaries are reviewed paraphrases, not verbatim excerpts. A model must still ACCEPT; hold if current availability or stronger proof is essential.',
  'A failed current network attempt must remain a failure; this snapshot must not silently replace it.',
]);

type Review = Readonly<{ reviewed_by: string; process: typeof REVIEW_PROCESS }>;
export type CuratedSourceAdapter = SourceAdapter | 'drive_file';
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
  review: Review;
}>;
export type CuratedPublicSnapshot = Observation & Readonly<{
  status: 'curated_public_snapshot';
  digest: string;
  digest_kind: 'reviewed_observation_record_sha256';
  evidence_limits: readonly string[];
}>;

const invalid = (): never => { throw new Error('Invalid server-owned curated public-source registry.'); };
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(result, key))) return invalid();
  return result;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max
    || /[<>\u0000-\u001f\u007f]/u.test(value)
    || /(?:oik_[a-f0-9]{48}|\bsk-[a-z0-9_-]{16,}|\bgh[pousr]_[a-z0-9]{20,}|\bbearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(value)) return invalid();
  // Embedded references are public identities too, never capability URLs or credentials.
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
function sourceIdentity(value: string): { canonical: string; adapter: CuratedSourceAdapter } {
  try { return canonicalSource(value); } catch { /* Curated-only file observation; never extend the network fetcher. */ }
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
    let target; try { target = sourceIdentity(reference); } catch { return invalid(); }
    if (target.canonical !== reference || target.adapter !== value.adapter) return invalid();
    const key = `${value.record_id}\n${reference}`;
    if (seen.has(key)) return invalid();
    seen.add(key);
    const window = object(value.observed_window_utc, ['start', 'end']);
    const start = text(window.start, 24), end = text(window.end, 24);
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    if (!utc.test(start) || !utc.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))
      || new Date(start).toISOString() !== start.replace('Z', '.000Z') || new Date(end).toISOString() !== end.replace('Z', '.000Z')
      || Date.parse(end) < Date.parse(start) || Date.parse(end) - Date.parse(start) > 24 * 60 * 60 * 1000) return invalid();
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
    // The digest identifies this reviewed observation record, never the remote page bytes.
    const digest = createHash('sha256').update(JSON.stringify({ schema_version: 1, observation })).digest('hex');
    return Object.freeze({ ...observation, status: 'curated_public_snapshot' as const, digest,
      digest_kind: 'reviewed_observation_record_sha256' as const, evidence_limits: LIMITS });
  }));
}

/** Repository-data validation only. This never registers or authorizes caller-supplied observations. */
export function validateCuratedPublicSourceRegistry(raw: unknown): void { parseRegistry(raw); }
const observations = parseRegistry(registryData);
const byReference = new Map(observations.map(observation => [`${observation.record_id}\n${observation.reference}`, observation]));

/** No network or client evidence accepted. Caller must first verify the existing research record. */
export function lookupCuratedPublicSource(recordId: string, sourceUrl: string): CuratedPublicSnapshot | undefined {
  if (typeof recordId !== 'string' || !RECORD_ID.test(recordId) || typeof sourceUrl !== 'string') return undefined;
  let reference: string; try { reference = sourceIdentity(sourceUrl).canonical; } catch { return undefined; }
  return byReference.get(`${recordId}\n${reference}`);
}
