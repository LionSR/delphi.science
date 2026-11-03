// Math typed as Unicode symbols goes back for revision; LaTeX, code, prose and Greek-language text do not.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { notationVerdict, unicodeMath } from './math-notation.ts';
import type { Post } from './moderate.ts';

const comment = (body: string, title?: string): Post => ({ kind: 'comment', on: 'record', body, title });

test('heavy Unicode math is returned with a LaTeX fix', () => {
	const v = notationVerdict(comment('The limit is w_M(g) = ∏ Tr M^{|c|} for g ∈ S_k, so Tr M² ≤ 1 and ρ ⊗ σ fixes it.'));
	assert.equal(v?.decision, 'REQUEST_REVISION');
	assert.equal(v?.verification_needed, false);
	assert.match(v!.reason, /Unicode symbols instead of LaTeX/);
	assert.match(v!.fix!, /\$\.\.\.\$ inline/);
	assert.ok(v!.reason.length <= 500 && v!.fix!.length <= 500);
});

test('the same math in LaTeX, or inside code, passes', () => {
	assert.equal(notationVerdict(comment('The limit is $w_M(g)=\\prod_c \\operatorname{Tr}M^{|c|}$ for $g\\in S_k$, so $\\operatorname{Tr}M^2\\le1$.\n$$\\rho\\otimes\\sigma$$')), null);
	assert.equal(notationVerdict(comment('Display \\[ρ ⊗ σ ≤ ∑ λ\\] and inline \\(ρ²\\) count as TeX.')), null);
	assert.equal(notationVerdict(comment('Run `assert ρ ⊗ σ ≤ ∑ λ²` and\n```\nρ ⊗ σ ≤ ∑ λ²\n```')), null);
});

test('a few stray symbols, Greek-language text, names and punctuation pass', () => {
	assert.equal(notationVerdict(comment('For ε → 0 the bound in Yu–Kos holds … at d = 2.')), null);
	assert.equal(notationVerdict(comment('Η απόδειξη στηρίζεται στο λήμμα 3 και στην ανισότητα του Hölder.')), null);
	assert.deepEqual(unicodeMath('Greek word λήμμα, symbols α and αβ, ℓ² and 𝒩'), ['ℓ', '²', '𝒩', 'α', 'α', 'β']);
});

test('the title counts, and submissions are exempt', () => {
	assert.equal(notationVerdict(comment('See the body.', 'Is ρ⊗σ ≤ ∑ᵢ λᵢ?'))?.decision, 'REQUEST_REVISION');
	assert.equal(notationVerdict({ kind: 'submission', on: 'x', body: 'Upstream abstract with ρ ⊗ σ ≤ ∑ λ² ∈ ℝ.' }), null);
});
