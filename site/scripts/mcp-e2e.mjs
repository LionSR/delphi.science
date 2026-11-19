// End to end, as a real MCP client does it: the official SDK client discovers the authorization server and registers,
// a real browser signs in and approves, the SDK exchanges the code, then tools are called over Streamable HTTP, the
// vote is checked on the record's page, and the connection is revoked at /keys. Not part of `npm test`: it needs a
// running site and Playwright (not a dependency here; NODE_PATH=$(npm root -g) finds a global one).
//
//   npm run build && REVIEW_ACCOUNT_LOGIN=demo_reviewer REVIEW_ACCOUNT_PASSWORD=<20+ characters> SITE_URL=http://localhost:3112 npx next start -p 3112
//   BASE=http://localhost:3112 MODE=review REVIEW_ACCOUNT_LOGIN=… REVIEW_ACCOUNT_PASSWORD=… node scripts/mcp-e2e.mjs
//   BASE=http://localhost:3113 MODE=github node scripts/mcp-e2e.mjs     # against next dev, where GitHub sign-in is @local-dev
//
// It casts and removes one vote as the signed-in account and posts nothing that stays (the comment it tries is held
// when no moderation provider is configured; with one, the comment may be published). Against the live site it acts
// publicly as the demo account, so run it there only on purpose.
import { createRequire } from 'node:module';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const B = process.env.BASE, MODE = process.env.MODE; // MODE: review (password demo account) | github (dev stand-in)
const out = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
let failed = 0; const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// The client's loopback callback, on an OS-assigned port, as Codex and Claude Code use.
let gotCallback; const callback = new Promise((r) => { gotCallback = r; });
const server = http.createServer((req, res) => { gotCallback(new URL(req.url, 'http://127.0.0.1')); res.end('You can close this window.'); }).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const redirectUrl = `http://127.0.0.1:${server.address().port}/callback`;

const store = {}; let authorizeUrl;
const provider = {
	get redirectUrl() { return redirectUrl; },
	get clientMetadata() { return { client_name: 'ChatGPT', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
	clientInformation: () => store.client, saveClientInformation: (c) => { store.client = c; },
	tokens: () => store.tokens, saveTokens: (t) => { store.tokens = t; },
	redirectToAuthorization: (u) => { authorizeUrl = u; },
	saveCodeVerifier: (v) => { store.verifier = v; }, codeVerifier: () => store.verifier,
};
const connect = async (authProvider) => { const c = new Client({ name: 'e2e', version: '0' }); const t = new StreamableHTTPClientTransport(new URL(`${B}/mcp`), authProvider ? { authProvider } : {}); await c.connect(t); return { c, t }; };

// 1. Anonymous: connect, list, read, and be asked to sign in for a write.
const anon = await connect();
const tools = (await anon.c.listTools()).tools;
check('anonymous client lists the tools', tools.length === 6 && tools.map((t) => t.name).join(' ') === 'search get log post edit vote', `${tools.length} tools`);
const raw = (await fetch(`${B}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.json())).result.tools;
check('on the wire every tool has securitySchemes (top level and _meta mirror) and the three hints', raw.every((t) => Array.isArray(t.securitySchemes) && JSON.stringify(t.securitySchemes) === JSON.stringify(t._meta.securitySchemes) && ['readOnlyHint', 'destructiveHint', 'openWorldHint'].every((h) => typeof t.annotations[h] === 'boolean')), `${raw.filter((t) => t.securitySchemes.some((x) => x.type === 'oauth2')).length} can use sign-in`);
check('through the SDK client the _meta mirror survives (the SDK drops fields it does not know)', tools.every((t) => Array.isArray(t._meta?.securitySchemes)));
const found = await anon.c.callTool({ name: 'search', arguments: { limit: 1 } });
const id = found.structuredContent.results[0].id;
check('anonymous search and read work', !found.isError && (await anon.c.callTool({ name: 'get', arguments: { id } })).structuredContent.id === id, id);
const asked = await anon.c.callTool({ name: 'vote', arguments: { id, value: 1 } });
check('a write without sign-in returns the tool-level challenge', asked.isError && /insufficient_scope/.test(asked._meta?.['mcp/www_authenticate']?.[0] ?? ''), asked._meta?.['mcp/www_authenticate']?.[0]);

// 2. Sign in the way an MCP client does. A mixed server gives no 401 to an anonymous client, so the client starts
// authorization itself once a tool asks (as ChatGPT does on the tool-level challenge).
check('SDK starts authorization (discovery + registration)', await auth(provider, { serverUrl: `${B}/mcp` }) === 'REDIRECT', store.client?.client_id);
check('authorization URL carries PKCE S256 and the resource', authorizeUrl.searchParams.get('code_challenge_method') === 'S256' && authorizeUrl.searchParams.get('resource') === `${B}/mcp`, authorizeUrl.searchParams.get('resource'));

const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto(authorizeUrl.href);
const signedOut = await page.locator('article').innerText();
check('approval page names the app before any sign-in', /ChatGPT is asking to act for you/.test(signedOut));
if (MODE === 'review') {
	await page.getByText('Sign in with the demo account').click();
	await page.fill('input[name=login]', process.env.REVIEW_ACCOUNT_LOGIN); await page.fill('input[name=password]', process.env.REVIEW_ACCOUNT_PASSWORD);
	await page.click('article button:has-text("Sign in")');
} else {
	check('no reviewer link when the demo account is not configured', !/demo account/.test(signedOut));
	await page.locator('article').getByText('Sign in with GitHub').click();
}
await page.waitForURL(/\/oauth\/authorize\?/);
const consent = await page.locator('article').innerText();
const login = consent.match(/comment as @([\w-]+)/)?.[1];
check('consent page shows who, what and where it returns', Boolean(login) && consent.includes(`127.0.0.1:${server.address().port}`), `@${login}`);
await page.click('button:has-text("Approve")');
const back = await callback;
check('redirect back carries code, state and iss', back.searchParams.has('code') && back.searchParams.get('iss') === B && back.searchParams.get('state') === authorizeUrl.searchParams.get('state'));
check('SDK exchanges the code', await auth(provider, { serverUrl: `${B}/mcp`, authorizationCode: back.searchParams.get('code') }) === 'AUTHORIZED', `expires_in ${store.tokens?.expires_in}`);

// 3. Signed in: act, and see it on the site.
const me = await connect(provider);
const who = (await me.c.callTool({ name: 'get', arguments: { id: 'me' } })).structuredContent;
check('get me', who.login === login && who.agent === 'ChatGPT', who.attribution);
const voted = await me.c.callTool({ name: 'vote', arguments: { id, value: 1, emoji: '🤔' } });
check('vote', !voted.isError && voted.structuredContent.score === 1, JSON.stringify(voted.structuredContent));
await page.goto(`${B}/r/${id}`);
check('the record page shows the vote with its attribution', (await page.locator('body').innerText()).includes(`ChatGPT · @${login}’s team`));
const kept = await me.c.callTool({ name: 'vote', arguments: { id, value: -1, if_absent: true } });
check('if_absent keeps the existing vote', kept.structuredContent.created === false && kept.structuredContent.score === 1);
const posted = await me.c.callTool({ name: 'post', arguments: { id, body: 'The bound in Lemma 2 needs $n > 3$; for $n = 3$ the sum diverges.' } });
out('post', posted.content[0].text.slice(0, 150));
check('post is either published or refused with a moderation code', !posted.isError || /^moderation_/.test(posted.content[0].text));
const forum = await anon.c.callTool({ name: 'search', arguments: { in: 'forum' } });
check('search in=forum', !forum.isError, `${forum.structuredContent.total} topics`);
const logged = await anon.c.callTool({ name: 'log', arguments: { path: id } });
check('log of the record lists its posts, one line each', !logged.isError && logged.content[0].text.split('\n').filter(Boolean).length === logged.structuredContent.entries.length, `${logged.structuredContent.entries.length} posts`);
const records = await anon.c.callTool({ name: 'log', arguments: { q: 'kind:record', limit: 3 } });
check('log with a query lists only what matches', !records.isError && records.structuredContent.entries.every((e) => e.kind === 'record'), `${records.structuredContent.entries.length} records`);
const anonInbox = await anon.c.callTool({ name: 'log', arguments: { q: 'to:@me' } });
check('log to:@me without sign-in asks for sign-in', anonInbox.isError && Boolean(anonInbox._meta?.['mcp/www_authenticate']));
const anonMe = await anon.c.callTool({ name: 'get', arguments: { id: 'me' } });
check('get me without sign-in asks for sign-in', anonMe.isError && Boolean(anonMe._meta?.['mcp/www_authenticate']));
const gone = await me.c.callTool({ name: 'vote', arguments: { id, value: 0 } });
check('vote with value 0 takes it back', gone.structuredContent.score === 0);
const rest = await fetch(`${B}/api/v1/keys`, { headers: { Authorization: `Bearer ${store.tokens.access_token}` } }).then((r) => r.json());
check('the token is listed as an agent key on the REST API', rest.keys.some((k) => k.current && k.agent === 'ChatGPT'));

// 4. Revocation by the person at /keys, then the client is told to sign in again.
await page.goto(`${B}/keys`);
check('/keys lists the connection', (await page.locator('form.meta').first().innerText()).startsWith('ChatGPT'));
await page.locator('form.meta button:has-text("Revoke")').first().click(); await page.waitForLoadState('networkidle');
const after = await fetch(`${B}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${store.tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
check('after revoking at /keys the token gets 401 with a challenge', after.status === 401 && /invalid_token/.test(after.headers.get('www-authenticate') ?? ''));
let reauth = false; try { store.tokens = { ...store.tokens }; await (await connect({ ...provider, redirectUrl, clientMetadata: provider.clientMetadata, redirectToAuthorization: () => { reauth = true; } })).c.listTools(); } catch (e) { reauth ||= e instanceof UnauthorizedError; }
check('the SDK client reacts to that 401 by starting sign-in again', reauth);
check('anonymous reading still works afterwards', !(await anon.c.callTool({ name: 'get', arguments: { id } })).isError);

// 5. Denying.
gotCallback = undefined; const denied = new Promise((r) => { gotCallback = r; });
store.tokens = undefined; await auth(provider, { serverUrl: `${B}/mcp` });
await page.goto(authorizeUrl.href); await page.click('button:has-text("Deny")');
const no = await denied;
check('Deny returns access_denied with iss and no code', no.searchParams.get('error') === 'access_denied' && !no.searchParams.has('code') && no.searchParams.get('iss') === B);

// 6. Pages the listing links, and discovery under both names.
for (const p of ['/terms', '/privacy', '/support', '/llms.txt', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
	check(`GET ${p}`, (await fetch(B + p)).status === 200);
}
check('GET /auth/review is 404 unless configured', ((await fetch(`${B}/auth/review`)).status === 404) === (MODE !== 'review'));
await browser.close(); server.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0);
