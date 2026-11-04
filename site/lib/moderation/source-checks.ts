// Public-source checks for a record: fresh retrievals and reviewed historical observations, kept distinct.
import { NotFoundError, QueryError } from '../errors.ts';
import type { Db } from '../db.ts';
import { sha256 } from '../hash.ts';
import { lookupCuratedPublicSource, type CuratedPublicSnapshot } from './curated-sources.ts';
import { reserveAttempt, finishAttempt } from './audit.ts';
import type { Voter } from '../accounts/keys.ts';
import { canonicalSource, retrieveSource, type SourceRetrieval, type SourceTarget } from './source-fetch.ts';

export type SourceRetriever = (target: SourceTarget, deadlineAt?: number) => Promise<SourceRetrieval>;
type CheckResult = {
	index: number; reference: string; status: SourceRetrieval['status'] | 'curated_public_snapshot'; reason: string; fix: string;
	observed_at?: string; adapter?: SourceRetrieval['adapter'] | 'drive_file'; method?: string; response_status?: number;
	title?: string; author?: string; excerpt?: string; digest?: string;
	requested_ref?: string; resolved_commit?: string; path?: string; blob_sha?: string; file_mode?: string; root_tree_sha?: string;
	curated?: CuratedPublicSnapshot; observed_window_utc?: CuratedPublicSnapshot['observed_window_utc']; factual_summary?: string;
	digest_kind?: 'remote_response_sha256' | 'reviewed_observation_record_sha256';
};
export type CheckBatch = { record_id: string; results: CheckResult[]; posted: false };
export type PublicEvidence = {
	reference: string; status: 'retrieved_public'; url: string; adapter: string; method: string; observed_at: string;
	excerpt: string; digest: string; digest_kind?: 'remote_response_sha256';
	title?: string; author?: string; requested_ref?: string; resolved_commit?: string; path?: string; blob_sha?: string; file_mode?: string; root_tree_sha?: string;
};

const STATUSES = ['retrieved', 'unsupported', 'not_found', 'unavailable', 'identity_mismatch', 'unsupported_format'];
const FIELDS = ['adapter', 'author', 'blob_sha', 'canonical', 'digest', 'excerpt', 'fix', 'method', 'observed_at', 'path', 'reason',
	'requested_ref', 'resolved_commit', 'response_status', 'status', 'title', 'file_mode', 'root_tree_sha'];
const GIT_FIELDS = ['title', 'author', 'requested_ref', 'resolved_commit', 'path', 'blob_sha', 'file_mode', 'root_tree_sha'] as const;
const SHA = /^[0-9a-f]{40}$/;
const defaultRetriever: SourceRetriever = (target, deadline) => retrieveSource(target, undefined, deadline);
const shortText = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max;
/** One to `max` URLs, each a nonempty string of at most 2,000 characters. */
const urlBatch = (urls: unknown, max: number) => Array.isArray(urls) && urls.length > 0 && urls.length <= max
	&& urls.every((u) => typeof u === 'string' && u.length > 0 && u.length <= 2000);

/** An injected retriever's result must have the exact shape and identity of a real retrieval. */
function validResult(raw: unknown, target: SourceTarget): raw is SourceRetrieval {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
	const v = raw as Record<string, unknown>;
	if (Object.keys(v).some((k) => !FIELDS.includes(k)) || v.canonical !== target.canonical || v.adapter !== target.adapter
		|| v.method !== 'public-https-v1' || !STATUSES.includes(String(v.status)) || !shortText(v.reason, 500) || !shortText(v.fix, 500)
		|| typeof v.observed_at !== 'string' || !Number.isFinite(Date.parse(v.observed_at))) return false;
	for (const [name, max] of [['title', 200], ['author', 100], ['excerpt', 2000]] as const) {
		if (v[name] !== undefined && (typeof v[name] !== 'string' || (v[name] as string).length > max)) return false;
	}
	if (v.response_status !== undefined && (!Number.isInteger(v.response_status) || Number(v.response_status) < 100 || Number(v.response_status) > 599)) return false;
	if (v.status !== 'retrieved') return v.excerpt === undefined && v.digest === undefined && v.title === undefined && v.author === undefined;
	if (v.response_status !== 200 || !shortText(v.excerpt, Infinity) || typeof v.digest !== 'string' || !/^[0-9a-f]{64}$/.test(v.digest)) return false;
	if (/oik_[0-9a-f]{48}/.test(JSON.stringify(v))) return false;
	if (target.adapter !== 'github') return true;
	const { ref, path } = target.identity;
	return SHA.test(ref) && v.resolved_commit === ref && v.requested_ref === ref && v.path === path
		&& SHA.test(String(v.blob_sha)) && ['100644', '100755'].includes(String(v.file_mode)) && SHA.test(String(v.root_tree_sha));
}

/** A display/audit label that drops a caller's query string or credentials. */
export function safeSourceReference(reference: string): string {
	try {
		return canonicalSource(reference).canonical;
	} catch {
		const arxiv = reference.match(/^arxiv(?::|\/)(\d{4}\.\d{4,5})(?:v\d+)?$/i);
		return arxiv ? `arxiv/${arxiv[1]}` : 'Unsupported or unindexed reference';
	}
}

const unavailable = (index: number, reference: string): CheckResult => ({
	index, reference, status: 'unavailable',
	reason: 'A bounded public retrieval could not be completed within this request.',
	fix: 'Keep the draft. Check this individual public source again explicitly; unavailability does not assess its scientific claim.',
});

async function timed<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('source deadline')), ms); });
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

function curatedResult(index: number, snapshot: CuratedPublicSnapshot): CheckResult {
	return {
		index, reference: snapshot.reference, status: 'curated_public_snapshot',
		reason: 'A repository-reviewed historical public observation is available; this is not a fresh network check.',
		fix: 'Read its observation window and limits. Current availability or stronger claims still need an explicit fresh check or independent review.',
		observed_window_utc: snapshot.observed_window_utc, factual_summary: snapshot.factual_summary, digest_kind: snapshot.digest_kind,
		digest: snapshot.digest, adapter: snapshot.adapter, method: snapshot.method, curated: snapshot,
	};
}

/** Check up to twelve URLs, two at a time, within one overall deadline. */
export async function collectPublicSources(record: string, urls: string[], fetchSource: SourceRetriever = defaultRetriever, options: { deadlineMs?: number; allowCurated?: boolean } = {}): Promise<CheckBatch> {
	if (!urlBatch(urls, 12)) {
		throw new QueryError('Send at most twelve source URLs for an explicit post.', 'Each URL must be at most 2,000 characters.');
	}
	const deadline = Date.now() + Math.max(1, Math.min(options.deadlineMs ?? 20_000, 20_000));
	const check = async (input: string, index: number): Promise<CheckResult> => {
		const snapshot = options.allowCurated ? lookupCuratedPublicSource(record, input) : undefined;
		if (snapshot) return curatedResult(index, snapshot);
		let target: SourceTarget;
		try {
			target = canonicalSource(input);
		} catch {
			return { index, reference: '', status: 'unsupported', reason: 'This is not a supported safe public source URL.', fix: 'Use a canonical supported public source without credentials or unsupported parameters.' };
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) return unavailable(index, target.canonical);
		try {
			const result = await timed(fetchSource(target, deadline), remaining);
			if (!validResult(result, target)) return unavailable(index, target.canonical);
			const { canonical, ...rest } = result;
			return { ...rest, index, reference: canonical, observed_at: new Date().toISOString(), ...(result.digest ? { digest_kind: 'remote_response_sha256' as const } : {}) };
		} catch {
			return unavailable(index, target.canonical);
		}
	};
	const results: CheckResult[] = Array(urls.length);
	let next = 0;
	const worker = async () => {
		for (let i = next++; i < urls.length; i = next++) results[i] = await check(urls[i], i);
	};
	await Promise.all([worker(), worker()]);
	return { record_id: record, results, posted: false };
}

/** The audit keeps canonical identities, statuses and digests; never excerpts, titles, authors or drafts. */
export function sourceAudit(batch: CheckBatch): string {
	return JSON.stringify({
		record_id: batch.record_id,
		results: batch.results.map((r) => ({
			url: r.reference, canonical_hash: r.reference ? sha256(r.reference) : null, status: r.status,
			adapter: r.adapter ?? null, method: r.method ?? null, response_status: r.response_status ?? null,
			digest: r.digest ?? null, digest_kind: r.digest_kind ?? null, observed_at: r.observed_at ?? null,
			observed_window_utc: r.observed_window_utc ?? null, requested_ref: r.requested_ref ?? null,
			resolved_commit: r.resolved_commit ?? null, path: r.path ?? null, blob_sha: r.blob_sha ?? null,
			file_mode: r.file_mode ?? null, root_tree_sha: r.root_tree_sha ?? null,
			observation_digest: r.curated?.digest ?? null, observation_digest_kind: r.curated?.digest_kind ?? null,
		})),
	});
}

/** Authenticated preflight: each batch of one to five URLs uses one shared moderation attempt. */
export async function checkPublicSources(db: Db, who: Voter, record: string, urls: string[], fetchSource: SourceRetriever = defaultRetriever): Promise<CheckBatch> {
	if (!urlBatch(urls, 5)) {
		throw new QueryError('Send one to five public source URLs.', 'Each URL must be at most 2,000 characters.');
	}
	if (!(await db.query('SELECT id FROM open_index.records WHERE id=$1 AND NOT gone', [record])).rows.length) {
		throw new NotFoundError(`no record ${JSON.stringify(record)}`, 'Open an existing research record.');
	}
	const audit = await reserveAttempt(db, who, 'source_check');
	const batch = await collectPublicSources(record, urls, fetchSource, { allowCurated: true });
	await finishAttempt(db, audit, false, `SOURCE_CHECK: ${sourceAudit(batch)}`);
	return batch;
}

/** A successful fresh retrieval as source evidence for the moderator; anything else is undefined. */
export function publicEvidence(result: CheckResult): PublicEvidence | undefined {
	const { reference, status, excerpt, digest, adapter, method, observed_at } = result;
	if (status !== 'retrieved' || !excerpt || !digest || !adapter || !method || !observed_at) return;
	const evidence: PublicEvidence = { reference, observed_at, adapter, method, excerpt, digest, digest_kind: 'remote_response_sha256', status: 'retrieved_public', url: reference };
	for (const key of GIT_FIELDS) if (key in result) evidence[key] = result[key];
	return evidence;
}
