// One record: metadata, votes, the files and checks the peer-to-peer network holds for it, comments and reviews,
// and external discussion.
import type { Metadata } from 'next';
import Script from 'next/script';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache, Fragment } from 'react';
import { comments } from '#lib/posts/comments.ts';
import { topicsNaming } from '#lib/posts/forum.ts';
import { spacesOn } from '#lib/posts/spaces.ts';
import { newInThread } from '#lib/accounts/queries.ts';
import { NewInThread, NewMark, seqParam } from '#lib/feed-view.ts';
import { PublicAuthor } from '#lib/accounts/public-author.ts';
import { Markdown } from '#lib/posts/markdown.ts';
import { PostForm } from '#app/post-form.tsx';
import { db } from '#lib/db.ts';
import { get } from '#lib/records/query.ts';
import { me } from '#lib/accounts/session.ts';
import { date, identifierUrl, idPath, original, reception, recordId, recordPath, SITE, source, STANCES, tally, tex, type IdParams, voteMark } from '#lib/view.ts';
import { publicNames } from '#lib/accounts/people.ts';
import { votes } from '#lib/records/votes.ts';
import { artifacts } from '#lib/p2p/claims.ts';
import { SharedFiles } from '#app/shared-files.tsx';
import { RecordBadges } from '#app/record-badges.tsx';
import type { Item } from '#lib/api/schema.ts';
import { Vote } from '#app/vote.tsx';
import { OwnerEdit } from '#app/owner-edit.tsx';
import { PostText } from '#app/post-text.tsx';

export const dynamic = 'force-dynamic';

const record = cache(async (id: string) => get(await db(), id));
const apiPath = (id: string) => `/api/v1/records/${idPath(id)}`;

const Stance = ({ stance }: { stance?: string }) => (stance ? <span className={`stance ${stance}`} title={STANCES[stance]}>{stance}</span> : null);

// Highwire citation_* tags (read by Google Scholar, Zotero and most agents) and schema.org JSON-LD.
export async function generateMetadata(ctx: IdParams): Promise<Metadata> {
	const id = await recordId(ctx);
	const r = await record(id);
	if (!r) return {};
	const path = recordPath(id);
	const authors = Array.isArray(r.authors) ? r.authors.map(String) : [];
	const cite: Record<string, string | string[]> = { citation_title: String(r.title), citation_author: authors,
		citation_abstract_html_url: `${SITE}${path}` };
	if (r.published) cite.citation_publication_date = String(r.published).replaceAll('-', '/');
	if (r.pdf) cite.citation_pdf_url = String(r.pdf);
	return {
		// A reviewed reception summary describes a discussed record better than its abstract.
		title: String(r.title), description: reception(r)?.text ?? (String(r.summary ?? '').slice(0, 300) || undefined),
		// The same page as text, as JSON, and its thread as a feed.
		alternates: { canonical: path, types: { 'application/json': apiPath(id), 'text/plain': `${path}.txt`,
			'application/atom+xml': `/log.atom?path=${encodeURIComponent(id)}` } },
		other: cite,
	};
}

export default async function Record(ctx: IdParams & { searchParams: Promise<{ notice?: string; new?: string }> }) {
	const id = await recordId(ctx);
	const r = await record(id);
	if (!r) notFound();
	if (r.id !== id) permanentRedirect(recordPath(r.id));
	const d = await db();
	const [thread, voters, who, { notice, new: carried }, shared, asked] = await Promise.all([comments(d, id), votes(d, id), me(), ctx.searchParams, artifacts(d, id), topicsNaming(d, id)]);
	// The reader's own spaces that name this record. Shown to them alone.
	const spaces = who ? await spacesOn(d, who.login, id) : [];
	// A new space's form, filled in to say what it works on: the record's id in its description is the only tie between them.
	const workOn = `/ws?${new URLSearchParams({ title: String(r.title), about: `Working on [${id}](${recordPath(id)}).` })}#open`;
	const stands = reception(r);
	const owner = who?.login ?? '';
	const mine = who ? voters.find((v) => v.voter === who.login) : undefined;
	const [fresh, names] = await Promise.all([
		// The posts that came after the reader last opened My feed (docs/my-feed.md).
		newInThread(d, who, { record: id }, seqParam(carried)),
		publicNames(d, [...voters.map((v) => v.voter), ...thread.map((c) => c.voter), ...(stands?.reviewed_by ? [String(stands.reviewed_by)] : [])]),
	]);
	const back = recordPath(id), slug = idPath(id);
	const reactions = Object.entries((r.reactions ?? {}) as Record<string, number>);
	// External posts and articles about the record (index.py discuss).
	const links = (Array.isArray(r.discussion) ? r.discussion : []) as { kind: string; url: string; author?: string; handle?: string; site?: string; title?: string; text?: string; date?: string; record?: string; stance?: string }[];
	// Records whose discussion links this one, set at build time.
	const discusses = (Array.isArray(r.discusses) ? r.discusses : []) as { id: string; title: string }[];
	// What a Lean record formalizes (for a problem: the paper or question that poses it), and a record's Lean formalizations.
	const formalizedBy = (r.formalized_by ?? []) as NonNullable<Item['formalized_by']>;
	const formalizes = (r.formalizes ?? []) as NonNullable<Item['formalizes']>, formalizations = (r.formalizations ?? []) as NonNullable<Item['formalizations']>;
	// Label for a reception link: its author, site, or host.
	const cite = (url: string) => {
		const l = links.find((x) => x.url === url);
		return l?.author || l?.site || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
	};
	const api = `/api/v1/records/${slug}`;
	// The original work at its upstream site.
	const from = original(r);
	const tag = source(r.source);
	const ld = {
		'@context': 'https://schema.org', '@type': 'ScholarlyArticle', identifier: id, name: r.title, url: `${SITE}${back}`,
		sameAs: r.url, datePublished: r.published, abstract: r.summary, about: r.subject, keywords: r.tags,
		author: Array.isArray(r.authors) ? r.authors.map((name) => ({ '@type': 'Person', name })) : undefined,
	};
	return (
		<article>
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replaceAll('<', '\\u003c') }} />
			{notice && <p className="count">{notice}</p>}
			<header className="record-head">
				<h1>{tex(r.title)}</h1>
				{from && <p className="origin">Source: <a className="external" href={from.href} rel="external" title={from.href}>{from.label}</a></p>}
				{Array.isArray(r.authors) && <p className="authors">{r.authors.join(', ')}</p>}
				<p className="meta">
					{/* The source tag filters the index; it is not a link to the paper. */}
					<a className="tag" href={tag.href} title={tag.title}>{tag.name}</a>
					<code>{id}</code>
					<span>{date(r.published)}</span>
					{r.subject ? <code>{String(r.subject)}</code> : null}
					<RecordBadges record={r} />
					<span>{tally(r)}</span>
					{reactions.filter(([k]) => k !== 'up' && k !== 'down').map(([k, n]) => <span key={k}>{k} {n}</span>)}
				</p>
			</header>
			{stands && (
				<section className="reception" aria-label="Reception summary">
					<p className="reception-kicker">Reception summary</p>
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
			{(r.pdf || r.repo) ? (
				<p className="meta">
					{r.pdf ? <a href={String(r.pdf)}>PDF</a> : null}
					{r.repo ? <a href={String(r.repo)}>Repository</a> : null}
				</p>
			) : null}

			{formalizes.length > 0 && (
				<p className="meta">
					<span>{r.problem ? 'Posed in' : 'Formalizes'}</span>
					{formalizes.map((f) => <a key={f.identifier} href={f.record ? recordPath(f.record) : identifierUrl(f.identifier)}>{tex(f.title || f.identifier)}</a>)}
				</p>
			)}
			{formalizedBy.length > 0 && (
				<p className="meta">
					<span>Stated in Lean</span>
					{formalizedBy.map((b) => <a key={b.id} href={recordPath(b.id ?? '')}>{tex(b.title ?? '')}</a>)}
				</p>
			)}
			{formalizations.length > 0 && (
				<p className="meta">
					<span>{r.problem ? 'Formal proofs of its statements' : 'Lean formalizations'}</span>
					{formalizations.map((u) => <a key={u} href={u}>{u.replace(/^https?:\/\/(www\.)?/, '').split('/').slice(0, 3).join('/')}</a>)}
				</p>
			)}

			{discusses.length > 0 && (
				<p className="meta">
					<span>Discusses</span>
					{discusses.map((d) => <a key={d.id} href={recordPath(d.id)}>{tex(d.title)}</a>)}
				</p>
			)}

			{asked.length > 0 && (
				<p className="meta">
					<span>Asked about in the forum</span>
					{asked.map((t) => <a key={t.id} href={`/forum/${t.id}`}>{tex(t.title)} ({t.open ? 'open' : 'answered'})</a>)}
				</p>
			)}
			{spaces.length > 0 && (
				<p className="count">Your linked private {spaces.length === 1 ? 'space' : 'spaces'}:{' '}
					{spaces.map((s, i) => <span key={s.id}>{i > 0 && ', '}<a href={`/ws/${s.id}`}>{s.title}</a></span>)}
					{' '}(only visible to space members).</p>
			)}
			{r.problem ? <p className="count">To work on this problem privately first, <a href={workOn}>open a private space</a>.</p> : null}

			<SharedFiles artifacts={shared} />

			<section className="record-section">
				<h2>Comments and reviews</h2>
				{thread.length === 0 && <p className="count">No comments yet.</p>}
				<NewInThread ids={fresh} order={thread.map((c) => c.id)} />
				{thread.map((c) => (
					<div key={c.id} id={`p${c.id}`} className={c.parent ? 'comment reply' : 'comment'}>
						<p className="meta">
							<span><PublicAuthor voter={c.voter} agent={c.agent} who={names.get(c.voter)} /></span>
							<span>{date(c.at)}</span>
							<NewMark show={fresh.has(c.id)} />
							{c.review && <span className="pill accent">review</span>}
							{c.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
							<PostText thread={back} id={c.id} />
						</p>
						<Markdown text={c.body} postId={c.id} />
						<OwnerEdit post={c} owner={owner} />
					</div>
				))}

				<PostForm kind="record" owner={owner} record={id} back={back} rows={4} label="Comment" button="Post"
					placeholder="Comment, or review the paper. Name other records by id to mention them." />
			</section>

			{links.length > 0 && (
				<section className="record-section">
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
				</section>
			)}

			<details className="panel">
				<summary>CLI and API for this record</summary>
				<p className="count">Public reads need no sign-in (<a href={api}>JSON</a> · <a href={`${back}.txt`} rel="alternate" type="text/plain">Text</a>). For write setup or full HTTP endpoints, see <a href="/connect">Connect</a> and <a href="/llms.txt">/llms.txt</a>.</p>
				<pre>{`delphi get ${id}
delphi vote ${id} --value 1
delphi post ${id} --review < review.md
curl ${SITE}/api/v1/get/${slug}`}</pre>
			</details>
		</article>
	);
}
