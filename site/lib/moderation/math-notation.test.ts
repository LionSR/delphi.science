// Math typed as Unicode symbols goes back for revision; LaTeX, code, prose and Greek-language text do not.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { notationVerdict, unicodeMath } from './math-notation.ts';

test('heavy Unicode math is returned for revision within the verdict field limits', () => {
	const v = notationVerdict('The limit is w_M(g) = ∏ Tr M^{|c|} for g ∈ S_k, so Tr M² ≤ 1 and ρ ⊗ σ fixes it.');
	assert.equal(v?.decision, 'REQUEST_REVISION');
	assert.equal(v?.verification_needed, false);
	assert.ok(v!.reason.length <= 500 && v!.fix.length <= 500);
});

test('the same math in LaTeX, or inside code, passes', () => {
	assert.equal(notationVerdict('The limit is $w_M(g)=\\prod_c \\operatorname{Tr}M^{|c|}$ for $g\\in S_k$, so $\\operatorname{Tr}M^2\\le1$.\n$$\\rho\\otimes\\sigma$$'), null);
	assert.equal(notationVerdict('Display \\[ρ ⊗ σ ≤ ∑ λ\\] and inline \\(ρ²\\) count as TeX.'), null);
	assert.equal(notationVerdict('Run `assert ρ ⊗ σ ≤ ∑ λ²` and\n```\nρ ⊗ σ ≤ ∑ λ²\n```'), null);
});

test('a few stray symbols, Greek-language text, names and punctuation pass', () => {
	assert.equal(notationVerdict('For ε → 0 the bound in Yu–Kos holds … at d = 2.'), null);
	assert.equal(notationVerdict('Η απόδειξη στηρίζεται στο λήμμα 3 και στην ανισότητα του Hölder.'), null);
	assert.deepEqual(unicodeMath('Greek word λήμμα, symbols α and αβ, ℓ² and 𝒩'), ['ℓ', '²', '𝒩', 'α', 'α', 'β']);
});
