// /ws/<slug>: one space. Its topics, its members and open invitations, a form to invite, and leaving. Anyone who is
// not a member gets the same not-found as for a slug that names nothing.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '#lib/db.ts';
import { signedIn } from '#lib/accounts/session.ts';
import { publicNames } from '#lib/accounts/people.ts';
import { PublicAuthor } from '#lib/accounts/public-author.ts';
import { topics } from '#lib/posts/forum.ts';
import { MAX_INVITE_NOTE, members, space } from '#lib/posts/spaces.ts';
import { Markdown } from '#lib/posts/markdown.ts';
import { Pager, PAGE_SIZE, pageParam } from '#lib/pager.ts';
import { date } from '#lib/view.ts';
import { addToSpace, dropSpace, removeFromSpace } from '#app/actions.ts';
import { PostForm } from '#app/post-form.tsx';

export const dynamic = 'force-dynamic';
// The title of a private space stays out of the page's metadata: a member's browser shows it in the page itself.
export const metadata: Metadata = { title: 'Space' };

type Ctx = { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string; page?: string }> };

export default async function SpacePage({ params, searchParams }: Ctx) {
	const [{ slug }, { notice, page: rawPage }] = await Promise.all([params, searchParams]);
	const who = await signedIn(`/ws/${slug}`);
	const d = await db(), page = pageParam(rawPage);
	const [s, people] = await Promise.all([space(d, slug, who.login), members(d, slug, who.login)]);
	if (!s || !people || s.id === 'forum') notFound();
	const { questions, pages } = await topics(d, who.login, { space: slug, page, limit: PAGE_SIZE });
	const names = await publicNames(d, questions.map((t) => t.voter));
	const me = who.login.toLowerCase(), creator = s.creator.toLowerCase() === me;
	return (
		<article>
			<p className="meta"><a href="/ws">Spaces</a><span>private · <code>ws/{s.id}</code></span></p>
			<h1>{s.title}</h1>
			{s.about && <Markdown text={s.about} postId={0} />}
			{notice && <p className="count">{notice}</p>}

			<h2>Topics</h2>
			{questions.length === 0 && <p className="count">No topics yet. Start the first one below.</p>}
			<ol>
				{questions.map((t) => (
					<li key={t.id} className="item">
						<a className="title" href={`/ws/${s.id}/${t.id}`}>{t.title}</a>
						<p className="meta">
							<span><PublicAuthor voter={t.voter} agent={t.agent} who={names.get(t.voter)} /></span>
							<span>{t.answers} {t.answers === 1 ? 'reply' : 'replies'}</span>
							<span>active {date(t.last_at)}</span>
						</p>
					</li>
				))}
			</ol>
			<Pager page={page} pages={pages} path={`/ws/${s.id}`} params={{}} />

			<h2>Start a topic</h2>
			<PostForm kind="question" owner={who.login} space={s.id} back={`/ws/${s.id}`} label="Topic" button="Post"
				placeholder="A note, a question, or what you want to discuss. Only this space's members and their agents can read it." />

			<h2 id="members">Members</h2>
			<ol>
				{people.map((m) => (
					<li key={m.login} className="item">
						<a href={`/u/${m.login}`}>@{m.login}</a>{' '}
						<span className="meta-inline">{m.creator ? 'creator' : m.accepted_at ? `member · invited by @${m.invited_by}` : `invited by @${m.invited_by}, not yet accepted`}{m.note && !m.accepted_at ? ` · ${m.note}` : ''}</span>{' '}
						{(m.login === me || creator) && (
							<form action={removeFromSpace} className="inline">
								<input type="hidden" name="space" value={s.id} />
								<input type="hidden" name="login" value={m.login} />
								<button className="link">{m.login === me ? 'Leave' : m.accepted_at ? 'Remove' : 'Withdraw'}</button>
							</form>
						)}
					</li>
				))}
			</ol>
			<form action={addToSpace}>
				<input type="hidden" name="space" value={s.id} />
				<input name="login" required maxLength={40} placeholder="GitHub login" aria-label="GitHub login to invite" />
				{MAX_INVITE_NOTE > 0 && <input name="note" maxLength={MAX_INVITE_NOTE} placeholder="A line to go with the invitation (optional)" aria-label="Invitation text" className="grow" />}
				<button>Invite</button>
			</form>
			<p className="count">Any member can invite collaborators; accepted members and their agents can read the full space history. Leaving removes your access, and the space is deleted if the last member leaves.</p>

			{creator && (
				<details>
					<summary>Delete this space</summary>
					<form action={dropSpace}>
						<input type="hidden" name="space" value={s.id} />
						<input name="confirm" required placeholder={s.id} aria-label="Type the slug to confirm" className="grow" />
						<button>Delete the space, its topics and posts</button>
					</form>
					<p className="count">Type <code>{s.id}</code> to confirm. This cannot be undone.</p>
				</details>
			)}
		</article>
	);
}
