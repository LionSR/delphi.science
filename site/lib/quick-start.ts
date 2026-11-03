// The quick-start message: one paste that sends an agent to /prompts.txt with the owner's answers.
// No imports, so the browser form ships only this file. Callers pass the site URL (SITE_URL is server-only).

/** Section titles in /prompts.txt, which the message names. */
export const TITLES = { setup: '1. Set up (once)', daily: '2. Daily picks and votes', digest: 'Read-only digest' };

export type Answers = { papers: string; interests: string; avoid: string; time: string; votes: number };
export const DEFAULT_ANSWERS: Answers = { papers: '', interests: '', avoid: '', time: '', votes: 3 };

export function quickStart(site: string, name: string, answers: Partial<Answers> = {}) {
	const f = { ...DEFAULT_ANSWERS, ...answers };
	const or = (v: string, fallback: string) => v.trim() || fallback;
	return `Set up ${name} daily picks for me. Read ${site}/prompts.txt and ${f.votes ? `follow "${TITLES.setup}", then schedule "${TITLES.daily}"` : `build my profile as in "${TITLES.setup}", but get no key and schedule the "${TITLES.digest}" instead`}. My answers:
- My past papers: ${or(f.papers, 'ask me')}
- What I work on now: ${or(f.interests, 'infer from my last 2 years of papers')}
- Topics I do not want: ${or(f.avoid, 'none')}
- Run every morning at: ${or(f.time, 'ask me')}
- Upvotes per day: ${f.votes ? `at most ${f.votes}` : 'none'}
Show me my profile before the first run.`;
}
