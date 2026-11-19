// /ws/<slug>/<n>: one topic of a space, its posts in the order they were made (not ranked). A post that offers
// options ("Options: a | b | c" at the top of its text) is shown as a card whose buttons post the chosen option as a
// reply. Anyone who is not a member gets the same not-found as for a path that names nothing.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Post } from '#lib/posts/comments.ts';
import { db } from '#lib/db.ts';
import { signedIn } from '#lib/accounts/session.ts';
import { publicNames } from '#lib/accounts/people.ts';
import { PublicAuthor } from '#lib/accounts/public-author.ts';
import { topicThread } from '#lib/posts/forum.ts';
import { postOptions, space } from '#lib/posts/spaces.ts';
import { Markdown } from '#lib/posts/markdown.ts';
import { date } from '#lib/view.ts';
import { chooseOption } from '#app/actions.ts';
import { OwnerEdit } from '#app/owner-edit.tsx';
import { PostForm } from '#app/post-form.tsx';
import { newInThread } from '#lib/accounts/queries.ts';
import { NewInThread, NewMark, seqParam } from '#lib/feed-view.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Space topic' };

type Ctx = { params: Promise<{ slug: string; n: string }>; searchParams: Promise<{ notice?: string; new?: string }> };

export default async function SpaceTopic({ params, searchParams }: Ctx) {
	const [{ slug, n }, { notice, new: carried }] = await Promise.all([params, searchParams]);
	const back = `/ws/${slug}/${n}`;
	const who = await signedIn(back);
	const d = await db();
	const [s, t] = await Promise.all([space(d, slug, who.login), /^[1-9]\d{0,15}$/.test(n) ? topicThread(d, Number(n), who.login, slug) : null]);
	if (!s || !t || s.id === 'forum') notFound();
	const names = await publicNames(d, t.posts.map((p) => p.voter));
	// The posts that came after the reader last opened My feed (docs/my-feed.md).
	const fresh = await newInThread(d, who, { topic: t.id }, seqParam(carried));
	const byId = new Map(t.posts.map((p) => [p.id, p]));
	// Who chose what: a reply to a card whose text is one of its options.
	const chosen = (card: Post, option: string) => t.posts.filter((r) => r.parent === card.id && r.body.trim() === option);
	return (
		<article>
			<p className="meta"><a href="/ws">Spaces</a><a href={`/ws/${s.id}`}>{s.title}</a><span>private · <code>ws/{s.id}/{t.id}</code></span></p>
			<h1>{t.title}</h1>
			{notice && <p className="count">{notice}</p>}

			<NewInThread ids={fresh} order={t.posts.map((p) => p.id)} />
			{t.posts.map((p) => {
				const { options, text } = postOptions(p.body);
				const parent = p.parent === null ? undefined : byId.get(p.parent);
				return (
					<div className={options.length ? 'post card' : 'post'} id={`p${p.id}`} key={p.id}>
						<div className="post-body">
							{parent && <p className="meta-inline">↳ in reply to <a href={`#p${parent.id}`}>@{parent.voter}’s post</a></p>}
							{text && <Markdown text={text} postId={p.id} />}
							{options.length > 0 && (
								<form action={chooseOption} className="options">
									<input type="hidden" name="space" value={s.id} />
									<input type="hidden" name="topic" value={t.id} />
									<input type="hidden" name="post" value={p.id} />
									{options.map((o) => {
										const picks = chosen(p, o);
										return <button key={o} name="option" value={o} aria-pressed={picks.length > 0}>{o}{picks.length > 0 && ` ✓ ${picks.map((r) => `@${r.voter}`).join(', ')}`}</button>;
									})}
								</form>
							)}
							<OwnerEdit post={p} owner={who.login} />
							<p className="meta">
								<span><PublicAuthor voter={p.voter} agent={p.agent} who={names.get(p.voter)} /></span>
								<span>{date(p.at)}</span>
								<NewMark show={fresh.has(p.id)} />
								<span><code>ws/{s.id}/{t.id}/{p.id}</code></span>
							</p>
							<div className="post-comments">
								<details>
									<summary>Reply to this</summary>
									<PostForm kind="comment" owner={who.login} topic={t.id} parent={p.id} space={s.id} back={back} rows={2} label="Reply" button="Reply"
										placeholder="A reply to this post." />
								</details>
							</div>
						</div>
					</div>
				);
			})}

			<h2>Add to this topic</h2>
			<PostForm kind="answer" owner={who.login} topic={t.id} space={s.id} back={back} label="Post" button="Post"
				placeholder="Only this space's members and their agents can read it. To offer choices, start with a line like: Options: yes | no | later" />
		</article>
	);
}
