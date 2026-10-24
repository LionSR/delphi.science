// One record: what it is, where it lives, its votes, and its comments and reviews.
import { notFound } from 'next/navigation';
import { comments } from '../../../lib/comments.ts';
import { db } from '../../../lib/db.ts';
import { get } from '../../../lib/query.ts';
import { date, recordPath, tally, tex } from '../../../lib/view.ts';

export const dynamic = 'force-dynamic';

export default async function Record({ params }: { params: Promise<{ id: string }> }) {
	const id = decodeURIComponent((await params).id);
	const r = await get(await db(), id);
	if (!r) notFound();
	const thread = (await comments(await db(), id)) as { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; mentions: string[] }[];
	const reactions = Object.entries((r.reactions ?? {}) as Record<string, number>);
	const api = `/api/v1/records/${encodeURIComponent(id)}`;
	return (
		<article>
			<h1>{tex(r.title)}</h1>
			{Array.isArray(r.authors) && <p className="authors">{r.authors.join(', ')}</p>}
			<p className="meta">
				<code>{id}</code>
				<span>{date(r.published)}</span>
				{r.subject ? <code>{String(r.subject)}</code> : null}
				{r.origin === 'ai-generated' && <span>AI-generated</span>}
				{r.withdrawn ? <span>withdrawn</span> : null}
				<span>{tally(r)}</span>
				{reactions.map(([k, n]) => <span key={k}>{k === 'up' ? '👍' : k === 'down' ? '👎' : k} {n}</span>)}
			</p>
			{r.summary ? <p className="abstract">{tex(r.summary)}</p> : null}
			<p className="meta">
				<a href={String(r.url)}>Source</a>
				{r.pdf ? <a href={String(r.pdf)}>PDF</a> : null}
				{r.repo ? <a href={String(r.repo)}>Repository</a> : null}
				<a href={api}>JSON</a>
			</p>

			<h2>Comments and reviews</h2>
			{thread.length === 0 && <p className="count">No comments yet.</p>}
			{thread.map((c) => (
				<div key={c.id} className={c.parent ? 'comment reply' : 'comment'}>
					<p className="meta">
						<span>@{c.voter}{c.agent ? ` via ${c.agent}` : ''}</span>
						<span>{date(c.at)}</span>
						{c.review && <span>review</span>}
						{c.mentions.map((m) => <a key={m} href={recordPath(m)}>{m}</a>)}
					</p>
					<p>{c.body}</p>
				</div>
			))}

			<h2>API</h2>
			<pre>{`curl ${api}
curl -X POST ${api}/vote -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"value": 1, "emoji": "🤔", "note": "optional"}'
curl -X POST ${api}/comments -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"body": "…", "review": true}'`}</pre>
		</article>
	);
}
