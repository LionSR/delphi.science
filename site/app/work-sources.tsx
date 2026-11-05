// Shared source panel on a grouped card and either original record URL.
import { date, original, reception, recordPath, source, tally, tex } from '#lib/view.ts';
import { workOf } from '#lib/records/work-groups.ts';

export function WorkSources({ record, detail = false }: { record: Record<string, unknown>; detail?: boolean }) {
	const work = workOf(record);
	if (!work) return null;
	return <section aria-label="Sources for this work" className="work-sources">
		<p className="count">One research work · {work.sources.length} available {work.sources.length === 1 ? 'source' : 'sources'} · {work.discussed} external responses</p>
		{!detail && work.view_record_id !== work.main_record_id && <p className="count">Search match: <a href={recordPath(work.view_record_id)}>{work.view_record_id}</a></p>}
		<p className="count">Votes, comments and reviews belong to each source. Grouping does not establish machine verification.</p>
		{!work.sources.some((s) => s.id === work.main_record_id) && <p className="count">Main record <code>{work.main_record_id}</code> is currently unavailable. Showing the available source.</p>}
		<ul>{work.sources.map((s) => {
			const r = s.record, from = original(r), tag = source(r.source);
			const flag = (key: string) => r[key] === undefined ? 'not stated' : String(r[key]);
			return <li key={s.id}>
				<p className="meta"><strong>{s.id === work.main_record_id ? 'Main record' : 'Alternative source'} · {s.role}</strong> <a className="tag" href={tag.href}>{tag.name}</a>
					<a href={recordPath(s.id)}><code>{s.id}</code></a>
					{from && <a className="external" href={from.href} rel="external">Source: {from.host}</a>}
					<span>{s.date_meaning}: {date(r.published) || 'not stated'}</span>
				</p>
				<p className="meta"><a href={`${recordPath(s.id)}#interactions`}>Interactions: {tally(r)}</a></p>
				{detail && <>
					<p>Source title: {tex(r.title)}{Array.isArray(r.authors) ? ` — ${r.authors.join(', ')}` : ''}</p>
					<p className="meta">Source assertions: formalized {flag('formalized')} · verified {flag('verified')}</p>
					{reception(r) && <p>Reception for this source: {reception(r)!.text}</p>}
					{r.summary ? <p>{tex(r.summary)}</p> : null}
					<p className="meta">
						{r.pdf ? <a href={String(r.pdf)}>PDF</a> : null}
						{r.repo ? <a href={String(r.repo)}>Repository</a> : null}
						<a href={`/api/v1/records/${s.id}`}>Source metadata and responses (JSON)</a>
					</p>
				</>}
			</li>;
		})}</ul>
		{detail && <p className="meta">Grouping evidence: {work.evidence.map((url, i) => <a key={url} href={url}>source {i + 1}</a>)}</p>}
	</section>;
}
