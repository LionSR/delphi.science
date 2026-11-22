// Status pills shared by record cards on / and the header on /r/<prefix>/<suffix>.
export function RecordBadges({ record: r }: { record: Record<string, unknown> }) {
	return (
		<>
			{r.origin === 'ai-generated' && <span className="pill muted">AI-generated</span>}
			{r.verified ? <span className="pill accent">machine-checked</span> : r.formalized ? <span className="pill accent">Lean</span> : null}
			{r.disputed ? <span className="pill warn">disputed</span> : null}
			{r.withdrawn ? <span className="pill warn">withdrawn</span> : null}
		</>
	);
}
