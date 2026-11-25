// Status pills shared by record cards on / and the header on /r/<prefix>/<suffix>.
import type { Item } from '#lib/api/schema.ts';

export function RecordBadges({ record: r }: { record: Record<string, unknown> }) {
	const problem = r.problem as Item['problem'];
	return (
		<>
			{problem?.status ? <span className={problem.status === 'solved' ? 'pill muted' : 'pill'}>{problem.status} problem</span> : problem ? <span className="pill muted">problem</span> : null}
			{r.origin === 'ai-generated' && <span className="pill muted">AI-generated</span>}
			{r.verified ? <span className="pill accent">machine-checked</span> : r.formalized ? <span className="pill accent">Lean</span> : null}
			{r.disputed ? <span className="pill warn">disputed</span> : null}
			{r.withdrawn ? <span className="pill warn">withdrawn</span> : null}
		</>
	);
}
