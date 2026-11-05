// Canonical identity/membership are persisted in works/work_records; no runtime identity list.
import type { Db } from '#lib/db.ts';
import { CodedError } from '#lib/errors.ts';

type Raw = Record<string, unknown>;
export type WorkSource = { id: string; role: string; date_meaning: string; evidence?: string[]; reviewed_by?: string | null; identity?: Raw | null; record: Raw };
export type WorkResponse = Raw & { url: string; assertions: { record_id: string; link: Raw }[] };
export type Work = { id: string; title: string; main_record_id: string; member_count: number; publication_record_id: string | null; view_record_id: string; evidence: string[]; sources: WorkSource[]; discussed: number; discussion?: WorkResponse[]; requested_work_id?: string };
export const workOf = (r: Raw) => r.work as Work | undefined;
export const isGroupedWork = (r: Raw) => Boolean(workOf(r) && (workOf(r)!.member_count > 1 || workOf(r)!.evidence.length));
export const mainRecordOf = (r: Raw): Raw => {
	const work = workOf(r);
	return work?.sources.find((s) => s.id === work.main_record_id)?.record ?? r;
};
export const workTitleOf = (r: Raw): string => workOf(r)?.title ?? String(mainRecordOf(r).title ?? '');
export const publicationOf = (r: Raw): Raw | undefined => {
	const work = workOf(r);
	return work ? work.sources.find((s) => s.id === work.publication_record_id)?.record : r;
};

/** Old-schema runtimes read raw sources safely until the reviewed migration is applied separately.
 * No cached negative: a later operator-authorized migration becomes visible without a restart.
 */
export async function canonicalWorksReady(db: Db): Promise<boolean> {
	return (await db.query<{ ready: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
		WHERE attrelid=to_regclass('open_index.works') AND attname='main_record_id' AND NOT attisdropped) AS ready`)).rows[0].ready;
}

/** Keep fragments/path case/meaningful queries/trailing slashes; they may identify distinct responses. */
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

export function workResponses(sources: WorkSource[]): WorkResponse[] {
	const links = new Map<string, WorkResponse>();
	for (const s of sources) for (const link of Array.isArray(s.record.discussion) ? s.record.discussion as Raw[] : []) {
		if (typeof link.url !== 'string' || !link.url) continue;
		const key = responseUrl(link.url), found = links.get(key);
		if (found) found.assertions.push({ record_id: s.id, link });
		else links.set(key, { ...link, url: link.url, assertions: [{ record_id: s.id, link }] });
	}
	return [...links.values()];
}

type WorkRow = { id: string; title: string; main_record_id: string; member_count: number; publication_record_id: string | null; evidence: string[] };
async function readWorks(db: Db, ids: string[], served: string): Promise<Map<string, Work>> {
	if (!ids.length) return new Map();
	const works = (await db.query<WorkRow>(`SELECT id,title,main_record_id,publication_record_id,evidence,(SELECT count(*)::int FROM open_index.work_records m WHERE m.work_id=w.id) AS member_count FROM open_index.works w WHERE id=ANY($1::text[]) AND redirect_work_id IS NULL`, [ids])).rows;
	const sources = (await db.query<{ work_id: string; id: string; role: string; date_meaning: string; evidence: string[]; reviewed_by: string | null; identity: Raw | null; record: Raw }>(
		`SELECT m.work_id,m.record_id AS id,m.role,m.date_meaning,m.evidence,m.reviewed_by,m.identity,${served} AS record
		 FROM open_index.work_records m JOIN open_index.records r ON r.id=m.record_id JOIN open_index.works w ON w.id=m.work_id
		 WHERE m.work_id=ANY($1::text[]) ORDER BY m.work_id,(m.record_id=w.main_record_id) DESC,m.record_id`, [ids])).rows;
	return new Map(works.map((w) => {
		const available = sources.filter((s) => s.work_id === w.id).map(({ work_id: _, identity, ...s }) => ({...s,...(identity ? {identity} : {})}));
		const discussion = workResponses(available);
		return [w.id, { ...w, view_record_id: w.main_record_id, sources: available, discussed: discussion.length, discussion }];
	}));
}

export async function withWorks(db: Db, records: Raw[], served: string): Promise<Raw[]> {
	const works = await readWorks(db, [...new Set(records.map((r) => String(r.work_id)))], served);
	return records.map((r) => {
		const work=works.get(String(r.work_id));
		if (!work) throw new CodedError(503,'canonical_work_changed','The work relationship changed during this read.','Retry the query.');
		return { ...r,work:{...work,view_record_id:String(r.id)} };
	});
}

export async function getWork(db: Db, id: string, served: string): Promise<Work | null> {
	if (!await canonicalWorksReady(db)) throw new CodedError(503, 'canonical_schema_unavailable', 'Canonical work relationships are not enabled on this database.', 'Use source record endpoints until the separately reviewed migration is applied.');
	const row = (await db.query<{ id: string }>('SELECT coalesce(redirect_work_id,id) AS id FROM open_index.works WHERE id=$1', [id])).rows[0];
	if (!row) return null;
	const work = (await readWorks(db, [row.id], served)).get(row.id)!;
	return row.id === id ? work : { ...work, requested_work_id: id };
}
