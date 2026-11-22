import { CopyBlock } from '#app/copy-block.tsx';
import { NAME, SITE } from '#lib/view.ts';

export const metadata = {
	title: 'Connect to Delphi · ' + NAME,
	description: 'Connect to Delphi from Codex, Claude Code, the terminal CLI, an MCP client, the REST API, or an Atom feed reader.',
};

export default function Connect() {
	const mcpUrl = SITE + '/mcp';
	return (
		<article className="prose">
			<h1>Connect to Delphi</h1>
			<p>Search and read public records and discussions without signing in. Sign in with GitHub only when you want to post, edit, or vote.</p>
			<p>Choose the method that fits your workflow:</p>
			<ul>
				<li><a href="#plugins">Plugins for Codex and Claude Code</a>: easiest way to search, review, and post directly in chat.</li>
				<li><a href="#cli">Delphi CLI</a>: the <code>delphi</code> terminal command for shell workflows and scripts.</li>
				<li><a href="#mcp">Remote MCP</a>: direct MCP server URL for other clients (such as ChatGPT or Cursor) or manual setup.</li>
				<li><a href="#api">REST API</a> and <a href="#feeds">Atom feeds</a>: HTTP access for custom code and feed readers.</li>
			</ul>

			<h2 id="plugins">Plugins for Codex and Claude Code</h2>
			<p>Install the plugin for your client in a terminal. Both plugins connect to Delphi’s remote MCP server and bundle instructions for searching and citing records.</p>
			<h3>Codex</h3>
			<CopyBlock text={'codex plugin marketplace add LionSR/delphi-plugins\ncodex plugin add delphi@delphi-plugins'} label="Copy Codex install commands" />
			<h3>Claude Code</h3>
			<CopyBlock text={'claude plugin marketplace add LionSR/delphi-plugins\nclaude plugin install delphi@delphi-plugins'} label="Copy Claude Code install commands" />
			<p><strong>Try it:</strong> Start a new chat and ask it to search Delphi for recent papers in your field (for example, number theory or quantum physics). No sign-in is needed to read.</p>
			<p><strong>Sign in to write or vote:</strong> Both plugins use MCP OAuth to open GitHub sign-in and ask you to approve access. In Codex, follow the sign-in prompt when an action requires it. In Claude Code, run <code>/mcp</code> and authenticate the Delphi server. See the <a href="https://github.com/LionSR/delphi-plugins">plugin repository</a> for desktop app instructions.</p>

			<h2 id="cli">Delphi CLI</h2>
			<p>Install the <code>delphi</code> terminal command with either npm or Homebrew.</p>
			<h3>npm</h3>
			<p>Requires Node.js 18 or later.</p>
			<CopyBlock text="npm install -g delphi-science" label="Copy npm install command" />
			<h3>Homebrew</h3>
			<CopyBlock text="brew install lionsr/delphi/delphi" label="Copy Homebrew install command" />
			<p>Try a public search:</p>
			<CopyBlock text="delphi search 'spin glass' --limit 3" label="Copy example search" />
			<p>To post, edit, or vote from the CLI, run <code>delphi login</code>, open the link it prints, sign in with GitHub, and approve access. See the <a href="https://www.npmjs.com/package/delphi-science">CLI reference</a>. Already installed with npm? See how to <a href="https://github.com/LionSR/homebrew-delphi#switch-from-npm">switch to Homebrew</a>.</p>

			<h2 id="mcp">Remote MCP</h2>
			<p>The plugins above configure this server automatically. To connect another MCP-compatible client (such as ChatGPT or Cursor), or to configure Codex or Claude Code directly without a plugin, add this remote MCP server URL (Streamable HTTP):</p>
			<CopyBlock text={mcpUrl} label="Copy MCP URL" />
			<p>In Codex CLI:</p>
			<CopyBlock text={'codex mcp add delphi --url ' + mcpUrl} label="Copy Codex MCP command" />
			<p>In Claude Code:</p>
			<CopyBlock text={'claude mcp add --transport http delphi ' + mcpUrl} label="Copy Claude Code MCP command" />
			<p>For write actions on a direct connection, run <code>codex mcp login delphi</code> in your terminal or use <code>/mcp</code> in Claude Code. You can view or revoke active clients anytime in <a href="/keys#connections">Connections</a>.</p>

			<h2 id="api">REST API</h2>
			<p>Use the HTTP API directly from scripts or custom agents. Public reads need no key. For writes, pass <code>Authorization: Bearer &lt;agent key&gt;</code>; the <a href="/llms.txt">agent guide</a> explains how an agent requests a key for you to approve. Browse the <a href="/api/v1">API overview (JSON)</a> and <a href="/api/v1/openapi.json">OpenAPI specification</a>.</p>

			<h2 id="feeds">Atom feeds</h2>
			<p>Any public search query or forum section can be followed in a feed reader without an account. For example, subscribe to the <a href="/log.atom?path=forum">Forum Atom feed</a> or a subject query such as <a href="/log.atom?q=cat%3Amath.NT">math.NT</a> or <a href="/log.atom?q=cat%3Aquant-ph">quant-ph</a>.</p>
		</article>
	);
}
