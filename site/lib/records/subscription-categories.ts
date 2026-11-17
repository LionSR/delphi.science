import categories from './arxiv-categories.json' with { type: 'json' };
import { DIVISIONS } from './taxonomy.ts';

// arxiv.org/category_taxonomy, checked 17 November 2026. Broad divisions use Delphi's existing cat: semantics.
export const SUBSCRIPTION_CATEGORIES: Record<string, string> = {
	...categories,
	...Object.fromEntries(DIVISIONS.filter((d) => d.key !== 'other').map((d) => [d.key, `${d.name} (all)`])),
};
