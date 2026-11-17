// The command line (cli/delphi.mjs) against this site, served over HTTP from the route handlers on in-process
// Postgres: each verb's text and JSON, sign-in by the device flow, the log cursor, text through stdin, and exit statuses.
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import { operations, spec, VERBS } from './openapi.ts';

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
	test('its commands, options and help are the OpenAPI document\'s', async () => {
		const overview = await ok(['--help']);
		for (const v of VERBS) assert.match(overview, new RegExp(`^  ${v} +${operations.find((o) => o.operationId === v)!.summary}`, 'm'), v);
		assert.match(overview, /^  login /m);
		assert.match(overview, /^  logout /m);
		assert.equal(await ok([]), overview);
		const unwrapped = (s: string) => s.replace(/\s+/g, ' ');
		for (const v of VERBS) {
			const op = operations.find((o) => o.operationId === v)!, help = unwrapped(await ok([v, '--help']));
			assert.ok(help.includes(unwrapped(op.description!)), `${v}: its description`);
			for (const p of op.parameters.filter((p) => p.name !== 'format')) assert.ok(help.includes(unwrapped(p.description ?? p.schema.description!)), `${v} ${p.name}`);
			for (const [name, s] of Object.entries(op.body?.properties ?? {})) {
				assert.ok(help.includes(name === 'body' ? 'stdin' : `--${name.replaceAll('_', '-')}`), `${v} ${name}`);
				if (s.description) assert.ok(help.includes(unwrapped(s.description)), `${v} ${name}: its description`);
			}
		}
		assert.equal(await ok(['help', 'log']), await ok(['log', '--help']));
		assert.match(await ok(['--version']), /^\d+\.\d+\.\d+\n$/);
	});

	test('search prints one tab-separated line per record or topic, and --json the reply itself', async () => {
		const lines = (await ok(['search', 'finite-chain', '--sort', 'title'])).split('\n');
		assert.deepEqual(lines, [`${QUIET}\t2026-11-01\t0\tA finite-chain computation (${QUIET})`, `${RECORD}\t2026-11-01\t0\tA finite-chain computation (${RECORD})`, '']);
		assert.deepEqual(JSON.parse(await ok(['search', 'finite-chain', '--sort', 'title', '--json'])), await (await api('/api/v1/find?q=finite-chain&sort=title')).json());
		// Nothing found is nothing printed.
		assert.deepEqual(await delphi(['search', 'no-such-word-anywhere']), { status: 0, out: '', err: '' });
		assert.equal(await ok(['search', '--in', 'forum']), '');
		// More than a page: where the next one starts goes to stderr, out of the pipe's way.
		const first = await delphi(['search', 'finite-chain', '--limit=1']);
		assert.equal(first.out.split('\n').length, 2);
		assert.match(first.err, /^delphi: 1 of 2; the next page: --cursor \S+\n$/);
	});

	test('get prints headers, a blank line and the text; a path that names nothing is the server\'s message and fix on stderr', async () => {
		const rec = await ok(['get', RECORD]);
		assert.deepEqual(rec.split('\n').slice(0, 1), [`Id: ${RECORD}`]);
		assert.equal(header(rec, 'Title'), `A finite-chain computation (${RECORD})`);
		assert.ok(rec.endsWith('\n\nWe compute the endpoint terms of an open chain.\n'));
		assert.deepEqual(JSON.parse(await ok(['get', RECORD, '--json'])), await (await api(`/api/v1/get/${RECORD}`)).json());
		assert.deepEqual(await delphi(['get', 'app/none']), { status: 1, out: '', err: 'delphi: no record "app/none". Use an id that search returns, e.g. arxiv/2610.20058.\n' });
		assert.deepEqual(await delphi(['get', 'forum']), { status: 1, out: '', err: 'delphi: "forum" is a list, not one thing. Use log for its posts, or search for its records (in=forum for topics).\n' });
	});

	test('exit statuses: 2 for bad usage, 3 when the server is not reached, 4 when sign-in is needed', async () => {
		for (const args of [['frobnicate'], ['get'], ['get', RECORD, 'extra'], ['log', '--sinse', '3'], ['log', '--since', 'soon'], ['log', '--since'], ['log', '--new', '--since', '3'], ['log', '-q'], ['log', '-q', 'kind:record', '-f', 'queries'], ['log', '-f', 'no-such-file'], ['help', 'frobnicate'], ['logout', 'now']]) {
			const r = await delphi(args);
			assert.deepEqual([r.status, r.out], [2, ''], args.join(' '));
			assert.match(r.err, /^delphi: /);
		}
		assert.match((await delphi(['log', '--sinse', '3'])).err, /log has no --sinse\. It takes: --q, --since, --limit, -f, --json, --new/);
		const down = await delphi(['get', RECORD], undefined, { DELPHI_URL: 'http://127.0.0.1:9' });
		assert.deepEqual([down.status, down.out], [3, '']);
		assert.match(down.err, /^delphi: cannot reach http:\/\/127\.0\.0\.1:9: /);
		// Nobody is signed in yet: the commands that act for a person say so without asking the server, and get me asks it.
		for (const args of [['vote', RECORD, '--value', '1'], ['get', 'me']]) {
			const r = await delphi(args);
			assert.deepEqual([r.status, r.out], [4, ''], args.join(' '));
			assert.match(r.err, /^delphi: sign-in required\. .*delphi login/);
		}
		assert.equal((await delphi(['post', RECORD], 'A reading.')).status, 4);
		// The server's own refusals are 1 (above: get of a path that names nothing).
		assert.equal((await delphi(['log', 'nowhere'])).status, 1);
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
		// The key goes only to the server that issued it: the same home has none for another server.
		const elsewhere = await delphi(['vote', RECORD, '--value', '1'], undefined, { DELPHI_URL: 'http://127.0.0.1:9' });
		assert.equal(elsewhere.status, 4, 'refused here, before anything is sent there');
	});

	test('login waits through authorization_pending, and a denied code is the server\'s refusal', async () => {
		const other = mkdtempSync(join(tmpdir(), 'delphi-cli-'));
		try {
			const waiting = delphi(['login', '--agent', 'Slow CLI'], undefined, { HOME: other });
			// The code is stored as soon as it is shown; approve it after the first poll has come back pending.
			let code = '';
			for (let n = 0; n < 100 && !code; n++) {
				await new Promise((r) => setTimeout(r, 50));
				code = (await pg.query<{ user_code: string }>("SELECT user_code FROM open_index.device_codes WHERE agent = 'Slow CLI'")).rows[0]?.user_code ?? '';
			}
			await new Promise((r) => setTimeout(r, 300));
			await approveDevice(pg, code, 'Grace');
			const done = await waiting;
			assert.equal(done.status, 0, done.err);
			assert.match(done.out, new RegExp(`^Code: ${code}\\nOpen: \\S+\\nSigned in as @Grace \\(Slow CLI\\)\\n$`));
			assert.match(done.err, /waiting for the person to approve the code/);

			const started = await delphi(['login', '--no-wait'], undefined, { HOME: other, DELPHI_URL: `${url}/` });
			await pg.query('UPDATE open_index.device_codes SET used_at = now() WHERE user_code = $1', [header(started.out, 'Code')]); // denied
			const denied = await delphi(['login'], undefined, { HOME: other });
			assert.equal(denied.status, 1);
			assert.match(denied.err, /^delphi: this device code is unknown, used, denied, or expired\. Start again/m);
		} finally { rmSync(other, { recursive: true, force: true }); }
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
		assert.deepEqual(await delphi(['post', RECORD], '  \n'), { status: 2, out: '', err: 'delphi: the text is empty\n' });
		assert.equal((await delphi(['post', RECORD, '--title', 'T'], 'A reading.')).err, `delphi: title does not apply to "${RECORD}". Leave title out; it is for a new topic (id forum).\n`);
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
		// The same, with the path and revision given by hand.
		const now = header(await ok(['get', comment]), 'Revision')!;
		assert.equal(header(await ok(['edit', comment, '--revision', now], 'The second lemma needs the boundary term of equation 5.'), 'Id'), comment);
		assert.equal((await delphi(['edit', comment], 'No revision given.')).status, 2);
	});

	test('vote prints the new score', async () => {
		const up = await ok(['vote', QUIET, '--value', '1', '--emoji', '🤔']);
		assert.deepEqual([header(up, 'Id'), header(up, 'Score'), header(up, 'Reactions')], [QUIET, '1', 'up=1 🤔=1']);
		assert.equal(header(await ok(['vote', QUIET, '--value=-1', '--if-absent']), 'Created'), 'false');
		assert.equal(header(await ok(['vote', QUIET, '--value', '0']), 'Score'), '0');
		const empty = await delphi(['vote', QUIET]);
		assert.equal(empty.status, 1);
		assert.match(empty.err, /^delphi: the vote is empty\. Send /);
	});

	test('log prints the server\'s lines; --new prints only what is newer than last time and moves the cursor', async () => {
		const text = await (await api('/api/v1/log?format=text')).text();
		assert.equal(await ok(['log']), text);
		assert.equal(await ok(['log', RECORD, '--limit', '1']), await (await api(`/api/v1/log?path=${RECORD}&limit=1&format=text`)).text());
		assert.deepEqual(JSON.parse(await ok(['log', 'forum', '--json'])), await (await api('/api/v1/log?path=forum')).json());
		assert.deepEqual(await delphi(['log', QUIET]), { status: 0, out: '', err: '' });

		// The first time: the newest posts, and the cursor at the newest of them.
		const newest = Number(text.split('\t')[0]);
		assert.equal(await ok(['log', '--new']), text);
		assert.equal(readFileSync(file('cursor'), 'utf8'), `*\t${newest}\n`);
		assert.equal(statSync(file('cursor')).mode & 0o777, 0o600);
		// Nothing new is nothing printed, and the cursor stays.
		assert.deepEqual(await delphi(['log', '--new']), { status: 0, out: '', err: '' });
		assert.equal(readFileSync(file('cursor'), 'utf8'), `*\t${newest}\n`);
		// Two more posts: exactly those, oldest first, and the cursor moves past them.
		const a = header(await ok(['post', RECORD], 'Equation 4 has the sign of the endpoint term reversed.'), 'Id')!;
		const b = header(await ok(['post', a], 'It does: compare the display above it.'), 'Id')!;
		const fresh = (await ok(['log', '--new'])).split('\n');
		assert.deepEqual(fresh.map((l) => l.split('\t')[2]), [a, b, undefined]);
		assert.deepEqual(fresh[1].split('\t').slice(1, 5), ['comment', b, a, 'Test CLI · @Ada']);
		// The cursor is the entry's seq (the first column), not the post's number.
		const seen = fresh[1].split('\t')[0];
		assert.equal(readFileSync(file('cursor'), 'utf8'), `*\t${seen}\n`);
		assert.equal(await ok(['log', '--new']), '');
		// Each path keeps its own place: the forum has not been read yet, and a quiet record starts at nothing.
		assert.equal(await ok(['log', 'forum', '--new']), await (await api('/api/v1/log?path=forum&format=text')).text());
		assert.equal(await ok(['log', QUIET, '--new']), '');
		const forumNewest = (await (await api('/api/v1/log?path=forum')).json()).since;
		assert.equal(readFileSync(file('cursor'), 'utf8'), `*\t${seen}\nforum\t${forumNewest}\n${QUIET}\t0\n`);
		const c = header(await ok(['post', QUIET], 'The same reversal appears in equation 2 here.'), 'Id')!;
		assert.deepEqual((await ok(['log', QUIET, '--new'])).split('\n').map((l) => l.split('\t')[2]), [c, undefined]);
		// More new posts than a page holds are all listed, a page at a time.
		const paged = JSON.parse(await ok(['log', '--new', '--limit', '1', '--json']));
		assert.deepEqual(paged.entries.map((e: { path: string }) => e.path), [c]);
		assert.equal(await ok(['log', RECORD, '--new']), await (await api(`/api/v1/log?path=${RECORD}&format=text`)).text());
		// A cursor that cannot be moved is not moved quietly: a server that fails leaves it where it was.
		const kept = readFileSync(file('cursor'), 'utf8');
		assert.equal((await delphi(['log', 'nowhere', '--new'])).status, 1);
		assert.equal(readFileSync(file('cursor'), 'utf8'), kept);
	});

	test('log -q narrows by a query and -f by any of a file\'s; each query keeps its own cursor; to:@me is the inbox', async () => {
		const q = 'kind:comment by:@ada';
		const served = async (query: string, more = '') => (await api(`/api/v1/log?q=${encodeURIComponent(query)}${more}&format=text`)).text();
		const text = await ok(['log', '-q', q]);
		assert.ok(text.split('\n').filter(Boolean).length >= 3);
		assert.equal(text, await served(q));
		for (const args of [['log', '--q', q], ['log', `--q=${q}`], ['log', `-q=${q}`]]) assert.equal(await ok(args), text, args.join(' '));
		assert.equal(await ok(['log', RECORD, '-q', 'kind:record']), '');
		assert.deepEqual((await ok(['log', 'app', '-q', 'kind:record'])).split('\n').filter(Boolean).map((l) => l.split('\t')[2]).sort(), [QUIET, RECORD].sort());
		assert.deepEqual(JSON.parse(await ok(['log', '-q', q, '--json'])), await (await api(`/api/v1/log?q=${encodeURIComponent(q)}`)).json());
		// A file of queries, one per line: what matches any of them.
		const list = join(home, 'queries');
		writeFileSync(list, `# what I follow\nkind:record source:app\n\n  ${q}\n`);
		const any = `(kind:record source:app) OR (${q})`;
		assert.equal(await ok(['log', '-f', list]), await served(any));
		assert.equal(await ok(['log', '-f', '-'], `${q}\n`), text);
		assert.equal((await ok(['log', '-f', list])).split('\n').filter(Boolean).length, text.split('\n').filter(Boolean).length + 2);
		// A bad query is the server's message and fix.
		const bad = await delphi(['log', '-q', 'kind:paper']);
		assert.equal(bad.status, 1);
		assert.match(bad.err, /^delphi: unknown kind:paper\. Use kind:record, /);
		// --new with a query: its own line in the cursor file, the query after the seq.
		const before = readFileSync(file('cursor'), 'utf8');
		assert.equal(await ok(['log', '-f', list, '--new']), await served(any));
		const newest = (await served(any)).split('\t')[0];
		assert.equal(readFileSync(file('cursor'), 'utf8'), `${before}*\t${newest}\t${any}\n`);
		assert.equal(await ok(['log', '-f', list, '--new']), '');
		const d = header(await ok(['post', RECORD], 'Lemma 3 also needs the endpoint term.'), 'Id')!;
		assert.deepEqual((await ok(['log', '-f', list, '--new'])).split('\n').map((l) => l.split('\t')[2]), [d, undefined]);
		// The other cursors did not move with it: the unfiltered one still has this post to show.
		assert.deepEqual((await ok(['log', '--new'])).split('\n').map((l) => l.split('\t')[2]).includes(d), true);
		assert.equal(await ok(['log', '-f', list, '--new']), '');
		// The inbox: replies to the signed-in person, by others. Signed out, the server asks for sign-in (status 4).
		assert.equal(await ok(['log', '-q', 'to:@me']), '');
		assert.equal(await ok(['log', '-q', 'by:@me', '--limit', '1']), await served('by:@ada', '&limit=1'));
		const anonymous = await delphi(['log', '-q', 'to:@me'], undefined, { HOME: mkdtempSync(join(tmpdir(), 'delphi-nobody-')) });
		assert.deepEqual([anonymous.status, anonymous.out], [4, '']);
		assert.match(anonymous.err, /^delphi: sign-in required\. .*delphi login/);
	});

	test('logout revokes the key on the server and deletes the file; then acting for a person needs sign-in again', async () => {
		const key = readFileSync(file('key'), 'utf8').trim();
		assert.deepEqual(await delphi(['logout']), { status: 0, out: '', err: '' });
		assert.equal(await voterFromKey(pg, key), null);
		assert.ok(!files().some((f) => f.startsWith('key')));
		assert.equal((await delphi(['get', 'me'])).status, 4);
		assert.deepEqual(await delphi(['logout']), { status: 0, out: '', err: '' });
		// A key from the environment is used without a file, and a stale one does not stop reading what needs none.
		assert.equal((await delphi(['get', 'me'], undefined, { DELPHI_KEY: key })).status, 4);
		assert.equal(header((await delphi(['get', RECORD], undefined, { DELPHI_KEY: key })).out, 'Id'), RECORD);
	});
});
