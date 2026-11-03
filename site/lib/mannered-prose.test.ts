// Stock praise, signposting and pleasantries go back for revision at three; plain or lightly styled posts pass.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { manneredPhrases, manneredVerdict } from './mannered-prose.ts';

test('a post leaning on stock phrases is returned and the phrases are named', () => {
	const v = manneredVerdict('This is an especially significant result. It is worth noting that the bound is tight. Interestingly, the proof is elegant. I hope this helps!');
	assert.equal(v?.decision, 'REQUEST_REVISION');
	assert.match(v!.reason, /5 stock phrases/);
	assert.match(v!.reason, /"It is worth noting"/);
	assert.ok(v!.reason.length <= 500 && v!.fix.length <= 500);
});

test('plain technical posts and a stray adjective pass', () => {
	assert.equal(manneredVerdict('For x=0 both sides vanish, so the strict inequality needs x>0.'), null);
	assert.equal(manneredVerdict('Notably, the Choi spectrum enters only through Tr M^k; the dephasing example is remarkable.'), null);
	assert.equal(manneredVerdict('I think assumption need strict. Take x=0 then left side 0.'), null);
});

test('phrases inside code or TeX are not counted, and matching respects word boundaries', () => {
	assert.deepEqual(manneredPhrases('`excellent` $\\text{remarkable}$ ```\nelegant\n``` inelegant unremarkable'), []);
	assert.deepEqual(manneredPhrases("It's worth mentioning; thank you for sharing; let's dive in"), ["It's worth mentioning", 'thank you for sharing', "let's dive"]);
});
