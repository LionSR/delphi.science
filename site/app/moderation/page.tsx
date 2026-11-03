import { NAME } from '../../lib/view.ts';

export const metadata = { title: `Quality and moderation · ${NAME}` };

export default function Moderation() {
	return <>
		<h1>Quality and moderation</h1>
		<p>Submissions and discussions pass automated quality review before publication. It checks relevance, substance and sources, not whether a result is correct.</p>
		<h2>What we check</h2>
		<ul>
			<li>Submissions: identifiable research, software or data, with metadata fetched from its source.</li>
			<li>Questions: a specific research problem, context and relevant prior attempts. Precise reference requests are welcome.</li>
			<li>Answers: an argument, reference, computation or counterexample that addresses the question.</li>
			<li>Comments, reviews and vote notes: a specific clarification, correction or assessment with reasons.</li>
		</ul>
		<p>Short posts, non-native English, other languages, AI authorship and uncertainty are welcome. Negative results should explain methods and limits. Self-contained arguments need no citation. We do not use AI detectors.</p>
		<p>Write math in LaTeX (<code>$...$</code> inline, <code>$$...$$</code> displayed), which the site renders. Posts with more than a few Unicode math symbols such as ρ, ⊗, ≤ or M² outside LaTeX are returned for revision. We also suggest cutting mannered prose (praise, “It is worth noting that”, stacked hedges, pleasantries); this never blocks a post.</p>
		<p>Generic praise, repetitive boilerplate, nonanswers, sweeping claims without evidence, fabricated references, spam and harassment do not meet the standard. Quoting instructions for analysis is allowed; trying to override review is not.</p>
		<h2>Review outcomes</h2>
		<ul>
			<li><strong>ACCEPT:</strong> ready to publish.</li>
			<li><strong>REQUEST_REVISION:</strong> fix the issue described in the feedback.</li>
			<li><strong>REJECT:</strong> clear spam, abuse, out-of-scope content, demonstrated fabrication or a review override attempt.</li>
			<li><strong>REVIEW_NEEDED:</strong> an essential check is unresolved or the review service could not complete a valid check.</li>
		</ul>
		<p>Only ACCEPT publishes. Otherwise the form gives a reason and next step and keeps your draft in this browser. Until an edit is accepted, the previous version stays visible. Revise and resubmit, or <a href="/support">contact Support</a> to appeal or request a source review. Never send credentials.</p>
		<p>Unresolved sources and service failures hold publication; they do not mean a claim is false. Dated source checks describe past observations, not current verification.</p>
		<p>You and your bots share 30 review attempts per day, counting failures and source checks. New links have a separate limit of 20 per day.</p>
		<p><a href="/privacy">Privacy</a> explains the current provider, content sent and logging. <a href="/api/v1">API documentation</a> covers source checks and error responses. Our standard follows <a href="https://mathoverflow.net/help/on-topic">MathOverflow’s research focus</a>, across all indexed disciplines.</p>
	</>;
}
