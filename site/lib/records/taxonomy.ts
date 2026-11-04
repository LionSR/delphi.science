// The subject taxonomy: the rules of taxonomy.py (is_code, division_of), read from the JSON its build writes.
import taxonomy from './taxonomy.json' with { type: 'json' };

export const DIVISIONS = taxonomy.divisions;

/** The division a subject code falls under, by prefix; 'other' when none matches. */
export const divisionOf = (c: string) =>
	taxonomy.divisions.find((d) => d.prefixes.some((p) => c === p || c.startsWith(p + '.') || c.startsWith(p + '-')))?.key ?? 'other';

/** Whether a code is one the taxonomy names. */
export const isNamedSubject = (c: string) => c in taxonomy.names;

/** Whether a string looks like a subject code and is one the taxonomy knows, by name or by division. */
export const isSubjectCode = (c: string) => /^[a-z]+(?:-[a-z]+)?(?:\.[A-Za-z-]+)?$/.test(c) && (isNamedSubject(c) || divisionOf(c) !== 'other');

/** The code for a subject's name, case-insensitively, if the taxonomy has it. */
export const subjectNamed = (name: string): string | undefined => (taxonomy.from_name as Record<string, string>)[name.toLowerCase()];
