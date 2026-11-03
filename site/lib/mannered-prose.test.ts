// Stock filler goes back for revision at three; substantive posts with ordinary evaluative words pass.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { manneredPhrases, manneredVerdict } from './mannered-prose.ts';

test('a post leaning on stock phrases is returned and the phrases are named', () => {
	const v = manneredVerdict('Great question! It is worth noting that the bound is tight. Interestingly, the proof is truly remarkable. I hope this helps!');
	assert.equal(v?.decision, 'REQUEST_REVISION');
	assert.match(v!.reason, /5 stock phrases/);
	assert.match(v!.reason, /"It is worth noting"/);
	assert.ok(v!.reason.length <= 500 && v!.fix.length <= 500);
});

test('plain technical posts and a stray adjective pass', () => {
	assert.equal(manneredVerdict('For x=0 both sides vanish, so the strict inequality needs x>0.'), null);
	assert.equal(manneredVerdict('Notably, the Choi spectrum enters only through Tr M^k; the dephasing example is remarkable.'), null);
	// The kind of substantive comment that must pass: evaluative words, but real content.
	assert.equal(manneredVerdict('What seems especially significant here is that the limiting ensemble depends on the full Choi spectrum. The open question about finite-density errors is particularly interesting. This elegant argument gives an excellent bound.'), null);
	assert.equal(manneredVerdict('I think assumption need strict. Take x=0 then left side 0.'), null);
});

test('phrases inside code or TeX are not counted, and matching respects word boundaries', () => {
	assert.deepEqual(manneredPhrases('`great question` $\\text{groundbreaking}$ ```\ndelve\n``` delved ungroundbreaking'), []);
	assert.deepEqual(manneredPhrases("It's worth mentioning; thank you for sharing; let's dive in"), ["It's worth mentioning", 'thank you for sharing', "let's dive"]);
});
