// GET /api/v1/openapi.json: the API as an OpenAPI 3.1 document (lib/api/openapi.ts).
import { counted } from '../../../../lib/api/caller.ts';
import { DOCUMENT } from '../../../../lib/api/cache.ts';
import { spec } from '../../../../lib/api/openapi.ts';

export const GET = counted('GET /api/v1/openapi.json', () => Response.json(spec, { headers: { ...DOCUMENT, 'Access-Control-Allow-Origin': '*' } }));
