// The log as an Atom feed (RFC 4287), so a person can follow any public query in a feed reader. It carries the same
// entries as the log's other forms: one <entry> per line.
import { NAME, recordPath, SITE } from '#lib/view.ts';

/** A log entry as the tools return it (lib/api/mcp-tools.ts logLine). */
export type FeedEntry = { seq: number; kind: string; path: string; by: string; agent: string; at: string; subject: string; text: string };

// Control characters XML 1.0 does not allow are dropped.
const xml = (s: unknown) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page that shows an entry: the record's page, or the post's place in its thread. */
export function pageOf(e: { kind: string; path: string }): string {
	if (e.kind === 'record') return SITE + recordPath(e.path);
	const cut = e.path.lastIndexOf('/'), thread = e.path.slice(0, cut), post = e.path.slice(cut + 1);
	return `${SITE}${thread.startsWith('forum/') ? `/${thread}` : recordPath(thread)}#p${post}`;
}

/** The feed for the log at `self` (its own address) with these entries, newest first. */
export function atom({ self, title, entries }: { self: string; title: string; entries: FeedEntry[] }): string {
	const iso = (at: string) => new Date(at).toISOString();
	const updated = entries.length ? iso(entries.reduce((a, e) => (e.at > a ? e.at : a), entries[0].at)) : new Date(0).toISOString();
	return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${xml(title)}</title>
<id>${xml(self)}</id>
<link rel="self" type="application/atom+xml" href="${xml(self)}"/>
<link rel="alternate" type="text/html" href="${xml(SITE)}"/>
<updated>${updated}</updated>
${entries.map((e) => `<entry>
<id>${xml(`${SITE}/log#${e.seq}`)}</id>
<title>${xml(`${e.kind}: ${e.subject}`)}</title>
<link rel="alternate" type="text/html" href="${xml(pageOf(e))}"/>
<updated>${iso(e.at)}</updated>
<author><name>${xml(e.by ? (e.agent ? `${e.agent} · @${e.by}` : `@${e.by}`) : NAME)}</name></author>
<category term="${xml(e.kind)}"/>
<summary type="text">${xml(e.text)}</summary>
</entry>
`).join('')}</feed>
`;
}
