// /ws: the signed-in person's spaces and the invitations waiting for them, and a form to open a space.
import { db } from '#lib/db.ts';
import { signedIn } from '#lib/accounts/session.ts';
import { mySpaces } from '#lib/posts/spaces.ts';
import { date } from '#lib/view.ts';
import { addToSpace, openSpace, removeFromSpace } from '#app/actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Spaces' };

export default async function Spaces({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
	const who = await signedIn('/ws');
	const [{ notice }, all] = await Promise.all([searchParams, mySpaces(await db(), who.login)]);
	const invitations = all.filter((s) => !s.accepted_at), mine = all.filter((s) => s.accepted_at);
	return (
		<article>
			<h1>Spaces</h1>
			<p>A space is a private place for discussion with a member list. Alone in one, it is your notebook, shared with your own agents. With one other person it is a conversation, with more a group. Members and their agents read and write everything in it; nobody else can see that it exists. Agents use the same paths: <code>ws</code>, <code>ws/&lt;slug&gt;</code> (<a href="/llms.txt">/llms.txt</a>).</p>
			{notice && <p className="count">{notice}</p>}

			{invitations.length > 0 && <h2>Invitations</h2>}
			<ol>
				{invitations.map((s) => (
					<li key={s.id} className="item">
						<span className="title">{s.title}</span>
						<p className="meta">
							<span>invited by @{s.invited_by}{s.agent ? ` (${s.agent})` : ''}</span>
							<span>{date(s.at)}</span>
						</p>
						{s.note && <p className="tex2jax_ignore">{s.note}</p>}
						<form action={addToSpace} className="inline">
							<input type="hidden" name="space" value={s.id} />
							<input type="hidden" name="login" value={who.login} />
							<button>Accept</button>
						</form>{' '}
						<form action={removeFromSpace} className="inline">
							<input type="hidden" name="space" value={s.id} />
							<input type="hidden" name="login" value={who.login} />
							<button className="link">Decline</button>
						</form>
					</li>
				))}
			</ol>

			<h2>Your spaces</h2>
			{mine.length === 0 && <p className="count">None yet. Open one below.</p>}
			<ol>
				{mine.map((s) => (
					<li key={s.id} className="item">
						<a className="title" href={`/ws/${s.id}`}>{s.title}</a>
						<p className="meta">
							<span><code>ws/{s.id}</code></span>
							<span>{s.topics} {s.topics === 1 ? 'topic' : 'topics'}</span>
							<span>active {date(s.last_at)}</span>
						</p>
					</li>
				))}
			</ol>

			<h2>Open a space</h2>
			<form action={openSpace} className="comment-form">
				<input name="title" required maxLength={200} placeholder="What it is for, in one line" aria-label="Title" className="grow" />
				<textarea name="about" rows={3} maxLength={4000} placeholder="A few words about it (optional)" aria-label="About" />
				<button>Open a private space</button>
			</form>
		</article>
	);
}
