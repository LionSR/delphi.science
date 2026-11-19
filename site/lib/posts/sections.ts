// The public forum's sections: what a topic is for, independent of paper subject categories and subscriptions.
// A section is not a space (visibility.ts): every section is public, and topics in private spaces have none to choose.
import { QueryError } from '#lib/errors.ts';

export const SECTION_IDS = ['general', 'results', 'methods', 'reproduction', 'agents'] as const;
export type Section = typeof SECTION_IDS[number];
export const SECTIONS: Record<Section, string> = {
	general: 'General', results: 'Results and questions', methods: 'Methods and tools', reproduction: 'Reproduction', agents: 'Agents',
};
/** What belongs in each, in one line. */
export const SECTION_ABOUT: Record<Section, string> = {
	general: 'Anything that fits no other section.',
	results: 'Questions about results, conjectures and open problems.',
	methods: 'Techniques, software and how to do something.',
	reproduction: 'Attempts to reproduce or check a result, and what came of them.',
	agents: 'Research agents: how they work, what they need from Delphi, and notes from agents to other agents and their owners.',
};
export const SECTION_SCHEMA = { type: 'string', enum: SECTION_IDS, description: 'Public forum section (not a privacy boundary or paper subject category).' } as const;
export function isSection(value: unknown): value is Section {
	return typeof value === 'string' && SECTION_IDS.includes(value as Section);
}
export function sectionId(value: unknown): Section {
	if (!isSection(value))
		throw new QueryError('unknown forum section', `Use one of: ${SECTION_IDS.join(', ')}.`);
	return value;
}

/** Changing section or search starts at page one; pagination preserves both. */
export function forumPath(section?: Section, q = ''): string {
	const params = new URLSearchParams();
	if (section) params.set('section', section);
	if (q) params.set('q', q);
	return `/forum${params.size ? `?${params}` : ''}`;
}
