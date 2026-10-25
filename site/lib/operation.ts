// Routes from the OpenAPI document (lib/openapi.ts): operation('searchRecords', handler) is the route handler for
// that operation. The document says where it is served, what it takes and whether it needs a key, and operation()
// holds every request to that before the handler runs:
//
//   1. the JSON body is read, if the operation takes one (not JSON, or not an object: 400 bad_body);
//   2. the caller is identified, if the operation has security (no key, or a bad one: 401; lib/api.ts voter);
//   3. path and query parameters are checked against their schemas, query strings read as the declared types
//      and missing ones given their defaults; then the body against its schema (400 bad_request, with a fix
//      written from the schema: the allowed values, the range, the field to send);
//   4. the handler gets { params, query, body, voter, req }, typed from the document, and its domain checks
//      (the query parser, a record that does not exist, a key pasted in a comment) answer as before.
//
// Each call is counted (lib/usage.ts) as "<METHOD> <path template>", the name /api/v1/stats shows.
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ApiError, counted, handle, voter } from './api.ts';
import { operations, spec, type Operation, type Parameter, type Schema } from './openapi.ts';
import type { Voter } from './votes.ts';

// ---- Types read from the document ----

type Paths = typeof spec.paths;
type Ops = { [P in keyof Paths]: { [M in keyof Paths[P]]: Paths[P][M] }[keyof Paths[P]] }[keyof Paths];
export type OperationId = Ops extends { operationId: infer I } ? I : never;
type Op<I> = Extract<Ops, { operationId: I }>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type FromType<T, S> = T extends 'string' ? string : T extends 'integer' | 'number' ? number : T extends 'boolean' ? boolean
	: T extends 'null' ? null : T extends 'object' ? ObjectOf<S> : unknown;
/** The TypeScript type of a value a schema accepts, for the keywords the document uses. */
export type FromSchema<S> = S extends { enum: readonly (infer E)[] } ? E
	: S extends { type: readonly (infer T)[] } ? FromType<T, S>
	: S extends { type: infer T } ? FromType<T, S> : unknown;
type Given<P, R> = { [K in keyof P]: K extends R ? K : P[K] extends { default: unknown } ? K : never }[keyof P];
type ObjectOf<S> = S extends { properties: infer P }
	? Simplify<{ -readonly [K in Given<P, S extends { required: readonly (infer R)[] } ? R : never>]: FromSchema<P[K]> }
		& { -readonly [K in Exclude<keyof P, Given<P, S extends { required: readonly (infer R)[] } ? R : never>>]?: FromSchema<P[K]> }>
	: Record<string, unknown>;

type ParamsIn<O, In> = O extends { parameters: readonly (infer X)[] } ? Extract<X, { in: In }> : never;
type HasValue<X> = X extends { required: true } ? true : X extends { schema: { default: unknown } } ? true : false;
type ParamObject<X> = Simplify<{ [K in X as HasValue<K> extends true ? K extends { name: infer N extends string } ? N : never : never]: K extends { schema: infer S } ? FromSchema<S> : never }
	& { [K in X as HasValue<K> extends true ? never : K extends { name: infer N extends string } ? N : never]?: K extends { schema: infer S } ? FromSchema<S> : never }>;
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': { schema: infer S } } } } ? FromSchema<S> : undefined;
type VoterOf<O> = O extends { security: readonly [unknown, ...unknown[]] } ? Voter & { via: 'key' | 'github' } : undefined;

/** What a handler gets: the request's parameters and body, checked against the operation and typed from it. */
export type Input<I extends OperationId> = {
	params: ParamObject<ParamsIn<Op<I>, 'path'>>;
	query: ParamObject<ParamsIn<Op<I>, 'query'>>;
	body: BodyOf<Op<I>>;
	/** The caller, when the operation needs an agent key. */
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
const range = (s: Schema) => s.minimum !== undefined && s.maximum !== undefined ? `from ${s.minimum} to ${s.maximum}`
	: s.minimum !== undefined ? `at least ${s.minimum}` : s.maximum !== undefined ? `at most ${s.maximum}` : '';
const badBody = () => new ApiError(400, 'bad_body', 'send a JSON object', 'Set Content-Type: application/json and send {...}.');

/** The first problem ajv found, as an error that says what to send instead, from the schema itself. */
function problem(e: ErrorObject, where: 'path' | 'query' | 'body'): ApiError {
	const field = e.instancePath.slice(1).replaceAll('/', '.');
	const s = (e.parentSchema ?? {}) as Schema;
	const bad = (message: string, fix: string) => new ApiError(400, 'bad_request', message, fix);
	// A body field is named in quotes, as in JSON; a parameter bare, as in a URL.
	const name = (f: string) => where === 'body' ? `"${f}"` : f;
	const about = (x: Schema) => x.description ? ` ${x.description}` : '';
	// What a schema takes, in words: "an integer from 1 to 100 (default 20)", "a string of at most 500 characters".
	const takes = (x: Schema) => {
		if (x.enum) return list(x.enum.map((v) => JSON.stringify(v)));
		const length = x.maxLength !== undefined ? ` of ${x.minLength ? `${x.minLength} to ${x.maxLength}` : `at most ${x.maxLength}`} characters`
			: x.minLength ? ` of at least ${x.minLength} characters` : '';
		const types = list([x.type ?? 'value'].flat().map(String).map(article));
		return `${types}${range(x) ? ` ${range(x)}` : ''}${length}${x.default !== undefined ? ` (default ${JSON.stringify(x.default)})` : ''}`;
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
		// As the query parser words it: unknown sort "hot" / Use sort=relevance, sort=newest, …
		return bad(`unknown ${field} ${JSON.stringify(e.data)}`, `Use ${(s.enum ?? []).map((v) => `${field}=${v}${v === s.default ? ' (default)' : ''}`).join(', ')}.`);
	}
	const messages: Record<string, () => string> = {
		enum: () => `${name(field)} must be ${takes(s)}`,
		type: () => `${name(field)} must be ${list([s.type ?? 'value'].flat().map(String).map(article))}`,
		minimum: () => `${name(field)} must be ${range(s)}`,
		maximum: () => `${name(field)} must be ${range(s)}`,
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
	const ps = (at: string) => op.parameters.filter((p) => p.in === at);
	const compile = (ajv: Ajv2020, s: Schema) => ajv.compile(s as object);
	return {
		path: ps('path').length ? compile(strings, asObject(ps('path'))) : undefined,
		query: ps('query').length ? compile(strings, asObject(ps('query'))) : undefined,
		names: ps('query').map((p) => p.name),
		body: op.body ? compile(json, op.body) : undefined,
	};
}

type Ctx = { params?: Promise<Record<string, string>> };

/**
 * The route handler for the operation `id` of the OpenAPI document: checks each request against the document,
 * counts it, and runs `run` with the checked input. Errors thrown as ApiError or QueryError become the API's
 * {"error": {code, message, fix}} (lib/api.ts handle).
 */
export function operation<I extends OperationId>(id: I, run: (input: Input<I>) => Response | Promise<Response>) {
	const op = operations.find((o) => o.operationId === id);
	if (!op) throw new Error(`no operation ${id} in lib/openapi.ts`);
	const endpoint = `${op.method} ${op.path}`;
	const c = checks(op);
	const handler = counted(endpoint, (req: Request, ctx?: Ctx) => handle(async () => {
		let body: unknown;
		if (c.body) {
			body = await req.json().catch(() => undefined);
			if (body === null || typeof body !== 'object') throw badBody();
		}
		const who = op.secured ? await voter(req, String((body as { agent?: unknown } | undefined)?.agent ?? '')) : undefined;
		const params = check(c.path, { ...(await ctx?.params) }, 'path');
		const url = new URL(req.url).searchParams;
		const query = check(c.query, Object.fromEntries(c.names.filter((n) => url.has(n)).map((n) => [n, url.get(n)])), 'query');
		check(c.body, body, 'body');
		return run({ params, query, body, voter: who, req } as Input<I>);
	}));
	return Object.assign(handler, { operationId: id, endpoint });
}
