// Reviewed identities only. This is a read projection, never a merge of stored records.
import type { Db } from '#lib/db.ts';

type CuratedGroup = { id: string; main_record_id: string; title: string; evidence: readonly string[]; sources: readonly { id: string; role: string; date_meaning: string }[] };
export const WORK_GROUPS: readonly CuratedGroup[] = [{
	id: 'anthropic-eth-3sat',
	main_record_id: 'lean/anthropics__formal-math__eth',
	// README/paper evidence preserves the exponent lost by the source parser; raw titles stay in sources.
	title: 'A 2^{o(n)} Time Algorithm for 3-SAT',
	evidence: [
		'https://github.com/anthropics/formal-math/blob/main/eth/README.md',
		'https://hexagonmath.org/2610.00577v1',
	],
	sources: [
		{ id: 'lean/anthropics__formal-math__eth', role: 'Paper and Lean proof repository', date_meaning: 'Repository creation; not paper publication' },
		{ id: 'hexagon/2610.00577', role: 'Paper', date_meaning: 'Paper publication' },
	],
}];

export const GROUP_IDS = WORK_GROUPS.flatMap((g) => g.sources.map((s) => s.id));
export const groupFor = (id: unknown) => WORK_GROUPS.find((g) => g.sources.some((s) => s.id === id));
type Raw = Record<string, unknown>;
export type WorkSource = { id: string; role: string; date_meaning: string; record: Raw };
export type WorkResponse = Raw & { url: string; assertions: { record_id: string; link: Raw }[] };
export type Work = { id: string; title: string; main_record_id: string; view_record_id: string; evidence: readonly string[]; sources: WorkSource[]; discussed: number; discussion?: WorkResponse[] };
export const workOf = (r: Raw) => r.work as Work | undefined;
/** Stable main-work display, independent of the matching source that earned the search rank. */
export const mainRecordOf = (r: Raw): Raw => {
	const work = workOf(r);
	return work?.sources.find((s) => s.id === work.main_record_id)?.record ?? r;
};

/** Evidence-backed work title; raw per-source titles are never rewritten. */
export const workTitleOf = (r: Raw): string => workOf(r)?.title ?? String(mainRecordOf(r).title ?? '');
/** Publication metadata is separate from canonical identity and repository creation. */
export const publicationOf = (r: Raw): Raw | undefined => {
	const work = workOf(r);
	return work ? work.sources.find((s) => s.date_meaning === 'Paper publication')?.record : r;
};

/** Conservative URL identity: ignore tracking, normalize host/default ports and X status aliases.
 * Keep fragments, path case, meaningful query parameters and trailing slashes (they can identify distinct responses).
 */
export function responseUrl(raw: string): string {
	try {
		const u = new URL(raw);
		for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid)$/i.test(k)) u.searchParams.delete(k);
		u.searchParams.sort();
		if (/^(www\.)?(twitter|x)\.com$/.test(u.hostname)) {
			const status = u.pathname.match(/^\/(?:[^/]+|i\/web)\/status\/(\d+)\/?$/);
			if (status) return `https://x.com/i/status/${status[1]}`;
		}
		return u.toString();
	} catch { return raw; }
}

/** One response per URL; every original assertion survives, including conflicting stances/dates. */
export function workResponses(sources: WorkSource[]): WorkResponse[] {
	const links = new Map<string, WorkResponse>();
	for (const s of sources) for (const link of Array.isArray(s.record.discussion) ? s.record.discussion as Raw[] : []) {
		if (typeof link.url !== 'string' || !link.url) continue;
		const key = responseUrl(link.url);
		const found = links.get(key);
		if (found) found.assertions.push({ record_id: s.id, link });
		else links.set(key, { ...link, url: link.url, assertions: [{ record_id: s.id, link }] });
	}
	return [...links.values()];
}

/** Attach available sources only; never synthesize an absent record or replace source metadata. */
export async function withWorks(db: Db, records: Raw[], served: string): Promise<Raw[]> {
	const groups = WORK_GROUPS.filter((g) => records.some((r) => groupFor(r.id) === g));
	if (!groups.length) return records;
	const ids = groups.flatMap((g) => g.sources.map((s) => s.id));
	const rows = (await db.query<{ record: Raw }>(`SELECT ${served} AS record FROM open_index.records r WHERE r.id = ANY($1::text[])`, [ids])).rows;
	const byId = new Map(rows.map(({ record }) => [record.id, record]));
	return records.map((r) => {
		const group = groupFor(r.id);
		if (!group) return r;
		const sources: WorkSource[] = group.sources.flatMap((s) => {
			const record = byId.get(s.id);
			return record ? [{ ...s, record }] : [];
		});
		const discussion = workResponses(sources);
		return { ...r, work: { id: group.id, title: group.title, main_record_id: group.main_record_id, view_record_id: String(r.id), evidence: group.evidence, sources, discussed: discussion.length, discussion } satisfies Work };
	});
}
