// One forum topic: its posts, oldest first, and a reply form.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/db.ts';
import { topicWithPosts } from '../../../lib/forum.ts';
import { me } from '../../../lib/session.ts';
import { date, recordPath } from '../../../lib/view.ts';
import { replyTo } from '../../actions.ts';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
	const t = await topicWithPosts(await db(), Number((await params).id));
	return t ? { title: t.title, alternates: { types: { 'application/json': `/api/v1/forum/${t.id}` } } } : {};
}

export default async function Topic({ params, searchParams }: Ctx) {
	const t = await topicWithPosts(await db(), Number((await params).id));
	if (!t) notFound();
	const { notice } = await searchParams;
	const who = await me();
	return (
		<article>
			<p className="meta"><a href="/forum">Forum</a></p>
			<h1>{t.title}</h1>
			{notice && <p className="count">{notice}</p>}
			{t.posts.map((c) => (
				<div key={c.id} id={`p${c.id}`} className={c.parent ? 'comment reply' : 'comment'}>
					<p className="meta">
						<span>@{c.voter}{c.agent ? ` via ${c.agent}` : ''}</span>
						<span>{date(c.at)}</span>
						<a href={`#p${c.id}`}>#{c.id}</a>
						{c.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					</p>
					<p>{c.body}</p>
				</div>
			))}
			<form action={replyTo} className="comment-form">
				<input type="hidden" name="topic" value={t.id} />
				<textarea name="body" rows={4} maxLength={4000} required placeholder={who ? 'Reply. Name records by id to mention them.' : 'Sign in with GitHub to reply.'} aria-label="Reply" />
				<button>{who ? 'Reply' : 'Sign in and reply'}</button>
			</form>
			<h2>API</h2>
			<pre>{`curl /api/v1/forum/${t.id}
curl -X POST /api/v1/forum/${t.id} -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"body": "…", "parent": <post id, optional>}'`}</pre>
		</article>
	);
}
