// One question with its comments, then its answers (accepted first, then by score), and a form for a new answer.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Post } from '../../../lib/comments.ts';
import { db } from '../../../lib/db.ts';
import { myPostVotes, topicWithPosts } from '../../../lib/forum.ts';
import { me } from '../../../lib/session.ts';
import { date, recordPath } from '../../../lib/view.ts';
import { acceptOn, votePostOn } from '../../actions.ts';
import { PostForm } from '../../post-form.tsx';
import { PublicAuthor } from '../../../lib/public-author.ts';
import { Markdown } from '../../../lib/markdown.ts';
import { EditPost } from '../../edit-post.tsx';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
	const t = await topicWithPosts(await db(), Number((await params).id));
	return t ? { title: t.title, alternates: { types: { 'application/json': `/api/v1/forum/${t.id}` } } } : {};
}

const by = (p: Post) => <PublicAuthor voter={p.voter} agent={p.agent} />;

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

function Comments({ topic, p, owner }: { topic: number; p: Post & { comments: Post[] }; owner: string }) {
	return (
		<div className="post-comments">
			{p.comments.map((c) => (
				<div className="post-comment" key={c.id} id={`p${c.id}`}><Markdown text={c.body} postId={c.id} /><span className="meta-inline">{by(c)} · {date(c.at)}</span>
					{owner === c.voter && <EditPost key={owner} id={c.id} owner={owner} body={c.body} revision={c.revision} />}</div>
			))}
			<details>
				<summary>Add a comment</summary>
				<PostForm kind="comment" owner={owner} topic={topic} parent={p.id} back={`/forum/${topic}`} rows={2} label="Comment" button="Comment"
					placeholder="Ask for a clarification, point out an error, or add a reference." />
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
	const owner = who?.login ?? '';
	const asker = who?.login === t.voter;
	return (
		<article>
			<p className="meta"><a href="/forum">Forum</a></p>
			<h1>{t.title}</h1>
			<p><a href="/moderation">Quality criteria and moderation decisions</a></p>
			{notice && <p className="count">{notice}</p>}

			<div className="post" id={`p${t.question.id}`}>
				<Votes topic={t.id} p={t.question} mine={mine.get(t.question.id)} />
				<div className="post-body">
					<Markdown text={t.question.body} postId={t.question.id} />
					{owner === t.question.voter && <EditPost key={owner} id={t.question.id} owner={owner} body={t.question.body} revision={t.question.revision} />}
					<p className="meta">
						<span>asked by {by(t.question)}</span>
						<span>{date(t.question.at)}</span>
						{t.question.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					</p>
					<Comments topic={t.id} p={t.question} owner={owner} />
				</div>
			</div>

			<h2>{t.answers.length} {t.answers.length === 1 ? 'answer' : 'answers'}</h2>
			{t.answers.map((a) => (
				<div key={a.id} className={a.accepted ? 'post accepted' : 'post'} id={`p${a.id}`}>
					<Votes topic={t.id} p={a} mine={mine.get(a.id)} />
					<div className="post-body">
						<Markdown text={a.body} postId={a.id} />
						{owner === a.voter && <EditPost key={owner} id={a.id} owner={owner} body={a.body} revision={a.revision} />}
						<div className="meta">
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
						</div>
						<Comments topic={t.id} p={a} owner={owner} />
					</div>
				</div>
			))}

			<h2>Your answer</h2>
			<PostForm kind="answer" owner={owner} topic={t.id} back={`/forum/${t.id}`} label="Answer" button="Post your answer"
				placeholder="Provide an argument, reference, computation, or checkable evidence. Reference records by id (e.g. arxiv/2406.01234) to link them." />
			<p className="count">Posts are moderated against MathOverflow standards: specific research questions, and answers or comments backed by an argument, reference, or evidence.</p>
		</article>
	);
}
