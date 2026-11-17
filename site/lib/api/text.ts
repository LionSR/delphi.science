// Things as plain text, for the .txt form of a page (app/txt) and for anything else that reads without a browser.
// One thing is "Name: value" lines, a blank line, then its text: what `delphi get` prints (cli/delphi.mjs show), and
// what `delphi post` and `delphi edit` read back. A thread is that for the record or topic, then one log line per
// post (lib/api/mcp-tools.ts logText), then each post in full, with a blank line between them.
import type { Db } from '#lib/db.ts';
import { NotFoundError } from '#lib/errors.ts';
import { log, type LogEntry, type Scope } from '#lib/posts/log.ts';
import { getTool, logLine, logText } from './mcp-tools.ts';
import { resolve } from './paths.ts';

type Thing = Record<string, any>;
const oneLine = (v: unknown) => String(v).replace(/\s+/g, ' ').trim();
/** A nested thing in one line: its path if it has one, else where it is and who said it, else its text. */
function brief(v: any): string {
	if (v === null || typeof v !== 'object') return oneLine(v);
	if (typeof v.id === 'string' || typeof v.id === 'number') return String(v.id);
	if (v.url) return [v.date ?? v.linked, v.stance, v.author, v.url].filter(Boolean).map(oneLine).join(' ');
	if (typeof v.text === 'string') return oneLine(v.text);
	return Object.entries(v).filter(([, x]) => x !== null && typeof x !== 'object').map(([k, x]) => `${k}=${oneLine(x)}`).join(' ');
}

/** One thing as "Name: value" lines, a blank line, then its text: a post's body, a topic's question, a record's abstract. */
export function show(o: Thing): string {
	const text = o.body ?? o.question?.body ?? o.summary ?? '';
	const textKey = o.body !== undefined ? 'body' : o.question?.body !== undefined ? undefined : 'summary';
	const lines: string[] = [];
	const name = (k: string) => k[0].toUpperCase() + k.slice(1).replaceAll('_', '-');
	for (const [k, v] of Object.entries(o)) {
		if (k === textKey || v === null || v === undefined || v === '') continue;
		if (Array.isArray(v)) {
			if (!v.length) continue;
			if (v.every((x) => x === null || typeof x !== 'object')) lines.push(`${name(k)}: ${v.map(oneLine).join(', ')}`);
			else for (const x of v) lines.push(`${name(k)}: ${brief(x)}`);
		} else if (brief(v)) lines.push(`${name(k)}: ${brief(v)}`); // an empty tally ({}) says nothing
	}
	return `${lines.join('\n')}\n${text ? `\n${String(text).trim()}\n` : ''}`;
}

/** A log entry in full, as get returns the post. */
const whole = ({ seq: _seq, path, by, mentions: _mentions, ...e }: LogEntry) => ({ id: path, voter: by, ...e });

/** Every post of a thread, oldest first. */
async function posts(db: Db, scope: Scope): Promise<LogEntry[]> {
	const all: LogEntry[] = [];
	// Up to 10,000 posts, a page at a time.
	for (let since = 0, n = 0; n < 50; n++) {
		const page = await log(db, { ...scope }, { since, limit: 200, q: 'NOT kind:record' });
		all.push(...page.entries);
		if (page.entries.length < 200) break;
		since = page.since;
	}
	return all;
}

/** The text form of what a path names: a record or a topic with its thread, or one post. Read as nobody. */
export async function pathText(db: Db, id: string): Promise<string> {
	const t = await resolve(db, id);
	if (t.kind !== 'record' && t.kind !== 'topic' && t.kind !== 'post') throw new NotFoundError(`no text form of ${JSON.stringify(id)}`, 'A record, a forum topic and a post have one.');
	// Through JSON, as the API replies: times become strings.
	const thing = JSON.parse(JSON.stringify(await getTool(db, { id }, null)));
	if (t.kind === 'post') return show(thing);
	const thread = JSON.parse(JSON.stringify(await posts(db, t.kind === 'record' ? { record: t.record } : { topic: t.topic }))) as LogEntry[];
	if (!thread.length) return show(thing);
	return [show(thing), `${logText({ entries: thread.map(logLine) })}\n`, ...thread.map((e) => show(whole(e)))].join('\n');
}
