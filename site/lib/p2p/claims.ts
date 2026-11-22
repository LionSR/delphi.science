// Claims from the peer-to-peer network (github.com/LionSR/delphi-p2p): storing what a bridge (bridge/) hands over,
// and what a record page shows of it. The network holds the signed originals; open_index.claims is a copy that any
// client's log can rebuild.
//
// Only a claim's structured fields are shown: ids, keys, counts, sizes, verdicts. Its free text (title, note,
// author names, checker output) is written by strangers and is not shown. Showing it needs the moderation gate.
// File names are written by strangers too. One is shown only if it is made of plain path characters (SHOWN).
import type { Voter } from '#lib/accounts/keys.ts';
import type { spec } from '#lib/api/openapi.ts';
import type { FromSchema } from '#lib/api/schema.ts';
import type { Db } from '#lib/db.ts';
import { detect, looksLikeLink } from '#lib/records/resolve.ts';

type Batch = FromSchema<typeof spec.paths['/api/v1/claims']['post']['requestBody']['content']['application/json']['schema']>;
/** One claim as `delphi-p2p log --json` prints it. */
export type ClaimEntry = Batch['entries'][number];
/** One file of a snapshot as `delphi-p2p files --json` prints it: its path, size and hash. */
export type FileEntry = NonNullable<Batch['snapshots']>[number]['files'][number];

/** Only the GitHub logins listed in P2P_BRIDGE_LOGINS may hand over claims; an empty list allows no one. */
export function canRelay(who: Voter | null | undefined, configured = process.env.P2P_BRIDGE_LOGINS ?? '') {
	const bridges = configured.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
	return !!who && bridges.includes(who.login.toLowerCase());
}

/** Resolves each publish claim's source link to an indexed record id (or its detected id) in one query. */
async function resolveRecords(db: Db, entries: readonly ClaimEntry[]): Promise<Map<string, string | null>> {
	const detected = new Map<string, string>();
	for (const { claim } of entries) {
		if (claim.kind !== 'publish' || typeof claim.data.source !== 'string' || !looksLikeLink(claim.data.source)) continue;
		const src = claim.data.source.trim();
		if (detected.has(src)) continue;
		const hit = detect(src);
		detected.set(src, hit ? `${hit.source.name}/${hit.key}` : '');
	}
	const out = new Map<string, string | null>();
	if (!detected.size) return out;
	const ids = [...new Set([...detected.values()].filter(Boolean))];
	const urls = [...new Set([...detected.keys()].map((s) => s.toLowerCase()))];
	const listed = (await db.query<{ id: string; url: string | null; repo: string | null }>(
		"SELECT id, lower(url) AS url, lower(record->>'repo') AS repo FROM open_index.records WHERE id = ANY($1::text[]) OR lower(url) = ANY($2::text[]) OR lower(record->>'repo') = ANY($2::text[])",
		[ids, urls])).rows;
	const byId = new Set(listed.map((r) => r.id));
	const byUrl = new Map<string, string>(), byRepo = new Map<string, string>();
	for (const r of listed) {
		if (r.url && !byUrl.has(r.url)) byUrl.set(r.url, r.id);
		if (r.repo && !byRepo.has(r.repo)) byRepo.set(r.repo, r.id);
	}
	for (const [src, id] of detected) {
		const lower = src.toLowerCase();
		out.set(src, (id && byId.has(id) ? id : null) ?? byUrl.get(lower) ?? byRepo.get(lower) ?? (id || null));
	}
	return out;
}

const MAX_WANTED = 50;

/**
 * Stores the claims the site does not hold yet, and the file lists of snapshots that a version names. Nothing is
 * changed afterwards: the first copy of a claim, and the first list of a snapshot, stay. `wanted` names the
 * versions whose list is still missing, for the bridge to send if its client holds them.
 */
export async function store(db: Db, { entries, snapshots = [] }: Batch, by: Voter) {
	const records = await resolveRecords(db, entries);
	const rows = entries.map(({ id, author, micros, claim }) => ({
		id, author, micros, kind: claim.kind, agent: claim.agent ?? null, refs: claim.refs, data: claim.data,
		snapshot: typeof claim.data.snapshot === 'string' ? claim.data.snapshot : null,
		record_id: claim.kind === 'publish' && typeof claim.data.source === 'string' ? (records.get(claim.data.source.trim()) ?? null) : null,
	}));
	const added = (await db.query(
		`INSERT INTO open_index.claims (id, author, at_micros, kind, agent, refs, data, snapshot, record_id, received_from)
		 SELECT e->>'id', e->>'author', (e->>'micros')::bigint, e->>'kind', e->>'agent', ARRAY(SELECT jsonb_array_elements_text(e->'refs')),
		        e->'data', e->>'snapshot', e->>'record_id', $2
		 FROM jsonb_array_elements($1::jsonb) e ON CONFLICT (id) DO NOTHING RETURNING id`,
		[rows, by.login])).rows.length; // the rows, not their JSON text: postgres.js would encode a string again, as one jsonb string
	if (snapshots.length) await db.query(
		`INSERT INTO open_index.snapshots (hash, files, received_from)
		 SELECT s->>'hash', s->'files', $2 FROM jsonb_array_elements($1::jsonb) s
		 WHERE EXISTS (SELECT 1 FROM open_index.claims c WHERE c.kind = 'publish' AND c.snapshot = s->>'hash')
		 ON CONFLICT (hash) DO NOTHING`, [snapshots, by.login]);
	// A list nobody can supply is asked for during a week, not for ever.
	const wanted = (await db.query<{ id: string }>(
		`SELECT c.id FROM open_index.claims c
		 WHERE c.kind = 'publish' AND c.received_at > now() - interval '7 days' AND c.snapshot ~ '^[0-9a-f]{64}$'
		   AND NOT EXISTS (SELECT 1 FROM open_index.snapshots s WHERE s.hash = c.snapshot)
		 ORDER BY c.received_at DESC, c.id LIMIT ${MAX_WANTED}`)).rows.map((r) => r.id);
	return { stored: added, known: entries.length - added, through: entries.length ? Math.max(...entries.map((e) => e.seq)) : null, wanted };
}

// ---- What a record page shows ----

/** `current` is the first author's newest version; `earlier` one they replaced; `open` one of theirs that nothing
 * follows and that is not the newest; `fork` a version by another key, which never replaces the author's. */
export type State = 'current' | 'earlier' | 'open' | 'fork';
export type Version = {
	id: string; author: string; at: Date; state: State; snapshot: string; files: number; bytes: number;
	/** The version of this artifact it follows; null for the first. */
	after: string | null;
	/** Keys that say they hold the files. */
	holders: number;
	/** Keys whose newest check of exactly this snapshot passed, or failed. */
	pass: number; fail: number;
	/** The Lean versions those checks ran, e.g. v4.36.0. */
	lean: string[];
	/** The files, or null while the site has no list for the snapshot. */
	listing: Listing | null;
};
/** A file of a version and how it differs from the same path in the version before. A removed file is the earlier
 * version's. No mark when it is the same, or when there is nothing to compare with. */
export type FileLine = { path: string; bytes: number; change: 'added' | 'changed' | 'removed' | null };
/** `after` is the version the files are compared with: null for a first version, or while the site has no list
 * for the one before. `more` counts lines left off a long list; `unshown`, files whose names are not shown. */
export type Listing = { after: string | null; files: FileLine[]; more: number; unshown: number };
/** One research artifact: the versions that follow from a first publish claim. */
export type Artifact = { id: string; author: string; versions: Version[] };

/** A publish claim of one artifact, in the order (time, id) the client sorts by. */
type PublishRow = { id: string; author: string; at: Date; refs: string[]; root: string; snapshot: string | null; files: unknown; bytes: unknown };
/** A check claim, in the same order. */
type CheckRow = { author: string; refs: string[]; snapshot: string | null; result: string | null; toolchain: string | null };

const HEX64 = /^[0-9a-f]{64}$/;
const LEAN = /^leanprover\/lean4:(v[0-9][0-9A-Za-z.-]{0,30})$/;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
/** A file name the site shows: letters, digits and . _ + - between slashes, and no longer than a line. */
const SHOWN = /^(?=.{1,200}$)[A-Za-z0-9._+-]+(\/[A-Za-z0-9._+-]+)*$/;
const MAX_LINES = 200;

/** The lines for one version: what changed since `before` first, then the rest, each by path. */
function listing(files: readonly FileEntry[], before?: { id: string; files: readonly FileEntry[] }): Listing {
	const old = new Map(before?.files.map((f) => [f.path, f.hash]));
	const kept = new Set(files.map((f) => f.path));
	const lines: FileLine[] = [
		...files.map(({ path, bytes, hash }) => ({ path, bytes, change: !before || old.get(path) === hash ? null : old.has(path) ? 'changed' as const : 'added' as const })),
		...(before?.files ?? []).filter((f) => !kept.has(f.path)).map(({ path, bytes }) => ({ path, bytes, change: 'removed' as const })),
	];
	const shown = lines.filter((l) => SHOWN.test(l.path))
		.sort((a, b) => Number(!a.change) - Number(!b.change) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { after: before?.id ?? null, files: shown.slice(0, MAX_LINES), more: Math.max(0, shown.length - MAX_LINES), unshown: lines.length - shown.length };
}

/**
 * The artifacts those claims make up. The rules are the client's own (src/ops.rs there, Record and tally): a
 * record's current version is its first author's newest that none of that author's versions follows, and each
 * key counts once per snapshot, with its newest verdict. `lists` holds the file lists the site has, by snapshot.
 */
function shape(publishes: readonly PublishRow[], checks: readonly CheckRow[], holders: ReadonlyMap<string, number>,
	lists: ReadonlyMap<string, readonly FileEntry[]> = new Map()): Artifact[] {
	const sound = publishes.filter((p) => p.snapshot && HEX64.test(p.snapshot) && count(p.files) && count(p.bytes));
	const order = new Map(sound.map((p, i) => [p, i]));
	const byRoot = Map.groupBy(sound, (p) => p.root);
	return [...byRoot].flatMap(([root, rows]) => {
		const byId = new Map(rows.map((q) => [q.id, q]));
		const first = byId.get(root);
		if (!first) return [];
		const own = rows.filter((p) => p.author === first.author);
		const followed = new Set(own.flatMap((p) => p.refs));
		const head = own.filter((p) => !followed.has(p.id)).sort((a, b) => order.get(b)! - order.get(a)!)[0] ?? first;
		const versions = [first, ...rows.filter((p) => p !== first)].map((p): Version => {
			// Later checks come later in the list, so a key's newest verdict is the one that stays.
			const verdicts = new Map(checks.filter((c) => c.refs.includes(p.id) && c.snapshot === p.snapshot && (c.result === 'pass' || c.result === 'fail'))
				.map((c) => [c.author, c]));
			const results = [...verdicts.values()];
			const mine = lists.get(p.snapshot!);
			// The version it follows, if the site has that one's list too.
			const parent = p.refs.map((ref) => byId.get(ref)).find((q) => q && lists.has(q.snapshot!));
			return {
				id: p.id, author: p.author, at: p.at, snapshot: p.snapshot!, files: p.files as number, bytes: p.bytes as number,
				state: p === head ? 'current' : p.author !== first.author ? 'fork' : followed.has(p.id) ? 'earlier' : 'open',
				after: p.refs.find((ref) => byId.has(ref)) ?? null,
				holders: holders.get(p.snapshot!) ?? 0,
				pass: results.filter((c) => c.result === 'pass').length, fail: results.filter((c) => c.result === 'fail').length,
				lean: [...new Set(results.flatMap((c) => c.toolchain?.match(LEAN)?.[1] ?? []))].sort(),
				listing: mine ? listing(mine, parent && { id: parent.id, files: lists.get(parent.snapshot!)! }) : null,
			};
		});
		return [{ id: root, author: first.author, versions }];
	});
}

const MAX_VERSIONS = 500, MAX_CHECKS = 5000;

/** The artifacts whose first version names `recordId` as its source, with what follows them. */
export async function artifacts(db: Db, recordId: string): Promise<Artifact[]> {
	const publishes = (await db.query<PublishRow>(
		`WITH RECURSIVE tree AS (
		   SELECT c.id, c.author, c.at_micros, c.refs, c.snapshot, c.data->'files' AS files, c.data->'bytes' AS bytes, c.id AS root
		   FROM open_index.claims c
		   WHERE c.kind = 'publish' AND c.record_id = $1
		     AND NOT EXISTS (SELECT 1 FROM open_index.claims p WHERE p.kind = 'publish' AND p.id = ANY (c.refs))
		   UNION
		   SELECT c.id, c.author, c.at_micros, c.refs, c.snapshot, c.data->'files', c.data->'bytes', t.root
		   FROM open_index.claims c JOIN tree t ON t.id = ANY (c.refs) WHERE c.kind = 'publish')
		 SELECT id, author, to_timestamp(at_micros / 1000000.0) AS at, refs, root, snapshot, files, bytes
		 FROM tree ORDER BY at_micros, id LIMIT ${MAX_VERSIONS}`, [recordId])).rows;
	if (!publishes.length) return [];
	const snapshots = publishes.flatMap((p) => p.snapshot ?? []);
	const [checks, held, lists] = await Promise.all([
		db.query<CheckRow>(
			`SELECT author, refs, snapshot, data->>'result' AS result, data->>'toolchain' AS toolchain FROM open_index.claims
			 WHERE kind = 'check' AND refs && $1::text[] ORDER BY at_micros, id LIMIT ${MAX_CHECKS}`, [publishes.map((p) => p.id)]).then((r) => r.rows),
		snapshots.length ? db.query<{ snapshot: string; n: number }>(
			`SELECT snapshot, count(DISTINCT author)::int AS n FROM open_index.claims WHERE kind = 'have' AND snapshot = ANY ($1::text[]) GROUP BY snapshot`,
			[snapshots]).then((r) => r.rows) : [],
		snapshots.length ? db.query<{ hash: string; files: FileEntry[] }>(
			'SELECT hash, files FROM open_index.snapshots WHERE hash = ANY ($1::text[])', [snapshots]).then((r) => r.rows) : [],
	]);
	return shape(publishes, checks, new Map(held.map((h) => [h.snapshot, h.n])), new Map(lists.map((l) => [l.hash, l.files])));
}

/** A size in the units people read: 512 B, 1.2 kB, 36.0 MB. */
export const size = (bytes: number) => bytes < 1e3 ? `${bytes} B` : bytes < 1e6 ? `${(bytes / 1e3).toFixed(1)} kB`
	: bytes < 1e9 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e9).toFixed(1)} GB`;

/** The first ten digits of an id or key: enough to tell two apart on a page, and a prefix the client accepts. */
export const short = (hex: string) => hex.slice(0, 10);
