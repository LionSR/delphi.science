// Reads {"url"} from stdin and prints readPublicWeb's result as JSON, or {"error": <status>}; sources.py calls it.
import { readFileSync } from 'node:fs';
import { readPublicWeb, RetrievalError } from '#lib/moderation/source-fetch.ts';

try {
	const raw = readFileSync(0, 'utf8');
	if (raw.length > 4096) throw new Error('bounded input required');
	process.stdout.write(JSON.stringify(await readPublicWeb(JSON.parse(raw).url)));
} catch (error) {
	process.stdout.write(JSON.stringify({ error: error instanceof RetrievalError ? error.status : 'unavailable' }));
}
