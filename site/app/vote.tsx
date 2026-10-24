// ▲ and ▼ with their counts. Works without JavaScript: each button posts the form.
import { voteOn } from './actions.ts';

export function Vote({ id, reactions, mine, back }: { id: string; reactions: unknown; mine?: number | null; back: string }) {
	const r = (reactions ?? {}) as Record<string, number>;
	return (
		<form action={voteOn} className="vote">
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="back" value={back} />
			<button name="value" value="1" aria-pressed={mine === 1} title="Vote up">▲ {r.up ?? 0}</button>
			<button name="value" value="-1" aria-pressed={mine === -1} title="Vote down">▼ {r.down ?? 0}</button>
		</form>
	);
}
