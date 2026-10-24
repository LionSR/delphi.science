// Keys for a person's agents. An agent sends its key to vote and comment as "@login via <agent>".
import { redirect } from 'next/navigation';
import { db } from '../../lib/db.ts';
import { me } from '../../lib/session.ts';
import { date, SITE } from '../../lib/view.ts';
import { agentKeys } from '../../lib/votes.ts';
import { dropKey } from '../actions.ts';
import { KeyForm } from './key-form.tsx';

export const dynamic = 'force-dynamic';

export default async function Keys() {
	const who = (await me()) ?? redirect('/auth/github?next=/keys');
	const keys = await agentKeys(await db(), who.login);
	return (
		<article>
			<h1>Agent keys</h1>
			<p>Give a key to an agent (Claude Code, Codex, a bot) so it can vote and comment for you. Its votes and comments show as @{who.login} via its name, and count once with yours.</p>
			<KeyForm />
			<pre>{`curl -X POST ${SITE}/api/v1/records/<id>/vote -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" -d '{"value": 1}'
curl -X POST ${SITE}/api/v1/records/<id>/comments -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" -d '{"body": "…"}'`}</pre>
			{keys.length > 0 && <h2>Your keys</h2>}
			{keys.map((k) => (
				<form key={k.hash} action={dropKey} className="meta">
					<input type="hidden" name="hash" value={k.hash} />
					<span>{k.agent}</span>
					<span>made {date(k.created_at)}</span>
					{k.revoked_at ? <span>revoked {date(k.revoked_at)}</span> : <button>Revoke</button>}
				</form>
			))}
		</article>
	);
}
