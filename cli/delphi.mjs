#!/usr/bin/env node
// delphi: the command line for Delphi.science. Six verbs over paths (search, get, log, post, edit, vote), plus login
// and logout. Each verb is the REST operation of the same name; its arguments, options and help are read from
// api.json, which is cut from the site's OpenAPI document (site/scripts/openapi.ts), so nothing about them is typed
// here. Output is plain text for pipes; --json prints the server's reply as it is. State is plain files in ~/.delphi.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const api = JSON.parse(readFileSync(new URL('./api.json', import.meta.url), 'utf8'));
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const HOME_SERVER = api.servers[0].url;
const SERVER = (process.env.DELPHI_URL || HOME_SERVER).replace(/\/+$/, '');
const VERBS = api['x-commands'];

// Exit statuses.
const REFUSED = 1, USAGE = 2, UNREACHABLE = 3, SIGN_IN = 4;
class Failure extends Error {
	constructor(status, message) { super(message); this.status = status; }
}
const usage = (message) => new Failure(USAGE, message);

// ---- The operations, from api.json ----

const OPS = Object.fromEntries(Object.entries(api.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => [op.operationId, { ...op, path, method: method.toUpperCase() }])));
const describe = (p) => p.description ?? p.schema.description ?? '';
/** What an operation takes, in order: the path's parts, the query's, then the body's fields. format is the reply's form, set here. */
function fields(op) {
	const params = (op.parameters ?? []).filter((p) => p.name !== 'format').map((p) => ({ name: p.name, in: p.in, schema: p.schema, description: describe(p), required: p.required === true }));
	const body = op.requestBody?.content['application/json'].schema;
	const inBody = Object.entries(body?.properties ?? {}).map(([name, schema]) => ({ name, in: 'body', schema, description: schema.description ?? '', required: (body.required ?? []).includes(name) }));
	const all = [...params, ...inBody];
	// Given without a name: what the URL's path holds, or else the first thing asked for (a query, a path to list).
	const positional = all.some((f) => f.in === 'path') ? all.filter((f) => f.in === 'path') : all.slice(0, 1);
	return all.map((f) => ({ ...f, positional: positional.includes(f), stdin: f.in === 'body' && f.name === 'body' }));
}
const flag = (name) => `--${name.replaceAll('_', '-')}`;
const isBoolean = (f) => f.schema.type === 'boolean';
const takes = (f) => f.schema.enum ? f.schema.enum.join('|') : f.schema.type === 'integer' ? 'n' : 'text';
const signsIn = (op) => (op.security ?? []).some((s) => Object.keys(s).length);
const optionalSignIn = (op) => (op.security ?? []).some((s) => !Object.keys(s).length);

// ---- Help ----

const wrap = (text, indent, width = 96) => {
	const lines = [];
	for (const word of text.split(/\s+/)) {
		if (lines.length && (lines.at(-1) + ' ' + word).length <= width - indent) lines[lines.length - 1] += ` ${word}`;
		else lines.push(word);
	}
	return lines.join(`\n${' '.repeat(indent)}`);
};
const table = (rows) => {
	const w = Math.max(...rows.map(([a]) => a.length)) + 2;
	return rows.map(([a, b]) => `  ${a.padEnd(w)}${wrap(b, w + 2)}`).join('\n');
};
const LOCAL = {
	search: [['--json', 'Print the reply as JSON. Otherwise one line per result: path, date, score, title, tab-separated.']],
	get: [['--body', 'Print the text alone, without the "Name: value" lines: a post\'s body, or at me/queries the saved queries, ready for a file.'],
		['--json', 'Print the reply as JSON. Otherwise "Name: value" lines, a blank line, then the text.']],
	edit: [['--force', 'Take the revision from the server now instead of giving one: what is sent replaces what is there, whatever it has become.'],
		['--json', 'Print the reply as JSON. Otherwise "Name: value" lines, a blank line, then the text if any.']],
	log: [['-q <query>', 'The same as --q.'],
		['-f <file>', 'Queries from a file, one per line; an entry is listed when it matches any of them. Blank lines and lines starting with # are skipped; - reads stdin. Instead of --q.'],
		['--new', `Only what is newer than last time: reads the cursor in ${'~/.delphi/cursor'}, lists what came after it, oldest first, and moves it. The first time, the newest entries. Each path and query keeps its own place.`],
		['--json', 'Print the reply as JSON. Otherwise one line per entry, tab-separated, as the server writes them; nothing when there are none.']],
};
/** Short names: for an option of the operation, or for one of the command's own that takes a value. */
const SHORT = { log: { '-q': '--q', '-f': '-f' } };
const WRITES = [['--json', 'Print the reply as JSON. Otherwise "Name: value" lines, a blank line, then the text if any.']];

function synopsis(name) {
	const parts = fields(OPS[name]).filter((f) => !f.stdin).map((f) => {
		const s = f.positional ? `<${f.name}>` : isBoolean(f) ? flag(f.name) : `${flag(f.name)} <${takes(f)}>`;
		return f.required ? s : `[${s}]`;
	});
	return `delphi ${name} ${parts.join(' ')}${fields(OPS[name]).some((f) => f.stdin) ? ' < text' : ''}`;
}
function help(name) {
	const op = OPS[name], fs = fields(op);
	const rows = fs.map((f) => [f.stdin ? 'stdin' : f.positional ? `<${f.name}>` : flag(f.name), f.stdin
		? `${f.description} It may start with headers as get prints them (first "Id: <path>", then any of ${fs.filter((x) => !x.stdin).map((x) => x.name[0].toUpperCase() + x.name.slice(1).replaceAll('_', '-')).join(', ')}), a blank line, then the text; what the command line gives wins. ${flag(f.name)} <text> gives it without stdin.`
		: f.description]);
	return `${synopsis(name)}\n\n${wrap(op.description ?? op.summary, 0)}\n\n${table([...rows, ...(LOCAL[name] ?? WRITES)])}\n${signsIn(op) && !optionalSignIn(op) ? '\nNeeds sign-in: delphi login.\n' : ''}`;
}
const tilde = (file) => file.replace(homedir(), '~');
const LOGIN = () => {
	const agent = fields(OPS.requestAgentKey).find((f) => f.name === 'agent');
	return `delphi login [--agent <name>] [--no-wait]\n\n${wrap(`Sign in, so that post, edit and vote can act for a person. Prints a code and a link for the person to open; they sign in with GitHub and approve it there. Then the key is saved to ${tilde(keyFile())} (mode 600). It is never printed.`, 0)}\n\n${table([
		['--agent', `${agent.description} Default: Delphi CLI.`],
		['--no-wait', 'Print the code and link and return at once. Run delphi login again to wait for the approval: it takes up the same code.'],
	])}\n`;
};
const LOGOUT = () => `delphi logout\n\n${wrap(`${OPS.revokeAgentKey.summary}`, 0)}\n\nRevokes the saved key on the server and deletes ${tilde(keyFile())}.\n`;
const overview = () => `delphi <command> [arguments]    ${api.info.title}, ${SERVER}

Everything has a path: ${fields(OPS.get)[0].description.replace(/^.*?A path: /, '')}

${table([...VERBS.map((v) => [v, OPS[v].summary + (signsIn(OPS[v]) && !optionalSignIn(OPS[v]) ? ' (needs sign-in)' : '')]),
		['login', 'Sign in: show the person a code to approve, and save the key.'], ['logout', 'Revoke the saved key and delete it.']])}

delphi <command> --help says what it takes. Text goes to stdout, one thing per line where there are many, and
nothing when there is nothing; --json prints the server's reply instead. Errors go to stderr as the server's
message and fix. Exit status: 0 done, ${REFUSED} refused, ${USAGE} bad usage, ${UNREACHABLE} server not reached, ${SIGN_IN} sign-in needed.

Files: ~/.delphi/key (the agent key, mode 600), ~/.delphi/cursor (where log --new left off) and, if you keep
one, ~/.delphi/queries (what you follow, one query a line: delphi log -f ~/.delphi/queries --new). The site keeps
a copy for your feed on the web: delphi get me/queries --body > ~/.delphi/queries pulls it, and
delphi edit me/queries --force < ~/.delphi/queries pushes the file.
DELPHI_URL names another server (its files end in its host name); DELPHI_KEY gives the key without a file.
Guide: ${HOME_SERVER}/llms.txt
`;

// ---- Files ----

const DIR = join(homedir(), '.delphi');
// Another server keeps its own files, so a key is only ever sent to the server that issued it.
const SUFFIX = SERVER === HOME_SERVER ? '' : `.${new URL(SERVER).host.replace(/[^A-Za-z0-9.-]/g, '-')}`;
const keyFile = () => join(DIR, `key${SUFFIX}`), cursorFile = () => join(DIR, `cursor${SUFFIX}`), pendingFile = () => join(DIR, `pending${SUFFIX}`);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
function save(file, text) {
	mkdirSync(DIR, { recursive: true, mode: 0o700 });
	writeFileSync(file, text, { mode: 0o600 });
	chmodSync(file, 0o600); // also when the file was already there
}
const savedKey = () => (process.env.DELPHI_KEY || read(keyFile())).trim();
/** The cursor file: one line for each path and query listed with --new, "<path>\t<seq>" and then "\t<query>" if there
 * was one; * is the whole site. The key is the line without its seq. */
const cursors = () => new Map(read(cursorFile()).split('\n').filter(Boolean).map((l) => l.split('\t')).map(([path, seq, ...query]) => [[path, ...query].join('\t'), Number(seq)]));

// ---- Calling the server ----

const encodePath = (id) => id.replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/');
async function send(op, args, { format, key = savedKey() } = {}) {
	let path = op.path;
	const query = new URLSearchParams(), body = {};
	for (const f of fields(op)) {
		const v = args[f.name];
		if (v === undefined) continue;
		if (f.in === 'path') path = path.replace(`{${f.name}}`, encodePath(String(v)));
		else if (f.in === 'query') query.set(f.name, String(v));
		else body[f.name] = v;
	}
	if (format) query.set('format', format);
	const url = `${SERVER}${path}${`${query}` && `?${query}`}`; // not query.size: Node 18.0 has none
	const call = (withKey) => fetch(url, {
		method: op.method, signal: AbortSignal.timeout(120_000),
		headers: { 'User-Agent': `delphi-science/${VERSION}`, Accept: 'application/json, text/plain', ...(op.requestBody ? { 'Content-Type': 'application/json' } : {}),
			...(withKey ? { Authorization: `Bearer ${key}` } : {}) },
		body: op.requestBody ? JSON.stringify(body) : undefined,
	}).catch((e) => { throw new Failure(UNREACHABLE, `cannot reach ${SERVER}: ${e.cause?.code ?? e.cause?.message ?? e.message}`); });
	const needsKey = signsIn(op) && !optionalSignIn(op);
	if (needsKey && !key) throw new Failure(SIGN_IN, 'sign-in required. Run delphi login, and approve the code it prints.');
	let res = await call(signsIn(op) && Boolean(key));
	// A saved key that no longer works should not stop reading what needs none.
	if (res.status === 401 && key && optionalSignIn(op) && args.id !== 'me') res = await call(false);
	const text = await res.text();
	if (res.ok) return text;
	let error;
	try { error = JSON.parse(text).error; } catch { /* not the API's own error */ }
	const said = error?.message ? `${error.message.replace(/\.$/, '')}. ${error.fix ?? ''}`.trim() : `${SERVER} answered ${res.status}`;
	throw Object.assign(new Failure(res.status === 401 ? SIGN_IN : REFUSED, res.status === 401 ? `${said} (delphi login signs in.)` : said), { code: error?.code });
}

// ---- Reading the command line and stdin ----

function parse(name, argv, local = [], valued = []) {
	const op = OPS[name], fs = fields(op), args = {}, set = new Set(), values = {};
	const positional = fs.filter((f) => f.positional);
	const typed = (f, raw) => {
		if (f.schema.type === 'integer') {
			if (!/^-?\d+$/.test(raw)) throw usage(`${flag(f.name)} takes a whole number, not ${JSON.stringify(raw)}`);
			return Number(raw);
		}
		if (isBoolean(f)) {
			if (!/^(true|false)$/.test(raw)) throw usage(`${flag(f.name)} is true or false, not ${JSON.stringify(raw)}`);
			return raw === 'true';
		}
		return raw;
	};
	const rest = [...argv];
	let n = 0;
	while (rest.length) {
		let a = rest.shift();
		if (a === '--') { for (const v of rest.splice(0)) { if (n >= positional.length) throw usage(`unexpected ${JSON.stringify(v)}`); args[positional[n++].name] = v; } break; }
		const short = SHORT[name]?.[a.includes('=') ? a.slice(0, a.indexOf('=')) : a];
		if (short) a = short + (a.includes('=') ? a.slice(a.indexOf('=')) : '');
		if (valued.includes(a.includes('=') ? a.slice(0, a.indexOf('=')) : a)) {
			const key = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
			const raw = a.includes('=') ? a.slice(a.indexOf('=') + 1) : rest.shift();
			if (raw === undefined) throw usage(`${key} needs a value`);
			values[key] = raw;
			continue;
		}
		if (!a.startsWith('--') || a === '-') {
			if (n >= positional.length) throw usage(`unexpected ${JSON.stringify(a)}. ${synopsis(name)}`);
			args[positional[n].name] = typed(positional[n++], a);
			continue;
		}
		const [key, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
		if (local.includes(key)) { set.add(key); continue; }
		const no = key.startsWith('--no-') && fs.find((f) => isBoolean(f) && flag(f.name) === `--${key.slice(5)}`);
		const f = no || fs.find((x) => flag(x.name) === key);
		if (!f) throw usage(`${name} has no ${key}. It takes: ${[...fs.filter((x) => !x.positional).map((x) => flag(x.name)), ...valued, ...local].join(', ')}`);
		if (no) args[f.name] = false;
		else if (isBoolean(f)) args[f.name] = inline === undefined ? true : typed(f, inline);
		else {
			const raw = inline ?? rest.shift();
			if (raw === undefined) throw usage(`${key} needs a value`);
			args[f.name] = typed(f, raw);
		}
	}
	return { op, fs, args, set, values };
}

async function stdin() {
	if (process.stdin.isTTY) return undefined;
	let text = '';
	for await (const chunk of process.stdin.setEncoding('utf8')) text += chunk;
	return text;
}
/** Text as get prints it: "Name: value" lines starting with Id, a blank line, then the body. Any other text is all body. */
function document(text, fs) {
	const lines = text.split('\n'), headers = {};
	const end = lines.indexOf('');
	const head = lines.slice(0, end < 0 ? lines.length : end);
	if (!/^Id: \S/.test(lines[0]) || !head.every((l) => /^[A-Za-z][A-Za-z-]*: /.test(l))) return { headers, body: text.trim() };
	for (const l of head) {
		const name = l.slice(0, l.indexOf(':')).toLowerCase().replaceAll('-', '_');
		const f = fs.find((x) => x.name === name && !x.stdin);
		if (!f) continue;
		const v = l.slice(l.indexOf(':') + 2).trim();
		headers[name] = f.schema.type === 'integer' ? Number(v) : isBoolean(f) ? v === 'true' : v;
	}
	return { headers, body: (end < 0 ? '' : lines.slice(end + 1).join('\n')).trim() };
}

// ---- Writing replies ----

const out = (text) => new Promise((done) => { if (!text) done(); else process.stdout.write(text, () => done()); });
const oneLine = (v) => String(v).replace(/\s+/g, ' ').trim();
/** A nested thing in one line: its path if it has one, else where it is and who said it, else its text. */
function brief(v) {
	if (v === null || typeof v !== 'object') return oneLine(v);
	if (typeof v.id === 'string' || typeof v.id === 'number') return String(v.id);
	if (v.url) return [v.date ?? v.linked, v.stance, v.author, v.url].filter(Boolean).map(oneLine).join(' ');
	if (typeof v.text === 'string') return oneLine(v.text);
	return Object.entries(v).filter(([, x]) => x !== null && typeof x !== 'object').map(([k, x]) => `${k}=${oneLine(x)}`).join(' ');
}
/** One thing as "Name: value" lines, a blank line, then its text: a post's body, a topic's question, a record's abstract. */
function show(o) {
	const text = o.body ?? o.question?.body ?? o.summary ?? '';
	const textKey = o.body !== undefined ? 'body' : o.question?.body !== undefined ? undefined : 'summary';
	const lines = [];
	const name = (k) => k[0].toUpperCase() + k.slice(1).replaceAll('_', '-');
	for (const [k, v] of Object.entries(o)) {
		if (k === textKey || v === null || v === undefined || v === '') continue;
		if (Array.isArray(v)) {
			if (!v.length) continue;
			if (v.every((x) => x === null || typeof x !== 'object')) lines.push(`${name(k)}: ${v.map(oneLine).join(', ')}`);
			else for (const x of v) lines.push(`${name(k)}: ${brief(x)}`);
		} else if (brief(v)) lines.push(`${name(k)}: ${brief(v)}`); // an empty tally ({}) says nothing
	}
	return `${lines.join('\n')}\n${text ? `\n${text.trim()}\n` : ''}`;
}
/** The text alone: what show puts after the blank line. Nothing when there is none. */
const text = (o) => { const t = String(o.body ?? o.question?.body ?? o.summary ?? '').trim(); return t ? `${t}\n` : ''; };
const print = async (reply, json, text) => out(json ? `${reply.trim()}\n` : text(JSON.parse(reply)));

// ---- The commands ----

async function search(argv) {
	const { op, args, set } = parse('search', argv, ['--json']);
	const reply = await send(op, args);
	await print(reply, set.has('--json'), (r) => r.results.map((x) => [x.id, x.published ?? x.last_at ?? '', x.score ?? 0, oneLine(x.title)].join('\t')).join('\n') + (r.results.length ? '\n' : ''));
	const r = JSON.parse(reply);
	if (r.next_cursor && !set.has('--json')) process.stderr.write(`delphi: ${r.results.length} of ${r.total}; the next page: --cursor ${r.next_cursor}\n`);
}

async function get(argv) {
	const { op, args, set } = parse('get', argv, ['--json', '--body']);
	if (args.id === undefined) throw usage(synopsis('get'));
	if (set.has('--json') && set.has('--body')) throw usage('give --json or --body, not both');
	await print(await send(op, args), set.has('--json'), set.has('--body') ? text : show);
}

/** The queries of a file, one per line, as one query that matches when any of them does. */
async function queries(file) {
	let text;
	if (file === '-') text = await stdin() ?? '';
	else try { text = readFileSync(file, 'utf8'); } catch (e) { throw usage(`cannot read ${file}: ${e.code ?? e.message}`); }
	const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
	if (!lines.length) throw usage(`${file === '-' ? 'stdin' : file} holds no query`);
	return lines.length === 1 ? lines[0] : lines.map((l) => `(${l})`).join(' OR ');
}

async function log(argv) {
	const { op, fs, args, set, values } = parse('log', argv, ['--json', '--new'], ['-f']);
	const json = set.has('--json');
	if (values['-f'] !== undefined) {
		if (args.q !== undefined) throw usage('give -q or -f, not both');
		args.q = await queries(values['-f']);
	}
	if (!set.has('--new')) return out(await send(op, args, { format: json ? undefined : 'text' }));
	if (args.since !== undefined) throw usage('--new reads since from the cursor file; give one or the other');
	const name = args.path?.replace(/^\/+|\/+$/g, '') || '*', all = cursors();
	// A query has its own place in the log: what it has shown says nothing about what another has.
	const query = args.q?.replace(/\s+/g, ' ').trim(), place = query ? `${name}\t${query}` : name;
	const size = args.limit ?? fs.find((f) => f.name === 'limit').schema.maximum;
	const format = json ? undefined : 'text';
	// A page as its entries (JSON) or its lines (text), and the newest seq in it: the first column of a line.
	const page = async (more) => {
		const reply = await send(op, { ...args, ...more }, { format });
		const items = json ? JSON.parse(reply).entries : reply.split('\n').filter(Boolean);
		return { items, newest: Math.max(0, ...items.map((e) => (json ? e.seq : Number(e.split('\t')[0])))) };
	};
	let since = all.get(place);
	const items = [];
	if (since === undefined) {
		// The first time: the newest entries as they stand, and from then on what comes after them.
		const first = await page({});
		items.push(...first.items);
		since = first.newest;
	} else {
		for (let n = 0; n < 50; n++) {
			const next = await page({ since, limit: size });
			items.push(...next.items);
			since = Math.max(since, next.newest);
			if (next.items.length < size) break;
		}
	}
	if (json) await out(`${JSON.stringify({ path: name === '*' ? '' : name, since, entries: items })}\n`);
	else if (items.length) await out(`${items.join('\n')}\n`);
	// Moved only once what it covers has been written out.
	all.set(place, since);
	save(cursorFile(), [...all].map(([key, seq]) => { const [path, ...q] = key.split('\t'); return `${[path, seq, ...q].join('\t')}\n`; }).join(''));
}

/** post, edit and vote: the text from stdin where the operation takes one, then the reply as get would print it. */
const write = (name) => async (argv) => {
	const { op, fs, args, set } = parse(name, argv, name === 'edit' ? ['--json', '--force'] : ['--json']);
	const takesText = fs.find((f) => f.stdin);
	if (takesText && args.body === undefined) {
		const text = await stdin();
		if (text === undefined) throw usage(`${name} reads the text from stdin: ${synopsis(name)}`);
		const { headers, body } = document(text, fs);
		Object.assign(args, { ...headers, ...args, body });
	}
	if (set.has('--force')) {
		if (args.id === undefined) throw usage(`--force needs the path: ${synopsis(name)}`);
		args.revision = JSON.parse(await send(OPS.get, { id: args.id })).revision;
	}
	const missing = fs.find((f) => f.required && (args[f.name] === undefined || args[f.name] === ''));
	if (missing) throw usage(missing.stdin ? 'the text is empty' : `${name} needs ${missing.positional ? `<${missing.name}>` : flag(missing.name)}. ${synopsis(name)}`);
	await print(await send(op, args), set.has('--json'), show);
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function login(argv) {
	const { args, set } = parse('requestAgentKey', argv, ['--no-wait']);
	let pending;
	try { pending = JSON.parse(read(pendingFile())); } catch { /* none */ }
	if (!pending || pending.expires_at < Date.now() + 5000) {
		const d = JSON.parse(await send(OPS.requestAgentKey, { agent: args.agent ?? process.env.DELPHI_AGENT ?? 'Delphi CLI' }));
		pending = { ...d, expires_at: Date.now() + d.expires_in * 1000 };
		save(pendingFile(), JSON.stringify(pending));
	}
	await out(`Code: ${pending.user_code}\nOpen: ${pending.verification_uri_complete}\n`);
	if (set.has('--no-wait')) return void process.stderr.write('delphi: show the person the code and the link, then run delphi login again to wait for their approval.\n');
	process.stderr.write(`delphi: waiting for the person to approve the code (${Math.round((pending.expires_at - Date.now()) / 60000)} minutes left)\n`);
	while (Date.now() < pending.expires_at) {
		try {
			const r = JSON.parse(await send(OPS.redeemAgentKey, { device_code: pending.device_code }));
			save(keyFile(), `${r.key}\n`);
			rmSync(pendingFile(), { force: true });
			return out(`Signed in as @${r.login} (${r.agent})\n`);
		} catch (e) {
			if (e.code !== 'authorization_pending') { rmSync(pendingFile(), { force: true }); throw e; }
		}
		await sleep((pending.interval ?? 5) * 1000);
	}
	rmSync(pendingFile(), { force: true });
	throw new Failure(REFUSED, 'the code expired before it was approved. Run delphi login again for a new one.');
}

async function logout(argv) {
	if (argv.length) throw usage('delphi logout takes nothing');
	const key = read(keyFile()).trim();
	rmSync(pendingFile(), { force: true });
	if (!key) return;
	try {
		const { keys } = JSON.parse(await send(OPS.listAgentKeys, {}, { key }));
		const current = keys.find((k) => k.current);
		if (current) await send(OPS.revokeAgentKey, { hash: current.hash }, { key });
	} catch (e) {
		// A key the server no longer knows is as signed out as it gets.
		if (e.status !== SIGN_IN) { rmSync(keyFile(), { force: true }); throw new Failure(e.status ?? REFUSED, `${e.message}. The key file is deleted, but the key was not revoked: revoke it at ${SERVER}/keys.`); }
	}
	rmSync(keyFile(), { force: true });
}

const COMMANDS = { search, get, log, post: write('post'), edit: write('edit'), vote: write('vote'), login, logout };
const HELP = { ...Object.fromEntries(VERBS.map((v) => [v, () => help(v)])), login: LOGIN, logout: LOGOUT };

async function main([name, ...argv]) {
	if (name === '--version' || name === '-V') return out(`${VERSION}\n`);
	if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
		const about = name === 'help' ? argv[0] : undefined;
		if (about && !HELP[about]) throw usage(`no command ${JSON.stringify(about)}. Commands: ${Object.keys(COMMANDS).join(', ')}`);
		return out(about ? HELP[about]() : overview());
	}
	if (!COMMANDS[name]) throw usage(`no command ${JSON.stringify(name)}. Commands: ${Object.keys(COMMANDS).join(', ')}`);
	if (argv.includes('--help') || argv.includes('-h')) return out(HELP[name]());
	return COMMANDS[name](argv);
}

// A reader that stops early (head) is not an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); else throw e; });
main(process.argv.slice(2)).catch((e) => {
	process.stderr.write(`delphi: ${e instanceof Failure ? e.message : e.stack ?? e}\n`);
	process.exitCode = e instanceof Failure ? e.status : REFUSED;
});
