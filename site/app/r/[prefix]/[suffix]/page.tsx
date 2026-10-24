// One record: what it is, where it lives, its votes, and its comments and reviews.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { comments } from '../../../../lib/comments.ts';
import { db } from '../../../../lib/db.ts';
import { get } from '../../../../lib/query.ts';
import { date, idPath, recordId, recordPath, SITE, tally, tex, type IdParams } from '../../../../lib/view.ts';

export const dynamic = 'force-dynamic';

const record = cache(async (id: string) => get(await db(), id));

// Highwire citation_* tags (read by Google Scholar, Zotero and most agents) and schema.org JSON-LD.
export async function generateMetadata(ctx: IdParams): Promise<Metadata> {
	const id = await recordId(ctx);
	const r = await record(id);
	if (!r) return {};
	const authors = Array.isArray(r.authors) ? r.authors.map(String) : [];
	const cite: Record<string, string | string[]> = { citation_title: String(r.title), citation_author: authors,
		citation_abstract_html_url: `${SITE}${recordPath(id)}` };
	if (r.published) cite.citation_publication_date = String(r.published).replaceAll('-', '/');
	if (r.pdf) cite.citation_pdf_url = String(r.pdf);
	return {
		title: String(r.title), description: String(r.summary ?? '').slice(0, 300) || undefined,
		alternates: { canonical: recordPath(id), types: { 'application/json': `/api/v1/records/${idPath(id)}` } },
		other: cite,
	};
}

export default async function Record(ctx: IdParams) {
	const id = await recordId(ctx);
	const r = await record(id);
	if (!r) notFound();
	const thread = (await comments(await db(), id)) as { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; mentions: string[] }[];
	const reactions = Object.entries((r.reactions ?? {}) as Record<string, number>);
	const api = `/api/v1/records/${idPath(id)}`;
	const ld = {
		'@context': 'https://schema.org', '@type': 'ScholarlyArticle', identifier: id, name: r.title, url: `${SITE}${recordPath(id)}`,
		sameAs: r.url, datePublished: r.published, abstract: r.summary, about: r.subject, keywords: r.tags,
		author: Array.isArray(r.authors) ? r.authors.map((name) => ({ '@type': 'Person', name })) : undefined,
	};
	return (
		<article>
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replaceAll('<', '\\u003c') }} />
			<h1>{tex(r.title)}</h1>
			{Array.isArray(r.authors) && <p className="authors">{r.authors.join(', ')}</p>}
			<p className="meta">
				<code>{id}</code>
				<span>{date(r.published)}</span>
				{r.subject ? <code>{String(r.subject)}</code> : null}
				{r.origin === 'ai-generated' && <span>AI-generated</span>}
				{r.withdrawn ? <span>withdrawn</span> : null}
				<span>{tally(r)}</span>
				{reactions.map(([k, n]) => <span key={k}>{k === 'up' ? '👍' : k === 'down' ? '👎' : k} {n}</span>)}
			</p>
			{r.summary ? <p className="abstract">{tex(r.summary)}</p> : null}
			<p className="meta">
				<a href={String(r.url)}>Source</a>
				{r.pdf ? <a href={String(r.pdf)}>PDF</a> : null}
				{r.repo ? <a href={String(r.repo)}>Repository</a> : null}
				<a href={api}>JSON</a>
			</p>

			<h2>Comments and reviews</h2>
			{thread.length === 0 && <p className="count">No comments yet.</p>}
			{thread.map((c) => (
				<div key={c.id} className={c.parent ? 'comment reply' : 'comment'}>
					<p className="meta">
						<span>@{c.voter}{c.agent ? ` via ${c.agent}` : ''}</span>
						<span>{date(c.at)}</span>
						{c.review && <span>review</span>}
						{c.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					</p>
					<p>{c.body}</p>
				</div>
			))}

			<h2>API</h2>
			<pre>{`curl ${api}
curl -X POST ${api}/vote -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"value": 1, "emoji": "🤔", "note": "optional"}'
curl -X POST ${api}/comments -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"body": "…", "review": true}'`}</pre>
		</article>
	);
}
