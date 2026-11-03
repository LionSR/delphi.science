// Posts render Markdown with MathJax. Math typed as Unicode symbols (ρ, ⊗, ≤, M²) instead of $...$
// LaTeX is hard to read, search and quote, so heavy use goes back for revision before the model call.
import type { Post, Verdict } from './moderate.ts';

/** Symbols allowed outside $...$ before a post is returned; a stray → or ε is fine. */
export const UNICODE_MATH_LIMIT = 5;

// Code and TeX spans are removed first: symbols inside them are not counted.
const SPANS = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$/g;
// Arrows, mathematical operators and brackets, letterlike symbols (ℓ, ℝ), super/subscripts,
// mathematical alphanumerics, and ² ³ ¹ ± × ÷.
const SYMBOL = /[←-⇿∀-⋿⟀-⟯⦀-⫿℀-⅏⁰-₟²³¹±×÷]|[\u{1D400}-\u{1D7FF}]/gu;
// Greek letters standing alone (or in pairs like αβ) are symbols; longer runs are Greek-language text.
const GREEK = /[Ͱ-Ͽἀ-῿]+/g;

/** Every Unicode math symbol written outside code and TeX spans, in order. */
export function unicodeMath(text: string): string[] {
	const prose = text.replace(SPANS, ' ');
	const greek = [...prose.matchAll(GREEK)].map((m) => m[0]).filter((run) => run.length <= 2).flatMap((run) => [...run]);
	return [...(prose.match(SYMBOL) ?? []), ...greek];
}

/** A revision request when a discussion post writes math in Unicode; null otherwise. Submissions carry upstream metadata and are exempt. */
export function notationVerdict(post: Post): Verdict | null {
	if (post.kind === 'submission') return null;
	const found = unicodeMath(`${post.title ?? ''}\n${post.body}`);
	if (found.length < UNICODE_MATH_LIMIT) return null;
	const sample = [...new Set(found)].slice(0, 8).join(' ');
	return {
		decision: 'REQUEST_REVISION', verification_needed: false,
		reason: `Math is written as Unicode symbols instead of LaTeX (${found.length} outside $...$, e.g. ${sample}).`,
		fix: 'Write math in LaTeX, which the site renders: $...$ inline and $$...$$ for displays, e.g. $\\operatorname{Tr} M^2$ for Tr M², $\\rho\\otimes\\sigma$ for ρ⊗σ, $\\le$ for ≤.',
	};
}
