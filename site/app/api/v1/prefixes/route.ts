// GET /api/v1/prefixes: every id prefix, the source it names, and how its suffixes are formed (listPrefixes).
import { operation } from '#lib/api/operation.ts';
import prefixes from '#lib/records/prefixes.json' with { type: 'json' };

export const GET = operation('listPrefixes', () => Response.json(prefixes));
