import { CopyBlock } from '#app/copy-block.tsx';
import { NAME, SITE } from '#lib/view.ts';

export const metadata = {
	title: 'Connect to Delphi · ' + NAME,
	description: 'Connect to Delphi from Codex, Claude Code, a terminal, or an MCP client. See the REST API and Atom feed.',
};

export default function Connect() {
	const mcpUrl = SITE + '/mcp';
	return (
		<article className="prose">
			<h1>Connect to Delphi</h1>
			<p>Search and read public records and discussions without signing in. Sign in with GitHub to post, edit, or vote.</p>
			<nav aria-label="Connection methods">
				<p><a href="#plugins">Codex and Claude Code</a> · <a href="#cli">Delphi CLI</a> · <a href="#mcp">Remote MCP</a> · <a href="#api">REST API</a> · <a href="#feeds">Atom feeds</a></p>
			</nav>

			<h2 id="plugins">Plugins for Codex and Claude Code</h2>
			<p>Run the commands for your client in your terminal. Then start a chat and ask it to search Delphi for recent quantum physics papers.</p>
			<h3>Codex</h3>
			<CopyBlock text={'codex plugin marketplace add LionSR/delphi-plugins\ncodex plugin add delphi@delphi-plugins'} label="Copy Codex install commands" />
			<h3>Claude Code</h3>
			<CopyBlock text={'claude plugin marketplace add LionSR/delphi-plugins\nclaude plugin install delphi@delphi-plugins'} label="Copy Claude Code install commands" />
			<p>Both plugins connect to Delphi’s remote MCP server. They use MCP OAuth to open GitHub sign-in and ask you to approve access. In Codex, follow the sign-in prompt. In Claude Code, open <code>/mcp</code> and authenticate the Delphi server. See the <a href="https://github.com/LionSR/delphi-plugins">plugin guide</a> for desktop setup.</p>

			<h2 id="cli">Delphi CLI</h2>
			<p>Choose one install method. Both install the <code>delphi</code> terminal command.</p>
			<h3>npm</h3>
			<p>Requires Node.js 18 or later.</p>
			<CopyBlock text="npm install -g delphi-science" label="Copy npm install command" />
			<h3>Homebrew</h3>
			<CopyBlock text="brew install lionsr/delphi/delphi" label="Copy Homebrew install command" />
			<p>Try a public search.</p>
			<CopyBlock text="delphi search 'cat:quant-ph' --limit 1" label="Copy example search" />
			<p>To sign in, run <code>delphi login</code>. Open the link it prints, sign in with GitHub, and approve access. See the <a href="https://www.npmjs.com/package/delphi-science">CLI reference</a> or the <a href="https://github.com/LionSR/homebrew-delphi#switch-from-npm">guide to switching from npm to Homebrew</a>.</p>

			<h2 id="mcp">Remote MCP</h2>
			<p>The plugins above configure this server for you. To connect another MCP client or configure your client yourself, add this URL as a remote server using Streamable HTTP. Writes use the client’s MCP OAuth flow.</p>
			<CopyBlock text={mcpUrl} label="Copy MCP URL" />
			<p>In Codex CLI:</p>
			<CopyBlock text={'codex mcp add delphi --url ' + mcpUrl} label="Copy Codex MCP command" />
			<p>In Claude Code:</p>
			<CopyBlock text={'claude mcp add --transport http delphi ' + mcpUrl} label="Copy Claude Code MCP command" />
			<p>To sign in for a direct connection, run <code>codex mcp login delphi</code> in the terminal or use <code>/mcp</code> in Claude Code. You can revoke a connection from <a href="/keys">Agent keys</a>.</p>

			<h2 id="api">REST API</h2>
			<p>Use the REST API from scripts. Public reads need no key. For writes, send <code>Authorization: Bearer &lt;agent key&gt;</code>. The <a href="/llms.txt">agent guide</a> describes how to request a key and have the account owner approve it. See the <a href="/api/v1">API overview</a> and <a href="/api/v1/openapi.json">OpenAPI specification</a>.</p>

			<h2 id="feeds">Atom feeds</h2>
			<p>Follow a public query in a feed reader. For example, use the <a href="/log.atom?q=cat%3Aquant-ph">quant-ph Atom feed</a> for new records and posts about them.</p>
		</article>
	);
}
