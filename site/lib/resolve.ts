// Reading a submitted link's metadata from its source, so it is listed the moment it is submitted. The
// same rules as the harvester's adapters (sources.py), for the sources the site reads at once: arXiv,
// GitHub, DOI, Zenodo and Hugging Face. Ids and fields match what `index.py add` writes, so the daily
// pull, which files every submission into entries/, updates the same record instead of adding another.
// Every other link waits for that pull, which knows all the sources.
import taxonomy from './taxonomy.json' with { type: 'json' };
import type { Item } from './load.ts';

export class NotFound extends Error {}

const USER_AGENT = 'open-research-index/0.1 (+https://github.com/LionSR/open-research-index; metadata only)';
const SUMMARY_CHARS = 600;

// Links the harvester reads with its own adapters, though they look like GitHub or DOI links. They wait.
const DAILY = [
	/^(?:https?:\/\/)?github\.com\/SakanaAI\/AI-Scientist\/(?:blob|tree)\/main\/example_papers\//i,
	/^(?:https?:\/\/)?github\.com\/openai\/math\/(?:blob|tree)\/main\/preprints\//i,
	/^(?:https?:\/\/)?github\.com\/[\w.-]+\/[\w.-]+\/blob\/[^/]+\/(?:[\w./-]+?\/)?formalization\.yaml$/i,
];

type Fetcher = typeof fetch;
type Source = { name: string; patterns: RegExp[]; key?: (m: RegExpMatchArray) => string; read: (key: string, get: Get) => Promise<Item> };
type Get = (url: string, accept?: string) => Promise<Response>;

// ---- Text, as sources.py cleans it ----

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const clean = (text: unknown) =>
	String(text ?? '').replace(/<[^>]+>/g, ' ')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#'
			? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
			: ENTITIES[e.toLowerCase()] ?? m)
		.replace(/\s+/g, ' ').trim();
export function trim(text: unknown, n = SUMMARY_CHARS) {
	const t = clean(text);
	return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}
const isoDate = (text: unknown) => String(text ?? '').match(/(\d{4})[-/](\d{2})[-/](\d{2})/)?.slice(1).join('-') ?? '';
const SUBJECTS = taxonomy.names as Record<string, string>;
function subject(domain: string) {
	if (!(domain in SUBJECTS)) return {};
	const division = taxonomy.divisions.find((d) => d.prefixes.some((p) => domain === p || domain.startsWith(`${p}.`) || domain.startsWith(`${p}-`)))?.key ?? 'other';
	return { subject: domain, division };
}

/** An item as the build serves it (index.py to_item): empty fields left out, unlabelled until the daily pull. */
function item(source: string, key: string, f: Record<string, unknown>): Item {
	if (!clean(f.title)) throw new NotFound(`${source}/${key} has no title`);
	const out: Record<string, unknown> = { id: `${source}/${key}`, source, ...f, category: 'research', ...subject(String(f.domain ?? '')) };
	for (const [k, v] of Object.entries(out)) if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) delete out[k];
	if (Array.isArray(out.tags)) out.tags = [...new Set(out.tags.map(String))].slice(0, 10);
	return out as Item;
}

// ---- The sources ----

const xml = (s: string, tag: string) => [...s.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);

const SOURCES: Source[] = [
	{
		name: 'arxiv',
		patterns: [/^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?\/?$/, /^(?:arXiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/],
		async read(key, get) {
			const feed = await (await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(key)}`)).text();
			const e = xml(feed, 'entry').find((x) => xml(x, 'title').length);
			if (!e) throw new NotFound(`arXiv:${key}`);
			const id = (xml(e, 'id')[0] ?? '').trim().split('/abs/').pop()!.replace(/v\d+$/, '');
			const domain = e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? '';
			return item('arxiv', id, {
				url: `https://arxiv.org/abs/${id}`, title: clean(xml(e, 'title')[0]),
				authors: xml(e, 'author').map((a) => clean(xml(a, 'name')[0])).filter(Boolean), summary: trim(xml(e, 'summary')[0]), domain,
				tags: [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]), published: isoDate(xml(e, 'published')[0]),
			});
		},
	},
	{
		name: 'zenodo',
		patterns: [/^(?:https?:\/\/)?zenodo\.org\/(?:records?|doi\/10\.5281\/zenodo\.)\/?(\d+)/, /^(?:https?:\/\/doi\.org\/)?10\.5281\/zenodo\.(\d+)$/],
		async read(key, get) {
			const d = await (await get(`https://zenodo.org/api/records/${key}`, 'application/json')).json();
			const m = d.metadata ?? {};
			return item('zenodo', String(d.id), {
				url: d.links?.self_html ?? `https://zenodo.org/records/${d.id}`, title: clean(m.title),
				authors: (m.creators ?? []).map((c: { name?: string }) => clean(c.name)).filter(Boolean), summary: trim(m.description),
				tags: m.keywords ?? [], domain: m.resource_type?.type ?? '', published: isoDate(m.publication_date),
			});
		},
	},
	{
		name: 'huggingface',
		patterns: [/^(?:https?:\/\/)?huggingface\.co\/((?:datasets\/|spaces\/)?[\w.-]+\/[\w.-]+)\/?$/],
		key: (m) => {
			const kind = /^(datasets|spaces)\//.exec(m[1])?.[1] ?? 'models';
			return `${kind}__${m[1].replace(`${kind}/`, '').replace('/', '__')}`;
		},
		async read(key, get) {
			const [kind, rest] = [key.slice(0, key.indexOf('__')), key.slice(key.indexOf('__') + 2)];
			const repo = rest.replace('__', '/');
			const d = await (await get(`https://huggingface.co/api/${kind}/${repo}`, 'application/json')).json();
			return item('huggingface', key, {
				url: `https://huggingface.co/${kind === 'models' ? '' : `${kind}/`}${repo}`, title: repo.split('/').pop()!.replaceAll('-', ' '),
				authors: [d.author ?? repo.split('/')[0]], summary: trim(d.cardData?.description ?? (typeof d.description === 'string' ? d.description : '')),
				tags: (d.tags ?? []).filter((t: string) => !t.includes(':')).slice(0, 12), domain: kind.replace(/s$/, ''), published: isoDate(d.createdAt),
			});
		},
	},
	{
		name: 'github',
		patterns: [/^(?:https?:\/\/)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/.*)?$/, /^(?!10\.\d)([\w.-]+\/[\w.-]+)$/],
		key: (m) => m[1].replace('/', '__'),
		async read(key, get) {
			const d = await (await get(`https://api.github.com/repos/${key.replace('__', '/')}`, 'application/vnd.github+json')).json();
			if (d.private) throw new NotFound(key);
			const files = await get(`https://api.github.com/repos/${d.full_name}/contents/`, 'application/vnd.github+json')
				.then(async (r) => new Set<string>((await r.json()).map((f: { name: string }) => f.name)), () => new Set<string>());
			return item('github', d.full_name.replace('/', '__'), {
				url: d.html_url, repo: d.html_url, title: String(d.name).replace(/[-_]/g, ' '), authors: [d.owner?.login],
				summary: trim(d.description), tags: d.topics ?? [], published: isoDate(d.created_at), stars: d.stargazers_count ?? 0,
				agent_ready: files.has('AGENTS.md') || files.has('CLAUDE.md'),
			});
		},
	},
	{
		name: 'doi',
		patterns: [/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?(10\.\d{4,9}\/\S+)$/],
		key: (m) => m[1].replaceAll('/', '__'),
		async read(key, get) {
			const doi = key.replaceAll('__', '/');
			const d = await (await get(`https://doi.org/${encodeURI(doi)}`, 'application/vnd.citationstyles.csl+json')).json();
			const parts: number[] = d.issued?.['date-parts']?.[0] ?? [];
			return item('doi', key, {
				url: `https://doi.org/${doi}`, title: clean(Array.isArray(d.title) ? d.title[0] : d.title),
				authors: (d.author ?? []).map((a: { given?: string; family?: string; literal?: string }) => clean(`${a.given ?? ''} ${a.family ?? ''}`) || clean(a.literal)),
				summary: trim(d.abstract), domain: d.type ?? '',
				published: parts.length === 3 ? parts.map((p) => String(p).padStart(2, '0')).join('-') : '',
			});
		},
	},
];

/** The record id a link would have, if the site reads its source at once; null if it waits for the daily pull. */
export function detect(link: string): { source: Source; key: string } | null {
	const url = link.trim();
	if (DAILY.some((p) => p.test(url))) return null;
	for (const source of SOURCES) {
		for (const p of source.patterns) {
			const m = url.match(p);
			if (m) return { source, key: source.key ? source.key(m) : m[1] };
		}
	}
	return null;
}

/** A link worth keeping for the daily pull: a URL or a bare id (arXiv, DOI, owner/repo, PALOMAR-…), one word. */
export const looksLikeLink = (link: string) => /^\S{1,2000}$/.test(link.trim());

/** Reads the record from its source. Throws NotFound when it does not exist or is not public. */
export async function resolve(link: string, fetcher: Fetcher = fetch): Promise<Item | null> {
	const hit = detect(link);
	if (!hit) return null;
	const get: Get = async (url, accept) => {
		const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...(accept ? { Accept: accept } : {}) };
		if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		const r = await fetcher(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
		if (r.status === 404 || r.status === 410) throw new NotFound(url);
		if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
		return r;
	};
	return hit.source.read(hit.key, get);
}
