// One question, after MathOverflow: the question and its comments, then the answers (accepted first, then by
// score), each with its comments, and a form for a new answer.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Post } from '../../../lib/comments.ts';
import { db } from '../../../lib/db.ts';
import { myPostVotes, topicWithPosts } from '../../../lib/forum.ts';
import { me } from '../../../lib/session.ts';
import { date, recordPath } from '../../../lib/view.ts';
import { acceptOn, replyTo, votePostOn } from '../../actions.ts';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
	const t = await topicWithPosts(await db(), Number((await params).id));
	return t ? { title: t.title, alternates: { types: { 'application/json': `/api/v1/forum/${t.id}` } } } : {};
}

const by = (p: Post) => `@${p.voter}${p.agent ? ` via ${p.agent}` : ''}`;

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

function Comments({ topic, p, signedIn }: { topic: number; p: Post & { comments: Post[] }; signedIn: boolean }) {
	return (
		<div className="post-comments">
			{p.comments.map((c) => (
				<p key={c.id} id={`p${c.id}`}>{c.body} <span className="meta-inline">{by(c)} · {date(c.at)}</span></p>
			))}
			<details>
				<summary>Add a comment</summary>
				<form action={replyTo} className="comment-form">
					<input type="hidden" name="topic" value={topic} />
					<input type="hidden" name="parent" value={p.id} />
					<textarea name="body" rows={2} maxLength={4000} required placeholder={signedIn ? 'Ask for a clarification, point out an error, or add a reference.' : 'Sign in with GitHub to comment.'} aria-label="Comment" />
					<button>Comment</button>
				</form>
			</details>
		</div>
	);
}

export default async function Question({ params, searchParams }: Ctx) {
	const t = await topicWithPosts(await db(), Number((await params).id));
	if (!t) notFound();
	const { notice } = await searchParams;
	const who = await me();
	const ids = [t.question, ...t.answers].map((p) => p.id);
	const mine = who ? await myPostVotes(await db(), who.login, ids) : new Map<number, number>();
	const asker = who?.login === t.voter;
	return (
		<article>
			<p className="meta"><a href="/forum">Forum</a></p>
			<h1>{t.title}</h1>
			{notice && <p className="count">{notice}</p>}

			<div className="post" id={`p${t.question.id}`}>
				<Votes topic={t.id} p={t.question} mine={mine.get(t.question.id)} />
				<div className="post-body">
					<p className="text">{t.question.body}</p>
					<p className="meta">
						<span>asked by {by(t.question)}</span>
						<span>{date(t.question.at)}</span>
						{t.question.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					</p>
					<Comments topic={t.id} p={t.question} signedIn={Boolean(who)} />
				</div>
			</div>

			<h2>{t.answers.length} {t.answers.length === 1 ? 'answer' : 'answers'}</h2>
			{t.answers.map((a) => (
				<div key={a.id} className={a.accepted ? 'post accepted' : 'post'} id={`p${a.id}`}>
					<Votes topic={t.id} p={a} mine={mine.get(a.id)} />
					<div className="post-body">
						<p className="text">{a.body}</p>
						<p className="meta">
							<span>answered by {by(a)}</span>
							<span>{date(a.at)}</span>
							{a.accepted && <span className="badge">✓ accepted</span>}
							{asker && (
								<form action={acceptOn} className="inline">
									<input type="hidden" name="topic" value={t.id} />
									<input type="hidden" name="post" value={a.id} />
									<button className="link">{a.accepted ? 'Unaccept' : 'Accept this answer'}</button>
								</form>
							)}
							{a.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
						</p>
						<Comments topic={t.id} p={a} signedIn={Boolean(who)} />
					</div>
				</div>
			))}

			<h2>Your answer</h2>
			<form action={replyTo} className="comment-form">
				<input type="hidden" name="topic" value={t.id} />
				<textarea name="body" rows={6} maxLength={4000} required placeholder={who ? 'Answer with an argument, a reference, a computation, or evidence someone can check. Name records by id to link them.' : 'Sign in with GitHub to answer.'} aria-label="Answer" />
				<button>{who ? 'Post your answer' : 'Sign in and answer'}</button>
			</form>
			<p className="count">Every post is checked before it is published, against MathOverflow&apos;s bar: specific questions, and answers and comments that add an argument, a reference or evidence.</p>
		</article>
	);
}
