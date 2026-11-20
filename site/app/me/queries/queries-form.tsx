'use client';
// The form for the saved queries. Sent without JavaScript, the server draws the page again from the action's reply:
// the text that was sent, and every bad line with its fix. With JavaScript the same reply arrives without a reload.
import { useActionState } from 'react';
import { saveQueries } from '#app/actions.ts';
import { CATEGORY_CHOICES, type QueriesFormState } from '#lib/accounts/queries-form.ts';

export function QueriesForm({ text, revision, max }: { text: string; revision: string; max: number }) {
	const [state, action, pending] = useActionState<QueriesFormState, FormData>(saveQueries, { status: 'idle', text, revision, n: 0 });
	return (
		<form action={action} className="comment-form tex2jax_ignore">
			<input type="hidden" name="revision" value={state.revision} />
			{state.status === 'saved' && <p className="notice" role="status">Saved: {state.count === 1 ? '1 query' : `${state.count} queries`}. <a href="/?feed=mine">Open My feed</a></p>}
			{state.status === 'failed' && (
				<div className="notice" role="alert">
					<p><strong>Nothing was saved.</strong> {state.problems?.length ? 'Fix these lines and save again:' : state.message}</p>
					{state.problems && state.problems.length > 0 && <ul>
						{state.problems.map((p, i) => <li key={i}>{p.line > 0 && <>Line {p.line}, <code>{p.text}</code>: </>}{p.message}. {p.fix}</li>)}
					</ul>}
					{state.conflict && <p><a href="/me/queries">Load the current text</a> (your text stays in this form until you do).</p>}
				</div>
			)}
			{/* The key makes the box take the server's text after each reply: what was sent, with any category lines added. */}
			<textarea key={state.n} name="queries" defaultValue={state.text} rows={10} maxLength={max} spellCheck={false} autoCapitalize="off" autoCorrect="off"
				aria-label="Saved queries, one per line" placeholder={'cat:quant-ph\nto:@me\n# a line that starts with # is a note'} />
			<details>
				<summary>Add arXiv categories</summary>
				<p className="count">Each box you tick adds a line <code>cat:&lt;code&gt;</code> to the text when you save. The text above is what is stored.</p>
				<p className="choices" key={state.n}>
					{CATEGORY_CHOICES.map(([code, name]) => <label key={code}><input type="checkbox" name="cat" value={code} /> {name} <code>{code}</code></label>)}
				</p>
				<label>Other category codes, separated by spaces <input name="codes" placeholder="math.NT cs.LG" autoCapitalize="off" /></label>
			</details>
			<button disabled={pending}>Save</button>
		</form>
	);
}
