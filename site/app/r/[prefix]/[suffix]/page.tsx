// One record: metadata, votes, comments and reviews, and external discussion.
import type { Metadata } from 'next';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { cache, Fragment } from 'react';
import { comments } from '../../../../lib/posts/comments.ts';
import { PublicAuthor } from '../../../../lib/accounts/public-author.ts';
import { Markdown } from '../../../../lib/posts/markdown.ts';
import { PostForm } from '../../../post-form.tsx';
import { db } from '../../../../lib/db.ts';
import { get } from '../../../../lib/records/query.ts';
import { me } from '../../../../lib/accounts/session.ts';
import { date, idPath, reception, recordId, recordPath, SITE, source, STANCES, tally, tex, type IdParams, voteMark } from '../../../../lib/view.ts';
import { publicNames } from '../../../../lib/accounts/people.ts';
import { myVotes, votes } from '../../../../lib/records/votes.ts';
import { Vote } from '../../../vote.tsx';
import { EditPost } from '../../../edit-post.tsx';

export const dynamic = 'force-dynamic';

const record = cache(async (id: string) => get(await db(), id));

const Stance = ({ stance }: { stance?: string }) => (stance ? <span className={`stance ${stance}`} title={STANCES[stance]}>{stance}</span> : null);

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
		// A reviewed reception summary describes a discussed record better than its abstract.
		title: String(r.title), description: reception(r)?.text ?? (String(r.summary ?? '').slice(0, 300) || undefined),
		alternates: { canonical: recordPath(id), types: { 'application/json': `/api/v1/records/${idPath(id)}` } },
		other: cite,
	};
}

export default async function Record(ctx: IdParams & { searchParams: Promise<{ notice?: string }> }) {
	const id = await recordId(ctx);
	const r = await record(id);
	if (!r) notFound();
	const d = await db();
	const thread = await comments(d, id);
	const { notice } = await ctx.searchParams;
	const voters = await votes(d, id);
	const names = await publicNames(d, [...voters.map((v) => v.voter), ...thread.map((c) => c.voter), ...(reception(r)?.reviewed_by ? [String(reception(r)!.reviewed_by)] : [])]);
	const who = await me();
	const mine = who ? (await myVotes(d, who.login, [id])).get(id) : undefined;
	const back = recordPath(id);
	const reactions = Object.entries((r.reactions ?? {}) as Record<string, number>);
	// External posts and articles about the record (index.py discuss).
	const links = (Array.isArray(r.discussion) ? r.discussion : []) as { kind: string; url: string; author?: string; handle?: string; site?: string; title?: string; text?: string; date?: string; record?: string; stance?: string }[];
	// Records whose discussion links this one, set at build time.
	const discusses = (Array.isArray(r.discusses) ? r.discusses : []) as { id: string; title: string }[];
	const stands = reception(r);
	// Label for a reception link: its author, site, or host.
	const cite = (url: string) => {
		const l = links.find((x) => x.url === url);
		return l?.author || l?.site || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
	};
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
			{stands && (
				<section className="reception" aria-label="Where it stands">
					<p>{stands.text}</p>
					<p className="meta">
						<span>{date(stands.written)}</span>
						{stands.reviewed_by ? <span>reviewed by <PublicAuthor voter={stands.reviewed_by} who={names.get(stands.reviewed_by)} /></span> : null}
						{(stands.links ?? []).map((u) => <a key={u} href={u}>{cite(u)}</a>)}
					</p>
				</section>
			)}
			<Vote id={id} reactions={r.reactions} mine={mine?.value} back={back} />
			{voters.length > 0 && (
				<ul className="voters">
					{voters.map((v) => (
						<li key={v.voter}>
							<span className="meta">
								<span>{voteMark(v.value)}{v.emoji ? ` ${v.emoji}` : ''}</span>
								<span><PublicAuthor voter={v.voter} agent={v.agent} who={names.get(v.voter)} /></span>
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
				<div key={c.id} id={`p${c.id}`} className={c.parent ? 'comment reply' : 'comment'}>
					<p className="meta">
						<span><PublicAuthor voter={c.voter} agent={c.agent} who={names.get(c.voter)} /></span>
						<span>{date(c.at)}</span>
						{c.review && <span>review</span>}
						{c.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					</p>
					<Markdown text={c.body} postId={c.id} />
					{who?.login === c.voter && <EditPost key={who.login} id={c.id} owner={who.login} body={c.body} revision={c.revision} />}
				</div>
			))}

			<PostForm kind="record" owner={who?.login ?? ''} record={id} back={back} rows={4} label="Comment" button="Post"
				placeholder="Comment, or review the paper. Name other records by id to mention them." />

			{links.length > 0 && (
				<>
					<h2>Discussed elsewhere</h2>
					{links.map((l) => l.kind === 'x' ? (
						<Fragment key={l.url}>
							{l.stance ? <p className="meta"><Stance stance={l.stance} /></p> : null}
							{/* widgets.js turns this into an embedded post; without it only author and date show. */}
							<blockquote className="twitter-tweet" data-dnt="true">
								— {l.author} (@{l.handle}) <a href={l.url}>{date(l.date) || 'Post on X'}</a>
							</blockquote>
						</Fragment>
					) : (
						<div key={l.url} className="comment">
							<p className="meta">
								<Stance stance={l.stance} />
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
