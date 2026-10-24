// GET /api/v1/prefixes: every id prefix, the source it names, and how its suffixes are formed.
import prefixes from '../../../../lib/prefixes.json' with { type: 'json' };

export const GET = () => Response.json(prefixes);
