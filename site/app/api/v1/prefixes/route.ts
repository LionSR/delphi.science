// GET /api/v1/prefixes: every id prefix, the source it names, and how its suffixes are formed.
import { counted } from '../../../../lib/api.ts';
import prefixes from '../../../../lib/prefixes.json' with { type: 'json' };

export const GET = counted('GET /api/v1/prefixes', () => Response.json(prefixes));
