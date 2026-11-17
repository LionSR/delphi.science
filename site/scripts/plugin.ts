// Packages site/plugin/ as dist/open-research-index-plugin.zip, in the layout OpenAI's plugin docs give
// (developers.openai.com/plugins/build/plugins): .codex-plugin/plugin.json, with .mcp.json and assets/ beside it. Needs `zip`.
//
//   npm run plugin
//   SITE_URL=https://example.org npm run plugin
//
// The ZIP is for installing the plugin locally or from a repository. The public directory does not take it: a plugin
// with an MCP server is submitted in the portal as "With MCP", by the server's URL, and the manifest's interface
// fields are what to enter there. So the checks below apply the portal's final-submission limits
// (developers.openai.com/plugins/deploy/submission-errors), as far as they can be checked locally.
// The JSON files name https://delphi.science, so the folder installs as it is from the repo marketplace
// (.agents/plugins/marketplace.json); with SITE_URL set, the packaged copies name that site instead (lib/view.ts).
//
// It also writes dist/chatgpt-app-submission.json, the import file the portal's submission form takes: the listing,
// each tool's hints as the server declares them (lib/api/mcp.ts) with a justification for each, and the reviewer test
// cases, from site/plugin/submission.json (developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '#lib/api/mcp.ts';
import { SITE } from '#lib/view.ts';

const MANIFEST = '.codex-plugin/plugin.json', SERVERS = '.mcp.json';
const FILES = [MANIFEST, SERVERS, 'assets/icon.png'];
const CATEGORIES = ['Productivity', 'Creativity', 'Developer Tools', 'Business & Operations', 'Data & Analytics', 'Communication',
	'Education & Research', 'Security', 'Finance', 'Healthcare', 'Travel', 'Entertainment', 'Other'];
const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const src = path('../plugin/'), out = path('../../dist/plugin/'), zip = path('../../dist/open-research-index-plugin.zip');

rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
	mkdirSync(dirname(out + f), { recursive: true });
	if (f.endsWith('.json')) writeFileSync(out + f, readFileSync(src + f, 'utf8').replaceAll('https://delphi.science', SITE));
	else copyFileSync(src + f, out + f);
}

const manifest = JSON.parse(readFileSync(out + MANIFEST, 'utf8'));
const ui = manifest.interface ?? {};
const servers = JSON.parse(readFileSync(out + SERVERS, 'utf8')).mcpServers as Record<string, { type?: string; url?: string }> | undefined;
const problems: string[] = [];
const text = (v: unknown) => (typeof v === 'string' ? v : '');
/** A required one-line (unless `lines`) field of at most `max` characters. */
const field = (name: string, v: unknown, max: number, lines = false) => {
	const s = text(v);
	if (!s.trim()) problems.push(`${name} is required`);
	else if ([...s].length > max) problems.push(`${name} is ${[...s].length} characters: at most ${max}`);
	else if (!lines && /[\r\n]/.test(s)) problems.push(`${name} must be one line`);
};

if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(text(manifest.name))) problems.push('name must start with a letter or digit and hold only letters, digits, _ or -, at most 64');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(text(manifest.version))) problems.push('version must be semver, e.g. 1.2.0');
field('description', manifest.description, 1024);
field('author.name', manifest.author?.name, 120);
field('interface.displayName', ui.displayName, 30);
field('interface.shortDescription', ui.shortDescription, 30);
field('interface.longDescription', ui.longDescription, 4000, true);
field('interface.developerName', ui.developerName, 80);
if (manifest.author?.name !== ui.developerName) problems.push('author.name and interface.developerName must be the same');
if (!CATEGORIES.includes(ui.category)) problems.push(`interface.category must be one of ${CATEGORIES.join(', ')}`);
if (manifest.mcpServers !== `./${SERVERS}`) problems.push(`mcpServers must be "./${SERVERS}", or the file is ignored`);
if (!servers || !Object.keys(servers).length) problems.push(`${SERVERS} must hold {"mcpServers": {"<name>": {"type": "http", "url": …}}}`);
for (const [name, s] of Object.entries(servers ?? {})) {
	if (s.type !== 'http' || !text(s.url).startsWith('https://')) problems.push(`${SERVERS} ${name}: a remote server is {"type": "http", "url": "https://…"}`);
}
for (const name of [manifest.name, ui.displayName, ...Object.keys(servers ?? {})]) {
	if (/(mcp|plugin)$/i.test(String(name).trim())) problems.push(`${name}: a name must not end in MCP or Plugin`);
}
// A plugin with an MCP server must give all four.
for (const k of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
	if (!text(ui[k]).startsWith('https://')) problems.push(`interface.${k} is required and must be https`);
}
const prompts: string[] = [ui.defaultPrompt ?? []].flat();
if (prompts.length > 3) problems.push(`${prompts.length} example prompts: at most 3`);
if (new Set(prompts.map((p) => p.trim().toLowerCase())).size !== prompts.length) problems.push('example prompts must differ');
for (const p of prompts) if ([...p].length > 128 || /[\r\n@]/.test(p)) problems.push(`${JSON.stringify(p)}: one line of at most 128 characters, with no @mention`);
const capabilities: unknown[] = ui.capabilities ?? [];
if (capabilities.length > 20 || capabilities.some((c) => !text(c) || text(c).length > 120)) problems.push('interface.capabilities: at most 20 one-line entries of at most 120 characters');
if (ui.brandColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(text(ui.brandColor))) problems.push('interface.brandColor must be a six-digit hex colour');
// Screenshots are only for servers with their own UI, which this one has not.
if (ui.screenshots?.length) problems.push('interface.screenshots: leave out (the server provides no custom UI)');
for (const k of ['logo', 'composerIcon']) {
	const rel = text(ui[k]);
	if (!rel.startsWith('./') || rel.includes('..') || !FILES.includes(rel.slice(2))) { problems.push(`interface.${k} must be a packaged file, written ./assets/…`); continue; }
	const png = readFileSync(out + rel.slice(2));
	const isPng = png.subarray(1, 4).toString('latin1') === 'PNG';
	const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
	if (!isPng || w !== h || w < 48 || w > 4096 || png.length > 5 * 1024 * 1024) problems.push(`interface.${k}: a square PNG from 48 to 4096 pixels, at most 5 MiB`);
}
const urls = JSON.stringify([manifest, servers]).match(/"[a-z]+:\/\/[^"]*"/g) ?? [];
for (const u of urls) if (!u.startsWith('"https://') || u.length > 1026) problems.push(`${u}: links must be https and at most 1024 characters`);
// The portal's import file.
const given = JSON.parse(readFileSync(src + 'submission.json', 'utf8'));
const HINTS = { readOnlyHint: 'read_only_justification', openWorldHint: 'open_world_justification', destructiveHint: 'destructive_justification' } as const;
const tools: Record<string, object> = {};
for (const [name, t] of Object.entries(TOOLS)) {
	const why = given.justifications?.[name] ?? {};
	for (const k of Object.values(HINTS)) if (!text(why[k]).trim() || /[\r\n]/.test(text(why[k]))) problems.push(`submission.json: ${name} needs a one-line ${k}`);
	tools[name] = { annotations: Object.fromEntries(Object.keys(HINTS).map((h) => [h, t.annotations[h as keyof typeof HINTS]])), justifications: why };
}
for (const name of Object.keys(given.justifications ?? {})) if (!(name in TOOLS)) problems.push(`submission.json: ${name} is not a tool of the server`);
if (given.test_cases?.length !== 5 || given.negative_test_cases?.length !== 3) problems.push('submission.json: exactly five test_cases and three negative_test_cases');
for (const c of given.test_cases ?? []) {
	for (const name of text(c.tools_triggered).split(',').map((n) => n.trim())) if (!(name in TOOLS)) problems.push(`submission.json: test case names the tool ${name}, which the server does not have`);
}
if ([...text(given.app_info?.subtitle)].length > 30) problems.push('submission.json: app_info.subtitle is over 30 characters');
if (given.app_info?.display_name !== ui.displayName || given.app_info?.subtitle !== ui.shortDescription) problems.push('submission.json: display_name and subtitle must match the manifest');
const submission = path('../../dist/chatgpt-app-submission.json');

if (problems.length) {
	console.error(`Not packaged:\n- ${problems.join('\n- ')}`);
	process.exit(1);
}

rmSync(zip, { force: true });
execFileSync('zip', ['-q', '-r', '-X', zip, ...FILES], { cwd: out, stdio: 'inherit' });
writeFileSync(submission, `${JSON.stringify({
	$schema: 'https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json', schema_version: 1,
	app_info: given.app_info, tools, test_cases: given.test_cases, negative_test_cases: given.negative_test_cases,
}, null, 2).replaceAll('https://delphi.science', SITE)}\n`);
console.log(`${submission}: ${Object.keys(tools).length} tools, ${given.test_cases.length} test cases, ${given.negative_test_cases.length} negative`);
console.log(`${zip}: ${FILES.join(', ')}; server ${Object.values(servers!).map((s) => s.url).join(', ')}`);
