// One record: what it is, where it lives, its votes, its comments and reviews, and what was said about it elsewhere.
import type { Metadata } from 'next';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { comments } from '../../../../lib/comments.ts';
import { db } from '../../../../lib/db.ts';
import { get } from '../../../../lib/query.ts';
import { me } from '../../../../lib/session.ts';
import { date, idPath, recordId, recordPath, SITE, source, tally, tex, type IdParams } from '../../../../lib/view.ts';
import { myVotes, votes } from '../../../../lib/votes.ts';
import { commentOn } from '../../../actions.ts';
import { Vote } from '../../../vote.tsx';

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

export default async function Record(ctx: IdParams & { searchParams: Promise<{ notice?: string }> }) {
	const id = await recordId(ctx);
	const r = await record(id);
	if (!r) notFound();
	const thread = (await comments(await db(), id)) as { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; mentions: string[] }[];
	const { notice } = await ctx.searchParams;
	const voters = await votes(await db(), id);
	const who = await me();
	const mine = who ? (await myVotes(await db(), who.login, [id])).get(id) : undefined;
	const back = recordPath(id);
	const reactions = Object.entries((r.reactions ?? {}) as Record<string, number>);
	// Posts and articles about the record, read from X's oEmbed or the page's Open Graph tags (index.py discuss).
	const links = (Array.isArray(r.discussion) ? r.discussion : []) as { kind: string; url: string; author?: string; handle?: string; site?: string; title?: string; text?: string; date?: string; record?: string }[];
	// Records whose discussion names this one (a response to a manuscript, say): the reverse of the above, set at build time.
	const discusses = (Array.isArray(r.discusses) ? r.discusses : []) as { id: string; title: string }[];
	const api = `/api/v1/records/${idPath(id)}`;
	const ld = {
		'@context': 'https://schema.org', '@type': 'ScholarlyArticle', identifier: id, name: r.title, url: `${SITE}${recordPath(id)}`,
		sameAs: r.url, datePublished: r.published, abstract: r.summary, about: r.subject, keywords: r.tags,
		author: Array.isArray(r.authors) ? r.authors.map((name) => ({ '@type': 'Person', name })) : undefined,
	};
	return (
		<article>
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replaceAll('<', '\\u003c') }} />
			{notice && <p className="count">{notice}</p>}
			<h1>{tex(r.title)}</h1>
			{Array.isArray(r.authors) && <p className="authors">{r.authors.join(', ')}</p>}
			<p className="meta">
				<a href={source(r.source).href}>{source(r.source).name}</a>
				<code>{id}</code>
				<span>{date(r.published)}</span>
				{r.subject ? <code>{String(r.subject)}</code> : null}
				{r.origin === 'ai-generated' && <span>AI-generated</span>}
				{r.withdrawn ? <span>withdrawn</span> : null}
				<span>{tally(r)}</span>
				{reactions.filter(([k]) => k !== 'up' && k !== 'down').map(([k, n]) => <span key={k}>{k} {n}</span>)}
			</p>
			<Vote id={id} reactions={r.reactions} mine={mine?.value} back={back} />
			{voters.length > 0 && (
				<ul className="voters">
					{voters.map((v) => (
						<li key={v.voter}>
							<span className="meta">
								<span>{v.value === 1 ? '▲' : v.value === -1 ? '▼' : ''}{v.emoji ? ` ${v.emoji}` : ''}</span>
								<a href={`https://github.com/${v.voter}`}>@{v.voter}</a>
								{v.agent ? <span>via {v.agent}</span> : null}
								<span>{date(v.at)}</span>
							</span>
							{v.note ? <p>{v.note}</p> : null}
						</li>
					))}
				</ul>
			)}
			{r.summary ? <p className="abstract">{tex(r.summary)}</p> : null}
			<p className="meta">
				<a href={String(r.url)}>Source</a>
				{r.pdf ? <a href={String(r.pdf)}>PDF</a> : null}
				{r.repo ? <a href={String(r.repo)}>Repository</a> : null}
				<a href={api}>JSON</a>
			</p>

			{discusses.length > 0 && (
				<p className="meta">
					<span>Discusses</span>
					{discusses.map((d) => <a key={d.id} href={recordPath(d.id)}>{tex(d.title)}</a>)}
				</p>
			)}

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

			<form action={commentOn} className="comment-form">
				<input type="hidden" name="id" value={id} />
				<input type="hidden" name="back" value={back} />
				<textarea name="body" rows={4} maxLength={4000} required placeholder={who ? 'Comment, or review the paper. Name other records by id to mention them.' : 'Sign in with GitHub to comment.'} aria-label="Comment" />
				<label><input type="checkbox" name="review" /> This is a review</label>
				<button>{who ? 'Post' : 'Sign in and post'}</button>
			</form>

			{links.length > 0 && (
				<>
					<h2>Discussed elsewhere</h2>
					{links.map((l) => l.kind === 'x' ? (
						// X's own embed markup: widgets.js turns it into the card, and leaves it as text if the post is gone.
						<blockquote key={l.url} className="twitter-tweet" data-dnt="true">
							<p>{l.text}</p>— {l.author} (@{l.handle}) <a href={l.url}>{date(l.date)}</a>
						</blockquote>
					) : (
						<div key={l.url} className="comment">
							<p className="meta">
								<a href={l.url}>{l.title || l.url}</a>
								{l.site ? <span>{l.site}</span> : null}
								{l.author ? <span>{l.author}</span> : null}
								<span>{date(l.date)}</span>
								{l.record ? <a href={recordPath(l.record)}>in the index</a> : null}
							</p>
							{l.text ? <p>{l.text}</p> : null}
						</div>
					))}
					{links.some((l) => l.kind === 'x') && <Script src="https://platform.twitter.com/widgets.js" strategy="lazyOnload" />}
				</>
			)}

			<h2>API</h2>
			<pre>{`curl ${api}
curl -X POST ${api}/vote -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"value": 1, "emoji": "🤔", "note": "optional"}'
curl -X POST ${api}/comments -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"body": "…", "review": true}'`}</pre>
		</article>
	);
}
