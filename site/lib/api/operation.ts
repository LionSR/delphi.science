// operation('searchRecords', handler) is the route handler for that OpenAPI operation (lib/api/openapi.ts).
// Before the handler runs it reads the JSON body (400 bad_body), identifies the caller when the operation
// has security (401), and checks path, query and body against their schemas, coercing query strings and
// filling defaults (400 bad_request, with a fix written from the schema). Each call is counted
// (lib/api/usage.ts) as "<METHOD> <path template>".
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ApiError, bearer, counted, handle, voter } from './caller.ts';
import { endpointName, operationById, spec, type Operation, type Parameter, type Schema } from './openapi.ts';
import { check as fits, type FromSchema, type Simplify } from './schema.ts';
import type { Voter } from '#lib/accounts/keys.ts';

// ---- Types read from the document ----

type Paths = typeof spec.paths;
type Ops = { [P in keyof Paths]: { [M in keyof Paths[P]]: Paths[P][M] }[keyof Paths[P]] }[keyof Paths];
type OperationId = Ops extends { operationId: infer I } ? I : never;
type Op<I> = Extract<Ops, { operationId: I }>;

type ParamsIn<O, In> = O extends { parameters: readonly (infer X)[] } ? Extract<X, { in: In }> : never;
type HasValue<X> = X extends { required: true } ? true : X extends { schema: { default: unknown } } ? true : false;
type ParamObject<X> = Simplify<{ [K in X as HasValue<K> extends true ? K extends { name: infer N extends string } ? N : never : never]: K extends { schema: infer S } ? FromSchema<S> : never }
	& { [K in X as HasValue<K> extends true ? never : K extends { name: infer N extends string } ? N : never]?: K extends { schema: infer S } ? FromSchema<S> : never }>;
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': { schema: infer S } } } } ? FromSchema<S> : undefined;
// An empty requirement first ({}: lib/api/openapi.ts authOf) makes signing in optional.
type VoterOf<O> = O extends { security: readonly [infer First, ...unknown[]] } ? ([keyof First] extends [never] ? Voter | undefined : Voter) : undefined;

/** What a handler gets: the request's parameters and body, checked against the operation and typed from it. */
type Input<I extends OperationId> = {
	params: ParamObject<ParamsIn<Op<I>, 'path'>>;
	query: ParamObject<ParamsIn<Op<I>, 'query'>>;
	body: BodyOf<Op<I>>;
	/** The caller, when the operation needs an agent key; or when it takes one and the request carries a token. */
	voter: VoterOf<Op<I>>;
	req: Request;
};

// ---- Checking a request ----

// Parameters arrive as strings: read them as the declared types and fill in defaults. A body is checked as sent.
const strings = addFormats(new Ajv2020({ coerceTypes: true, useDefaults: true, verbose: true, allowUnionTypes: true }));
const json = addFormats(new Ajv2020({ useDefaults: true, verbose: true, allowUnionTypes: true }));

const asObject = (ps: readonly Parameter[]): Schema => ({
	type: 'object', properties: Object.fromEntries(ps.map((p) => [p.name, p.schema])), required: ps.filter((p) => p.required).map((p) => p.name),
});

const list = (xs: readonly unknown[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;
const article = (type: string) => /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
// The types a schema takes, in words: "an integer", "a string or a null".
const types = (s: Schema) => list([s.type ?? 'value'].flat().map(String).map(article));
const range = (s: Schema) => s.minimum !== undefined && s.maximum !== undefined ? `from ${s.minimum} to ${s.maximum}`
	: s.minimum !== undefined ? `at least ${s.minimum}` : s.maximum !== undefined ? `at most ${s.maximum}` : '';
const badBody = () => new ApiError(400, 'bad_body', 'send a JSON object', 'Set Content-Type: application/json and send {...}.');

/** The first problem ajv found, as an error that says what to send instead, from the schema itself. */
function problem(e: ErrorObject, where: 'path' | 'query' | 'body'): ApiError {
	const field = e.instancePath.slice(1).replaceAll('/', '.');
	const s = (e.parentSchema ?? {}) as Schema;
	const bad = (message: string, fix: string) => new ApiError(400, 'bad_request', message, fix);
	// Body fields are quoted, as in JSON; parameters are not, as in a URL.
	const name = (f: string) => where === 'body' ? `"${f}"` : f;
	const about = (x: Schema) => x.description ? ` ${x.description}` : '';
	// What a schema takes, in words: "an integer from 1 to 100 (default 20)", "a string of at most 500 characters".
	const takes = (x: Schema) => {
		if (x.enum) return list(x.enum.map((v) => JSON.stringify(v)));
		const length = x.maxLength !== undefined ? ` of ${x.minLength ? `${x.minLength} to ${x.maxLength}` : `at most ${x.maxLength}`} characters`
			: x.minLength ? ` of at least ${x.minLength} characters` : '';
		return `${types(x)}${range(x) ? ` ${range(x)}` : ''}${length}${x.default !== undefined ? ` (default ${JSON.stringify(x.default)})` : ''}`;
	};
	const send = (f: string, x: Schema) => `Send ${name(f)}: ${takes(x)}.${about(x)}`;

	if (e.keyword === 'required') {
		const f = (e.params as { missingProperty: string }).missingProperty;
		return bad(where === 'body' ? `the body needs ${name(f)}` : `${f} is required`, send(f, s.properties?.[f] ?? {}));
	}
	if (e.keyword === 'anyOf' && s.anyOf?.every((b) => b.required?.length === 1)) {
		const fields = s.anyOf.map((b) => name(b.required![0]));
		return bad(`the body needs ${list(fields)}`, s.description ?? `Send ${list(fields)}.`);
	}
	if (!field && where === 'body') return badBody(); // a JSON array, string or number where an object belongs
	if (e.keyword === 'enum' && where === 'query') {
		// Same wording as the query parser: unknown sort "hot" / Use sort=relevance, sort=newest, …
		return bad(`unknown ${field} ${JSON.stringify(e.data)}`, `Use ${(s.enum ?? []).map((v) => `${field}=${v}${v === s.default ? ' (default)' : ''}`).join(', ')}.`);
	}
	const inRange = () => `${name(field)} must be ${range(s)}`;
	const messages: Record<string, () => string> = {
		enum: () => `${name(field)} must be ${takes(s)}`,
		type: () => `${name(field)} must be ${types(s)}`,
		minimum: inRange,
		maximum: inRange,
		minLength: () => (s.minLength === 1 ? `${name(field)} is empty` : `${name(field)} is shorter than ${s.minLength} characters`),
		maxLength: () => `${name(field)} is longer than ${s.maxLength} characters`,
	};
	return bad(messages[e.keyword]?.() ?? `${name(field)} ${e.message}`, send(field, s));
}

function check<T>(validate: ValidateFunction | undefined, data: T, where: 'path' | 'query' | 'body'): T {
	if (validate && !validate(data)) {
		const errors = validate.errors!;
		throw problem(errors.find((e) => e.keyword === 'anyOf') ?? errors[0], where);
	}
	return data;
}

/** The checks for one operation, compiled once. */
function checks(op: Operation) {
	const path = op.parameters.filter((p) => p.in === 'path'), query = op.parameters.filter((p) => p.in === 'query');
	return {
		path: path.length ? strings.compile(asObject(path)) : undefined,
		query: query.length ? strings.compile(asObject(query)) : undefined,
		names: query.map((p) => p.name),
		body: op.body ? json.compile(op.body) : undefined,
	};
}

// A catch-all segment ([...id]) arrives as its parts; a path id is those joined again.
type Ctx = { params?: Promise<Record<string, string | string[]>> };
const joined = (params: Record<string, string | string[]> = {}) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join('/') : v]));

// Outside production, every JSON reply is checked against the schema its operation declares for that status, so the
// code cannot stop matching the published OpenAPI document: a reply that does not fit fails (500) in development and
// tests.
const ENFORCE_REPLIES = process.env.NODE_ENV !== 'production';

async function checkReply(op: Operation, res: Response) {
	const name = op.replies[res.status];
	if (name && res.headers.get('Content-Type')?.startsWith('application/json')) fits(name, await res.clone().json(), endpointName(op));
}

/**
 * The route handler for the operation `id` of the OpenAPI document: checks each request against the document,
 * counts it, and runs `run` with the checked input. Errors thrown as ApiError or QueryError become the API's
 * {"error": {code, message, fix}} (lib/api/caller.ts handle).
 */
export function operation<I extends OperationId>(id: I, run: (input: Input<I>) => Response | Promise<Response>) {
	const op = operationById(id);
	const endpoint = endpointName(op);
	const c = checks(op);
	const handler = counted(endpoint, (req: Request, ctx?: Ctx) => handle(async () => {
		let body: unknown;
		if (c.body) {
			body = await req.json().catch(() => undefined);
			if (body === null || typeof body !== 'object') throw badBody();
		}
		const who = op.auth === 'required' || (op.auth === 'optional' && bearer(req)) ? await voter(req, String((body as { agent?: unknown } | undefined)?.agent ?? '')) : undefined;
		const params = check(c.path, joined(await ctx?.params), 'path');
		const url = new URL(req.url).searchParams;
		const query = check(c.query, Object.fromEntries(c.names.filter((n) => url.has(n)).map((n) => [n, url.get(n)])), 'query');
		check(c.body, body, 'body');
		const res = await run({ params, query, body, voter: who, req } as Input<I>);
		if (ENFORCE_REPLIES) await checkReply(op, res);
		return res;
	}));
	return Object.assign(handler, { operationId: id, endpoint });
}
