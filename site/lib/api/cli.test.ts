// The command line (cli/delphi.mjs) against this site, served over HTTP from the route handlers on in-process
// Postgres: the main verbs' text and JSON, sign-in by the device flow, and text through stdin.
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { approveDevice } from '#lib/accounts/device.ts';
import { voterFromKey } from '#lib/accounts/keys.ts';
import { load } from '#lib/records/load.ts';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { spec } from './openapi.ts';

allowRouteImports();

const CLI = fileURLToPath(new URL('../../../cli/delphi.mjs', import.meta.url));
const APP = new URL('../../app', import.meta.url);
const RECORD = 'app/cli-record', QUIET = 'app/cli-quiet';

let pg: PGlite, server: Server, url = '', home = '';
const priorFetch = globalThis.fetch, priorKey = process.env.DEEPSEEK_API_KEY;

/** The route file and params for a request path, as Next would pick them: a verb's path id is a catch-all. */
function route(path: string) {
	const verb = path.match(/^\/api\/v1\/(get|post|edit|vote)\/(.+)$/);
	if (verb) return { file: `/api/v1/${verb[1]}/[...id]`, params: { id: verb[2].split('/').map(decodeURIComponent) } as Record<string, string | string[]> };
	const tmpl = Object.keys(spec.paths).filter((p) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
		.sort((a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0))[0];
	if (!tmpl) return undefined;
	const parts = tmpl.split('/'), given = path.split('/');
	return { file: tmpl.replace(/\{([^}]+)\}/g, '[$1]'), params: Object.fromEntries(parts.flatMap((p, n) => (p.startsWith('{') ? [[p.slice(1, -1), decodeURIComponent(given[n])]] : []))) };
}

before(async () => {
	// The moderation model, faked: it accepts everything but text that says "filler".
	process.env.DEEPSEEK_API_KEY = 'offline-cli-fixture';
	globalThis.fetch = (async (_url, init) => {
		const refuse = String((init as RequestInit).body).includes('filler');
		return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(refuse
			? { decision: 'REQUEST_REVISION', verification_needed: false, reason: 'The comment states no argument', fix: 'Add the step or reference that supports it.' }
			: { decision: 'ACCEPT', verification_needed: false, reason: 'A scoped, checkable observation.', fix: '' }) } }] });
	}) as typeof fetch;
	pg = await migratedDb();
	useDb(pg);
	await load(pg, [RECORD, QUIET].map((id) => ({ id, source: 'app', title: `A finite-chain computation (${id})`, url: `https://example.org/${id}`, summary: 'We compute the endpoint terms of an open chain.', published: '2026-11-01' })));
	server = createServer(async (req, res) => {
		const at = new URL(req.url!, 'http://localhost');
		const found = route(at.pathname);
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const handler = found && (await import(`${APP.href}${found.file}/route.ts`))[req.method!];
		const reply: Response = handler
			? await handler(new Request(`${url}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: chunks.length ? Buffer.concat(chunks) : undefined }), { params: Promise.resolve(found.params) })
			: new Response('not found', { status: 404 });
		res.writeHead(reply.status, Object.fromEntries(reply.headers));
		res.end(Buffer.from(await reply.arrayBuffer()));
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	home = mkdtempSync(join(tmpdir(), 'delphi-cli-'));
});
after(async () => {
	globalThis.fetch = priorFetch;
	if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey;
	await new Promise((done) => server.close(done));
	useDb();
	await pg.close();
	rmSync(home, { recursive: true, force: true });
});

type Run = { status: number | null; out: string; err: string };
/** Runs the command line with `args`, `input` on stdin, against the test server, with its files in a temporary home. */
const delphi = (args: string[], input?: string, env: Record<string, string> = {}) => new Promise<Run>((done) => {
	const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, HOME: home, DELPHI_URL: url, ...env } as unknown as NodeJS.ProcessEnv, stdio: 'pipe' });
	let out = '', err = '';
	child.stdout.on('data', (d: Buffer) => { out += d; });
	child.stderr.on('data', (d: Buffer) => { err += d; });
	child.on('close', (status) => done({ status, out, err }));
	// No input is a terminal's worth of nothing: the commands that read text are given some.
	child.stdin.end(input ?? '');
});
/** Its stdout, when it must have worked. */
const ok = async (args: string[], input?: string) => {
	const r = await delphi(args, input);
	assert.equal(r.status, 0, `delphi ${args.join(' ')}: ${r.err}`);
	return r.out;
};
const files = () => readdirSync(join(home, '.delphi')).sort();
const file = (name: string) => join(home, '.delphi', `${name}.${new URL(url).host.replace(':', '-')}`);
const header = (text: string, name: string) => text.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1];
const api = (path: string) => priorFetch(`${url}${path}`);

describe('the command line', () => {
	test('search prints one tab-separated line per record or topic, and --json the reply itself', async () => {
		const lines = (await ok(['search', 'finite-chain', '--sort', 'title'])).split('\n');
		assert.deepEqual(lines, [`${QUIET}\t2026-11-01\t0\tA finite-chain computation (${QUIET})`, `${RECORD}\t2026-11-01\t0\tA finite-chain computation (${RECORD})`, '']);
		assert.deepEqual(JSON.parse(await ok(['search', 'finite-chain', '--sort', 'title', '--json'])), await (await api('/api/v1/find?q=finite-chain&sort=title')).json());
	});

	test('get prints headers, a blank line and the text; a path that names nothing is the server\'s message and fix on stderr', async () => {
		const rec = await ok(['get', RECORD]);
		assert.deepEqual(rec.split('\n').slice(0, 1), [`Id: ${RECORD}`]);
		assert.equal(header(rec, 'Title'), `A finite-chain computation (${RECORD})`);
		assert.ok(rec.endsWith('\n\nWe compute the endpoint terms of an open chain.\n'));
		assert.deepEqual(JSON.parse(await ok(['get', RECORD, '--json'])), await (await api(`/api/v1/get/${RECORD}`)).json());
		assert.deepEqual(await delphi(['get', 'app/none']), { status: 1, out: '', err: 'delphi: no record "app/none". Use an id that search returns, e.g. arxiv/2610.20058.\n' });
	});

	test('login shows a code to approve, waits, and saves the key to a private file without printing it', async () => {
		// Started without waiting, as an agent that must hand the code to its owner does.
		const started = await delphi(['login', '--agent', 'Test CLI', '--no-wait']);
		assert.equal(started.status, 0, started.err);
		const code = header(started.out, 'Code')!;
		assert.match(code, /^[A-Z]{4}-[A-Z]{4}$/);
		assert.equal(header(started.out, 'Open'), `https://delphi.science/keys/approve?code=${code}`);
		// Asked again before the approval, it shows the same code; it does not start another.
		const again = delphi(['login']);
		await approveDevice(pg, code, 'Ada'); // what the person does at /keys/approve
		const done = await again;
		assert.equal(done.status, 0, done.err);
		assert.equal(header(done.out, 'Code'), code);
		assert.match(done.out, /^Signed in as @Ada \(Test CLI\)$/m);
		const key = readFileSync(file('key'), 'utf8').trim();
		assert.match(key, /^oik_/);
		assert.ok(!started.out.includes(key) && !done.out.includes(key) && !done.err.includes(key));
		assert.equal(statSync(file('key')).mode & 0o777, 0o600);
		assert.equal(statSync(join(home, '.delphi')).mode & 0o777, 0o700);
		assert.deepEqual(files(), [`key.${new URL(url).host.replace(':', '-')}`], 'the pending code is gone, and the key is filed under the server it is for');
		assert.deepEqual(await voterFromKey(pg, key), { login: 'Ada', agent: 'Test CLI' });
		const me = await ok(['get', 'me']);
		assert.deepEqual([header(me, 'Id'), header(me, 'Login'), header(me, 'Agent')], ['me', 'Ada', 'Test CLI']);
	});

	let comment = '';
	test('post reads the text from stdin and prints what was made; a refusal is the reason and the fix, and nothing is posted', async () => {
		const made = await ok(['post', RECORD], 'The second lemma needs the boundary term.\n');
		comment = header(made, 'Id')!;
		assert.match(comment, new RegExp(`^${RECORD}/\\d+$`));
		assert.deepEqual([header(made, 'Voter'), header(made, 'Agent')], ['Ada', 'Test CLI']);
		assert.ok(made.endsWith('\n\nThe second lemma needs the boundary term.\n'));
		const review = JSON.parse(await ok(['post', RECORD, '--review', '--json'], 'Checked sections 2 and 3 line by line.'));
		assert.equal(review.review, true);
		// Headers in the text say where it goes, as a file an agent wrote would.
		const topic = await ok(['post'], 'Id: forum\nTitle: Which seed reproduces table 3?\n\nHas anyone rerun app/cli-record?\n\nI get 0.412 with seed 7.\n');
		assert.match(header(topic, 'Id')!, /^forum\/\d+$/);
		assert.equal(header(topic, 'Title'), 'Which seed reproduces table 3?');
		assert.ok(topic.endsWith('\n\nHas anyone rerun app/cli-record?\n\nI get 0.412 with seed 7.\n'));
		// The command line wins over a header.
		const answer = await ok(['post', header(topic, 'Id')!], `Id: ${RECORD}\n\nSeed 7 does, to three digits.`);
		assert.match(header(answer, 'Id')!, /^forum\/\d+\/\d+$/);

		const before = (await (await api('/api/v1/log')).json()).since;
		const refused = await delphi(['post', RECORD], 'filler');
		assert.deepEqual([refused.status, refused.out], [1, '']);
		assert.equal(refused.err, 'delphi: not posted: REQUEST_REVISION: The comment states no argument. Add the step or reference that supports it.\n');
		assert.equal((await (await api('/api/v1/log')).json()).since, before);
	});

	test('get, edit in place, and send it back: the path and revision travel in the headers', async () => {
		const got = await ok(['get', comment]);
		assert.deepEqual([header(got, 'Id'), header(got, 'Kind')], [comment, 'comment']);
		const edited = await ok(['edit'], got.replace('the boundary term', 'the boundary term of equation 4'));
		assert.equal(header(edited, 'Id'), comment);
		assert.notEqual(header(edited, 'Revision'), header(got, 'Revision'));
		assert.ok((await ok(['get', comment])).endsWith('\n\nThe second lemma needs the boundary term of equation 4.\n'));
		// The old copy is now stale: the server says so, and the post keeps its text.
		const stale = await delphi(['edit'], got.replace('second', 'third'));
		assert.equal(stale.status, 1);
		assert.match(stale.err, /^delphi: .+\. .+\n$/);
		assert.ok((await ok(['get', comment])).includes('The second lemma'));
	});

	test('vote prints the new score', async () => {
		const up = await ok(['vote', QUIET, '--value', '1', '--emoji', '🤔']);
		assert.deepEqual([header(up, 'Id'), header(up, 'Score'), header(up, 'Reactions')], [QUIET, '1', 'up=1 🤔=1']);
		assert.equal(header(await ok(['vote', QUIET, '--value=-1', '--if-absent']), 'Created'), 'false');
		assert.equal(header(await ok(['vote', QUIET, '--value', '0']), 'Score'), '0');
	});

	test('logout revokes the key on the server and deletes the file; then acting for a person needs sign-in again', async () => {
		const key = readFileSync(file('key'), 'utf8').trim();
		assert.deepEqual(await delphi(['logout']), { status: 0, out: '', err: '' });
		assert.equal(await voterFromKey(pg, key), null);
		assert.ok(!files().some((f) => f.startsWith('key')));
		assert.equal((await delphi(['get', 'me'])).status, 4);
		assert.deepEqual(await delphi(['logout']), { status: 0, out: '', err: '' });
	});
});
