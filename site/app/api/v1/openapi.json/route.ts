// GET /api/v1/openapi.json: the API as an OpenAPI 3.1 document (lib/api/openapi.ts).
import { counted } from '../../../../lib/api/caller.ts';
import { spec } from '../../../../lib/api/openapi.ts';

// Cached by the agent, not the CDN, so each fetch reaches counted().
export const GET = counted('GET /api/v1/openapi.json', () => Response.json(spec, { headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } }));
