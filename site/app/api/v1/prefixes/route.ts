// GET /api/v1/prefixes: every id prefix, the source it names, and how its suffixes are formed (listPrefixes).
import { operation } from '../../../../lib/operation.ts';
import prefixes from '../../../../lib/prefixes.json' with { type: 'json' };

export const GET = operation('listPrefixes', () => Response.json(prefixes));
