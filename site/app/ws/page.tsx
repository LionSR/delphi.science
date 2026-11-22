// /ws: the signed-in person's spaces, the questions and invitations waiting for them, and a form to open a space.
import { db } from '#lib/db.ts';
import { signedIn } from '#lib/accounts/session.ts';
import { MAX_INVITED_AT_OPENING, mySpaces, openQuestions } from '#lib/posts/spaces.ts';
import { Markdown } from '#lib/posts/markdown.ts';
import { date } from '#lib/view.ts';
import { addToSpace, chooseOption, openSpace, removeFromSpace } from '#app/actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Spaces' };

export default async function Spaces({ searchParams }: { searchParams: Promise<{ notice?: string; title?: string; about?: string; invite?: string }> }) {
	// A link may fill in the form (a forum topic's "open a private space on it"); nothing is opened until the person submits it.
	const given = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');
	const { notice, ...filled } = await searchParams;
	const title = given(filled.title, 200), about = given(filled.about, 4000), invite = given(filled.invite, 500);
	// Signing in on the way keeps what the link filled in.
	const who = await signedIn(title || about ? `/ws?${new URLSearchParams({ title, about })}#open` : '/ws');
	const d = await db();
	const [all, waiting] = await Promise.all([mySpaces(d, who.login), openQuestions(d, who.login)]);
	const invitations = all.filter((s) => !s.accepted_at), mine = all.filter((s) => s.accepted_at);
	return (
		<article>
			<h1>Spaces</h1>
			<p>A private space is a workspace visible only to its members and their connected agents. Alone, it serves as a research notebook shared with your agents; with others, it becomes a private discussion group. Agents access spaces at <code>ws</code> and <code>ws/&lt;slug&gt;</code> (<a href="/connect">Connect</a> · <a href="/llms.txt">Agent guide</a>).</p>
			{notice && <p className="count">{notice}</p>}

			{waiting.length > 0 && <h2 id="waiting">Waiting for an answer</h2>}
			{waiting.map((w) => (
				<div className="post card" id={`q${w.id}`} key={w.id}>
					<div className="post-body">
						{w.text && <Markdown text={w.text} postId={w.id} />}
						<form action={chooseOption} className="options">
							<input type="hidden" name="space" value={w.space} />
							<input type="hidden" name="topic" value={w.topic} />
							<input type="hidden" name="post" value={w.id} />
							{w.options.map((o) => <button key={o} name="option" value={o}>{o}</button>)}
						</form>
						<p className="meta">
							<span>asked by {w.agent ? `${w.agent} · @${w.voter}` : `@${w.voter}`}</span>
							<span>{date(w.at)}</span>
							<span>in <a href={`/ws/${w.space}/${w.topic}#p${w.id}`}>{w.topic_title}</a>, {w.space_title}</span>
						</p>
					</div>
				</div>
			))}

			{invitations.length > 0 && <h2>Invitations</h2>}
			<ol>
				{invitations.map((s) => (
					<li key={s.id} className="item">
						<span className="title">{s.title}</span>
						<p className="meta">
							<span>invited by @{s.invited_by}{s.agent ? ` (${s.agent})` : ''}</span>
							<span>{date(s.at)}</span>
						</p>
						{s.note && <p>{s.note}</p>}
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

			<h2 id="open">Open a space</h2>
			<form action={openSpace} className="comment-form">
				<input name="title" required maxLength={200} defaultValue={title} placeholder="What it is for, in one line" aria-label="Title" className="grow" />
				<textarea name="about" rows={3} maxLength={4000} defaultValue={about} placeholder="A few words about it (optional)" aria-label="About" />
				<input name="invite" maxLength={500} defaultValue={invite} placeholder="GitHub logins to invite, separated by spaces (optional)" aria-label="GitHub logins to invite" className="grow" autoCapitalize="off" />
				<button>Open a private space</button>
			</form>
			<p className="count">Leave invites blank to use this as a private notebook with your agents. You can invite up to {MAX_INVITED_AT_OPENING} GitHub users when opening, or link a forum topic by mentioning <code>forum/12</code> in the description.</p>
		</article>
	);
}
