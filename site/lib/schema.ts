// The OpenAPI schemas as TypeScript types and runtime checks (schema.py checks the same from Python).
// Objects are closed: a field the schema does not list is an error.
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { spec } from './openapi.ts';

// ---- Types ----

type Schemas = typeof spec.components.schemas;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type FromType<T, S> = T extends 'string' ? string : T extends 'integer' | 'number' ? number : T extends 'boolean' ? boolean
	: T extends 'null' ? null : T extends 'array' ? (S extends { items: infer I } ? FromSchema<I>[] : unknown[])
	: T extends 'object' ? ObjectOf<S> : unknown;
/** The TypeScript type of a value a schema accepts, for the keywords the document uses. */
export type FromSchema<S> = S extends { $ref: `#/components/schemas/${infer N extends keyof Schemas & string}` } ? FromSchema<Schemas[N]>
	: S extends { oneOf: readonly (infer O)[] } ? FromSchema<O>
	: S extends { enum: readonly (infer E)[] } ? E
	: S extends { type: readonly (infer T)[] } ? FromType<T, S>
	: S extends { type: infer T } ? FromType<T, S> : unknown;
type Given<P, R> = { [K in keyof P]: K extends R ? K : P[K] extends { default: unknown } ? K : never }[keyof P];
type ObjectOf<S> = S extends { properties: infer P }
	? Simplify<{ -readonly [K in Given<P, S extends { required: readonly (infer R)[] } ? R : never>]: FromSchema<P[K]> }
		& { -readonly [K in Exclude<keyof P, Given<P, S extends { required: readonly (infer R)[] } ? R : never>>]?: FromSchema<P[K]> }>
	: S extends { additionalProperties: infer A extends object } ? Record<string, FromSchema<A>> : Record<string, unknown>;

/** A record as the build serves it and the API returns it. */
export type Item = FromSchema<Schemas['Record']>;
/** What a record is built from, as open_index.entries stores it. */
export type Entry = FromSchema<Schemas['Entry']>;

// ---- Checks ----

/** A copy of a schema with every object that lists its properties closed to others. */
export function closed(s: unknown): unknown {
	if (Array.isArray(s)) return s.map(closed);
	if (!s || typeof s !== 'object') return s;
	const o = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([p, q]) => [p, closed(q)])) : closed(v)]));
	return 'properties' in o && !('additionalProperties' in o) ? { ...o, additionalProperties: false } : o;
}

// Strict, so an unknown keyword (a typo in a schema) fails.
const ajv = addFormats(new Ajv2020({ allErrors: true, allowUnionTypes: true })).addVocabulary(['components']);
ajv.addSchema({ $id: 'spec', components: closed(spec.components) });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

/** Throws, naming each problem, unless value fits the document's schema `name`; then TypeScript knows its type. */
export function check<N extends keyof Schemas & string>(name: N, value: unknown, at: string): asserts value is FromSchema<Schemas[N]> {
	let validate = validators.get(name);
	if (!validate) validators.set(name, (validate = ajv.getSchema(`spec#/components/schemas/${name}`)!));
	if (validate(value)) return;
	const found = [...new Set(validate.errors!.map((e) => `${at}${e.instancePath.replace(/\/\d+/g, '[]').replaceAll('/', '.')}: ${
		e.params.additionalProperty ? `${e.params.additionalProperty} is not in the schema` : e.message}`))];
	throw new Error(`${at} does not fit the ${name} schema (lib/openapi.ts):\n  ${found.slice(0, 20).join('\n  ')}`);
}
