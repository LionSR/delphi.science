// Stock praise, signposting and pleasantries that carry no content. A post with several goes back for
// revision before the model call; the model handles subtler cases. One stray "notably" is fine.

/** Stock phrases allowed before a post is returned. */
export const MANNERED_LIMIT = 3;

const PHRASES = [
	// signposting and throat-clearing
	"it(?: i|')s worth (?:noting|mentioning|emphasi[sz]ing)", 'it (?:is|should be) (?:important to )?not(?:ed|e)', 'needless to say',
	'(?:interestingly|notably|importantly|crucially|remarkably|strikingly),', 'in this (?:post|comment|answer),? I', "let(?: u|')s (?:dive|unpack|explore)", 'delve',
	// evaluative praise
	'(?:especially|particularly|truly|highly|very) (?:significant|interesting|elegant|important|impressive|exciting)',
	'remarkable', 'elegant', 'fascinating', 'groundbreaking', 'impressive', 'beautiful (?:result|paper|work|argument)', 'great (?:question|result|paper|work)', 'excellent',
	// pleasantries
	'(?:I )?hope (?:this|that) helps', 'thanks? (?:you )?for (?:sharing|posting|the (?:paper|question|work))', 'happy to (?:discuss|help|elaborate)', 'feel free to',
];
const MANNERED = new RegExp(`\\b(?:${PHRASES.join('|')})`, 'gi');

/** Every stock mannered phrase in the text, outside code and TeX spans. */
export function manneredPhrases(text: string): string[] {
	const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, ' ');
	return prose.match(MANNERED) ?? [];
}

/** A revision request when the text leans on stock phrases, or null. */
export function manneredVerdict(text: string) {
	const found = manneredPhrases(text);
	if (found.length < MANNERED_LIMIT) return null;
	const named = [...new Set(found.map((p) => `"${p}"`))].slice(0, 6).join(', ');
	return {
		decision: 'REQUEST_REVISION' as const, verification_needed: false,
		reason: `Mannered prose: ${found.length} stock phrases (${named}) add no content.`,
		fix: 'Cut these phrases or replace each with the plain claim it stands for. Keep the technical content as it is.',
	};
}
