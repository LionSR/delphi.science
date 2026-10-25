// Packages the ChatGPT and Codex plugin (site/plugin/) as the ZIP to upload in OpenAI's plugin portal.
//
//   npm run plugin                          # dist/open-research-index-plugin.zip, for the site's host
//   SITE_URL=https://example.org npm run plugin
//
// The files in plugin/ do not name the host: {{SITE}} in them becomes SITE (lib/view.ts, which reads SITE_URL),
// so the site and the plugin always point at the same place. Before zipping it checks the portal's rules that
// can be checked here: names that do not end in MCP or Plugin, at most 3 example prompts of 128 characters,
// https links. Needs the zip command. TESTING.md is for the portal's test-case form and is not packaged.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../lib/view.ts';

const FILES = ['plugin.json', 'mcp.json', 'assets/icon.png'];
const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const src = path('../plugin/'), out = path('../../dist/plugin/'), zip = path('../../dist/open-research-index-plugin.zip');

rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
	mkdirSync(dirname(out + f), { recursive: true });
	if (f.endsWith('.json')) writeFileSync(out + f, readFileSync(src + f, 'utf8').replaceAll('{{SITE}}', SITE));
	else copyFileSync(src + f, out + f);
}

const manifest = JSON.parse(readFileSync(out + 'plugin.json', 'utf8'));
const servers = JSON.parse(readFileSync(out + 'mcp.json', 'utf8')).mcpServers as Record<string, { url: string }>;
const problems: string[] = [];
for (const name of [manifest.name, manifest.interface?.displayName, ...Object.keys(servers)]) {
	if (/(mcp|plugin)$/i.test(String(name).trim())) problems.push(`${name}: a name must not end in MCP or Plugin`);
}
const prompts: string[] = manifest.interface?.defaultPrompt ?? [];
if (prompts.length > 3) problems.push(`${prompts.length} example prompts: at most 3`);
for (const p of prompts) if (p.length > 128) problems.push(`${JSON.stringify(p)}: over 128 characters`);
const urls = JSON.stringify([manifest, servers]).match(/"[a-z]+:\/\/[^"]*"/g) ?? [];
for (const u of urls) if (!u.startsWith('"https://') || u.length > 1026) problems.push(`${u}: links must be https and at most 1024 characters`);
if (problems.length) {
	console.error(`Not packaged:\n- ${problems.join('\n- ')}`);
	process.exit(1);
}

rmSync(zip, { force: true });
execFileSync('zip', ['-q', '-r', '-X', zip, ...FILES], { cwd: out, stdio: 'inherit' });
console.log(`${zip}: ${FILES.join(', ')}; server ${Object.values(servers).map((s) => s.url).join(', ')}`);
