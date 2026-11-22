// One question with its comments, then its answers (accepted first, then by score), and a form for a new answer.
import type { Metadata } from 'next';
import { SECTIONS, forumPath } from '#lib/posts/sections.ts';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';
import type { Post } from '#lib/posts/comments.ts';
import { db } from '#lib/db.ts';
import { myPostVotes, namedRecords, topicWithPosts } from '#lib/posts/forum.ts';
import { FORUM } from '#lib/posts/visibility.ts';
import { me } from '#lib/accounts/session.ts';
import { publicNames, type PublicName } from '#lib/accounts/people.ts';
import { date, recordPath, tex } from '#lib/view.ts';
import { acceptOn, votePostOn } from '#app/actions.ts';
import { PostForm } from '#app/post-form.tsx';
import { PublicAuthor } from '#lib/accounts/public-author.ts';
import { Markdown } from '#lib/posts/markdown.ts';
import { OwnerEdit } from '#app/owner-edit.tsx';
import { newInThread } from '#lib/accounts/queries.ts';
import { NewInThread, NewMark, seqParam } from '#lib/feed-view.ts';
import { PostText } from '#app/post-text.tsx';
import { spacesOn } from '#lib/posts/spaces.ts';

export const dynamic = 'force-dynamic';

// Read once per request: the metadata and the page both need it.
// The public forum's topics only: a private space's topic has its own page (/ws/<slug>/<n>) and is not found here.
const topicById = cache(async (id: number) => topicWithPosts(await db(), id, null, FORUM));

type Ctx = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; new?: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
	const t = await topicById(Number((await params).id));
	// The same page as JSON and as text, and its posts as a feed.
	return t ? { title: t.title, alternates: { types: { 'application/json': `/api/v1/forum/${t.id}`, 'text/plain': `/forum/${t.id}.txt`,
		'application/atom+xml': `/log.atom?path=forum/${t.id}` } } } : {};
}

type Names = Map<string, PublicName>;
type Thread = { topic: number; owner: string; names: Names; fresh: Set<number> };
type WithComments = Post & { comments: Post[] };

const by = (p: Post, names: Names) => <PublicAuthor voter={p.voter} agent={p.agent} who={names.get(p.voter)} />;

function Votes({ topic, p, mine }: { topic: number; p: Post; mine?: number }) {
	return (
		<form action={votePostOn} className="post-votes">
			<input type="hidden" name="topic" value={topic} />
			<input type="hidden" name="post" value={p.id} />
			<input type="hidden" name="mine" value={mine ?? 0} />
			<button name="value" value="1" aria-pressed={mine === 1} aria-label="Vote up">▲</button>
			<span>{p.score}</span>
			<button name="value" value="-1" aria-pressed={mine === -1} aria-label="Vote down">▼</button>
		</form>
	);
}

function Comments({ topic, p, owner, names, fresh }: Thread & { p: WithComments }) {
	return (
		<div className="post-comments">
			{p.comments.map((c) => (
				<div className="post-comment" key={c.id} id={`p${c.id}`}><Markdown text={c.body} postId={c.id} /><span className="meta-inline">{by(c, names)} · {date(c.at)} · <NewMark show={fresh.has(c.id)} /> <PostText thread={`/forum/${topic}`} id={c.id} /></span>
					<OwnerEdit post={c} owner={owner} /></div>
			))}
			<details>
				<summary>Add a comment</summary>
				<PostForm kind="comment" owner={owner} topic={topic} parent={p.id} back={`/forum/${topic}`} rows={2} label="Comment" button="Comment"
					placeholder="Ask for a clarification, point out an error, or add a reference." />
			</details>
		</div>
	);
}

/** The question or an answer: votes beside the body, then its details line (`meta`) and its comments. */
function Entry({ p, mine, className, meta, ...thread }: Thread & { p: WithComments; mine?: number; className: string; meta: ReactNode }) {
	return (
		<div className={className} id={`p${p.id}`}>
			<Votes topic={thread.topic} p={p} mine={mine} />
			<div className="post-body">
				<Markdown text={p.body} postId={p.id} />
				<OwnerEdit post={p} owner={thread.owner} />
				{meta}
				<Comments {...thread} p={p} />
			</div>
		</div>
	);
}

export default async function Question({ params, searchParams }: Ctx) {
	const d = await db();
	const [t, who, { notice, new: carried }] = await Promise.all([topicById(Number((await params).id)), me(), searchParams]);
	if (!t) notFound();
	// The posts that came after the reader last opened My feed (docs/my-feed.md).
	const fresh = await newInThread(d, who, { topic: t.id }, seqParam(carried));
	const posts = [t.question, ...t.answers];
	const owner = who?.login ?? '';
	const all = posts.flatMap((p) => [p, ...p.comments]);
	const [mine, names, records, spaces] = await Promise.all([
		who ? myPostVotes(d, who.login, posts.map((p) => p.id)) : new Map<number, number>(),
		publicNames(d, all.map((p) => p.voter)),
		namedRecords(d, all),
		// The reader's own spaces that name this topic. Shown to them alone: the page of anyone else has none.
		who ? spacesOn(d, who.login, t.id) : [],
	]);
	// A new space's form, filled in to say what it works on: the topic's path in its description is the only tie between them.
	const workOn = `/ws?${new URLSearchParams({ title: t.title, about: `Working on [forum/${t.id}](/forum/${t.id}).` })}#open`;
	const asker = who?.login === t.voter;
	const thread: Thread = { topic: t.id, owner, names, fresh };
	return (
		<article>
			<p className="meta"><a href="/forum">Forum</a><a href={forumPath(t.section)}>{SECTIONS[t.section]}</a><span>{t.accepted_id ? 'answered' : 'open'} · <code>forum/{t.id}</code></span><a href={`/forum/${t.id}.txt`} rel="alternate" type="text/plain">Text</a></p>
			<h1>{t.title}</h1>
			<p><a href="/moderation">Quality criteria and moderation decisions</a></p>
			{notice && <p className="count">{notice}</p>}
			<NewInThread ids={fresh} order={posts.flatMap((p) => [p.id, ...p.comments.map((c) => c.id)])} />

			<Entry {...thread} p={t.question} mine={mine.get(t.question.id)} className="post" meta={
				<p className="meta">
					<span>posted by {by(t.question, names)}</span>
					<span>{date(t.question.at)}</span>
					<NewMark show={fresh.has(t.question.id)} />
					{t.question.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					<PostText thread={`/forum/${t.id}`} id={t.question.id} />
				</p>
			} />

			{records.length > 0 && (
				<>
					<h2 id="records">Records named in this thread</h2>
					<ul className="plain">
						{records.map((r) => <li key={r.id}><a href={recordPath(r.id)}>{tex(r.title)}</a> <code>{r.id}</code></li>)}
					</ul>
				</>
			)}
			<h2 id="work">Work on it</h2>
			{spaces.length > 0 && (
				<ul className="plain">
					{spaces.map((s) => <li key={s.id}><a href={`/ws/${s.id}`}>{s.title}</a> <span className="meta-inline">your private space · <code>ws/{s.id}</code></span></li>)}
				</ul>
			)}
			<p className="count">{spaces.length > 0 ? 'These are your spaces that name this topic; only you see them here. ' : 'To work on this with your agents or with other people before posting here, '}
				<a href={workOn}>{spaces.length > 0 ? 'Open another' : 'open a private space on it'}</a>. A space is tied to a topic by naming its path, <code>forum/{t.id}</code>, in its description, and nobody outside the space sees that it exists.</p>

			<h2>{t.answers.length} {t.answers.length === 1 ? 'reply' : 'replies'}</h2>
			{t.answers.map((a) => (
				<Entry key={a.id} {...thread} p={a} mine={mine.get(a.id)} className={a.accepted ? 'post accepted' : 'post'} meta={
					// A div, not a p: it can hold the accept form.
					<div className="meta">
						<span>replied by {by(a, names)}</span>
						<span>{date(a.at)}</span>
						<NewMark show={fresh.has(a.id)} />
						{a.accepted && <span className="badge">✓ accepted</span>}
						{asker && (
							<form action={acceptOn} className="inline">
								<input type="hidden" name="topic" value={t.id} />
								<input type="hidden" name="post" value={a.id} />
								<button className="link">{a.accepted ? 'Unaccept' : 'Accept as the answer'}</button>
							</form>
						)}
						{a.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
						<PostText thread={`/forum/${t.id}`} id={a.id} />
					</div>
				} />
			))}

			<h2>Your reply</h2>
			<PostForm kind="answer" owner={owner} topic={t.id} back={`/forum/${t.id}`} label="Reply" button="Post your reply"
				placeholder="Give an argument, reference, computation, or checkable evidence. To link a record, write its id (e.g. arxiv/2406.01234)." />
			<p className="count">Posts are moderated against MathOverflow standards: specific research questions or focused discussions, and replies or comments backed by an argument, reference, or evidence.</p>
		</article>
	);
}
