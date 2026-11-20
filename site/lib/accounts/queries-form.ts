// What the saved-queries form sends and gets back (app/me/queries). The form's state is plain data, so a page sent
// without JavaScript can be drawn again from it.
import type { Db } from '#lib/db.ts';
import { CodedError } from '#lib/errors.ts';
import { QueriesError, queryLines, replaceQueries, type Problem } from './queries.ts';

/** The arXiv archives the helper offers as boxes: a short list for the common case. Any other code can be typed. */
export const CATEGORY_CHOICES: [code: string, name: string][] = [
	['math', 'Mathematics'], ['quant-ph', 'Quantum Physics'], ['hep-th', 'High Energy Physics – Theory'], ['math-ph', 'Mathematical Physics'],
	['cs', 'Computer Science'], ['physics', 'Physics'], ['stat', 'Statistics'], ['q-bio', 'Quantitative Biology'], ['eess', 'Electrical Engineering and Systems Science'], ['econ', 'Economics'],
];

export type QueriesFormState = {
	status: 'idle' | 'saved' | 'failed';
	/** The text for the box: what is stored, or after a failure what was sent. */
	text: string; revision: string;
	/** Grows with each reply, so the form can tell a new one from the last. */
	n: number;
	count?: number; problems?: Problem[]; message?: string; conflict?: boolean;
};

/** The text a form means: what is in the box, then a cat: line for each category ticked or typed that is not there yet. */
export function formText(text: string, categories: string[]): string {
	const have = new Set(queryLines(text));
	const lines = [...new Set(categories.map((c) => c.trim()).filter(Boolean).map((c) => `cat:${c}`))].filter((l) => !have.has(l));
	return [text.replace(/\s+$/, ''), ...lines].filter(Boolean).join('\n');
}

/** Saves what the form sent for `login`, all or nothing, and says what the form shows next. */
export async function saveForm(db: Db, login: string, previous: QueriesFormState, sent: { text: string; categories: string[]; revision: string }): Promise<QueriesFormState> {
	const text = formText(sent.text, sent.categories);
	const n = previous.n + 1;
	try {
		const saved = await replaceQueries(db, { login }, text, sent.revision);
		return { status: 'saved', text: saved.text, revision: saved.revision, n, count: queryLines(saved.text).length };
	} catch (e) {
		if (e instanceof QueriesError) return { status: 'failed', text, revision: sent.revision, n, problems: e.problems.filter((p) => p.line > 0), message: `${e.message}. ${e.fix}` };
		if (e instanceof CodedError && e.code === 'edit_conflict') {
			return { status: 'failed', text, revision: sent.revision, n, conflict: true, message: 'The saved queries were changed somewhere else (another tab, or one of your agents) after this page was opened.' };
		}
		throw e;
	}
}
