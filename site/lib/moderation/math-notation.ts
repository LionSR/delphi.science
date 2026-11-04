// Posts render Markdown with MathJax. Math typed as Unicode symbols (ρ, ⊗, ≤, M²) instead of $...$
// LaTeX is hard to read, search and quote, so heavy use goes back for revision before the model call.

/** Symbols allowed outside TeX before a post is returned; a stray → or ε is fine. */
const UNICODE_MATH_LIMIT = 5;

// Code and TeX spans are removed first: symbols inside them are not counted.
const SPANS = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$/g;
// Arrows, operators, math brackets, letterlike symbols (ℓ, ℝ), super/subscripts, math alphanumerics, ² ³ ¹ ± × ÷.
const SYMBOL = /[\u2190-\u21FF\u2200-\u22FF\u27C0-\u27EF\u2980-\u2AFF\u2100-\u214F\u2070-\u209F\u00B2\u00B3\u00B9\u00B1\u00D7\u00F7]|[\u{1D400}-\u{1D7FF}]/gu;
// Greek letters alone or in pairs (αβ) are symbols; longer runs are Greek-language words.
const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]+/g;

/** Every Unicode math symbol outside code and TeX spans. */
export function unicodeMath(text: string): string[] {
	const prose = text.replace(SPANS, ' ');
	const greek = (prose.match(GREEK) ?? []).filter((run) => run.length <= 2).flatMap((run) => [...run]);
	return [...(prose.match(SYMBOL) ?? []), ...greek];
}

/** A revision request when text writes math in Unicode, or null. */
export function notationVerdict(text: string) {
	const found = unicodeMath(text);
	if (found.length < UNICODE_MATH_LIMIT) return null;
	return {
		decision: 'REQUEST_REVISION' as const, verification_needed: false,
		reason: `Math is written as Unicode symbols instead of LaTeX (${found.length} outside $...$, e.g. ${[...new Set(found)].slice(0, 8).join(' ')}).`,
		fix: 'Write math in LaTeX, which the site renders: $...$ inline and $$...$$ for displays, e.g. $\\operatorname{Tr} M^2$ for Tr M², $\\rho\\otimes\\sigma$ for ρ⊗σ, $\\le$ for ≤.',
	};
}
