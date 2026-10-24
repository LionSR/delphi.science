'use client';
// Makes an agent key; the key is shown here once.
import { useActionState } from 'react';
import { newKey } from '../actions.ts';

export function KeyForm() {
	const [state, action, pending] = useActionState(newKey, {} as { key?: string; agent?: string; error?: string });
	return (
		<>
			<form action={action}>
				<input name="agent" placeholder="Agent name, e.g. Claude Code" aria-label="Agent name" required maxLength={60} />
				<button disabled={pending}>Make a key</button>
			</form>
			{state.error && <p className="count">{state.error}</p>}
			{state.key && (
				<>
					<p>Key for {state.agent}. Copy it now; it is not shown again.</p>
					<pre>{state.key}</pre>
				</>
			)}
		</>
	);
}
