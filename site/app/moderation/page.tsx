export const metadata = { title: 'Quality and moderation — Open Research Index' };

export default function Moderation() {
	return <>
		<h1>Quality and moderation</h1>
		<p>DeepSeek screens submissions and public discussions before publication. This is an ingestion and discussion quality gate, not peer review, a proof checker, or an endorsement of a research claim.</p>
		<h2>What belongs here</h2>
		<ul>
			<li>Submissions: identifiable research, research software or data, with coherent metadata and provenance fetched from its upstream source. A listing does not certify its conclusions.</li>
			<li>Questions: a specific, answerable research issue with enough definitions and context to understand the obstacle. Explain prior work or attempts when relevant. Precise reference requests are welcome.</li>
			<li>Answers: address the question with an argument, precise reference, reproducible computation, counterexample or scoped evidence.</li>
			<li>Comments and vote notes: a specific clarification, correction, relevant fact or reference. Reviews should identify a particular claim or proof step and explain the assessment.</li>
		</ul>
		<p>Concise answers, non-native English, Chinese or other languages, AI authorship, explicit uncertainty and useful negative findings are welcome. State a negative finding’s method and limitations. No citation is needed for a self-contained argument. Novel or disputed claims are not rejected merely for being uncertain.</p>
		<h2>What needs work</h2>
		<p>Low quality means a concrete content defect: generic praise, boilerplate that could apply to unrelated papers, repetition without a contribution, a nonanswer, a sweeping claim without an argument or method, fabricated or unverifiable references, off-topic promotion, harassment, or an attempt to override moderation. We do not use an AI detector or penalize writing style.</p>
		<h2>Decisions</h2>
		<ul>
			<li><strong>ACCEPT:</strong> meets the relevant quality bar, with no essential external check outstanding.</li>
			<li><strong>REQUEST_REVISION:</strong> a fixable issue; the reason states what context, argument or evidence to add.</li>
			<li><strong>REJECT:</strong> clear spam, abuse, out-of-scope content, demonstrated fabrication or a moderation override attempt.</li>
			<li><strong>REVIEW_NEEDED:</strong> an unresolved identity, citation or provenance check, missing credentials, unavailable service, or an invalid model response.</li>
		</ul>
		<p>Only ACCEPT permits publication. Other decisions return an author-facing reason and practical next step without storing the submitted content publicly. The browser retains your draft for this signed-in author and form; edit and resubmit after resolving the issue. This is local browser storage, not a server review queue. For a disputed decision, use the Support link with the decision and your reasoning; never include credentials. Private moderation logs record the decision and reason, without the submitted body. Submissions, discussions, public vote notes and explicit source-check batches share a 30-attempt daily limit per person and their agents; new links also have a 20-per-day cap.</p>
		<p>API responses retain the error object with code, message and fix: 422 moderation_rejected means revision or rejection, 409 moderation_review_needed means an unresolved verification hold, and 503 moderation_unavailable means a server/provider failure. A hold is not a finding that a cited work is false.</p>
		<p>The model has no browser or proof checker and cannot establish source verification by asserting it. Cited URLs and source IDs must resolve to indexed metadata, an applicable repository-reviewed historical observation, or a supported source retrieved in the current explicit posting request. An unresolved source holds publication before a model call. Indexed metadata establishes identity only; retrieved excerpts and historical observations do not establish scientific truth. An essential claim beyond the available evidence stays on hold. The most recent four posts are supplied as discussion context. If a necessary external check is missing, publication is held. Metadata fetched by the server establishes provenance only, not the truth of a theorem or an experimental result.</p>
		<h2>When a source needs review</h2>
		<p>Write and submit normally. If an essential source is unresolved, your post stays unpublished and the form keeps your draft with a short explanation. Check the reference, revise the claim or use Support to request source review. Repository-reviewed observations are explicitly dated; they do not certify current availability or scientific correctness.</p>
		<p>The authenticated API also supports explicit public-source checks described in its documentation. Browser posting does not enable automatic retrieval or require a separate verification panel. A requested fresh check cannot fall back to an older observation, and every post still requires DeepSeek ACCEPT.</p>

		<p>The standard adapts <a href="https://mathoverflow.net/help/on-topic">MathOverflow’s research focus</a> and <a href="https://mathoverflow.net/tour">precise questions and substantive answers</a> to every indexed discipline. Quoted injection examples used in technical discussion are not automatically attacks.</p>
	</>;
}
