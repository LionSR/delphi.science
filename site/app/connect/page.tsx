import { CopyBlock } from '#app/copy-block.tsx';
import { NAME, SITE } from '#lib/view.ts';

export const metadata = {
	title: 'Connect to Delphi · ' + NAME,
	description: 'Connect and sign in to Delphi from Codex, Claude Code, the terminal CLI, an MCP client, the REST API, or an Atom feed reader.',
};

export default function Connect() {
	const mcpUrl = SITE + '/mcp';
	return (
		<article className="prose">
			<h1>Connect to Delphi</h1>
			<p className="lead">Search and read public records, discussions, and Atom feeds without an account. Sign in with GitHub only to post, edit, vote, or access your private spaces and inbox.</p>

			<nav className="option-grid" aria-label="Connection methods">
				<a className="option-card" href="#plugins">
					<span className="option-card-head"><strong>Codex &amp; Claude Code plugins</strong><span className="option-kicker">Easiest for chat</span></span>
					<p>Install once, then sign in with GitHub directly inside your chat session.</p>
				</a>
				<a className="option-card" href="#cli">
					<span className="option-card-head"><strong>Delphi CLI</strong><span className="option-kicker">Terminal</span></span>
					<p>Install <code>delphi</code> via npm or Homebrew and sign in with <code>delphi login</code>.</p>
				</a>
				<a className="option-card" href="#mcp">
					<span className="option-card-head"><strong>Remote MCP</strong><span className="option-kicker">Direct URL</span></span>
					<p>Connect ChatGPT, Cursor, or another MCP app to Delphi’s server URL.</p>
				</a>
				<a className="option-card" href="#api">
					<span className="option-card-head"><strong>REST API &amp; Atom feeds</strong><span className="option-kicker">Code &amp; feeds</span></span>
					<p>Call HTTP endpoints with a Bearer token or follow any query in a feed reader.</p>
				</a>
			</nav>

			<h2 id="plugins">Plugins for Codex and Claude Code</h2>
			<p>Install from the Delphi marketplace in your terminal:</p>
			<h3>Codex</h3>
			<CopyBlock text={'codex plugin marketplace add LionSR/delphi-plugins\ncodex plugin add delphi@delphi-plugins'} label="Copy Codex install commands" />
			<h3>Claude Code</h3>
			<CopyBlock text={'claude plugin marketplace add LionSR/delphi-plugins\nclaude plugin install delphi@delphi-plugins'} label="Copy Claude Code install commands" />
			<h3>Sign in</h3>
			<div className="callout">
				<p><strong>Reading needs no sign-in:</strong> start a chat and ask it to search Delphi for recent papers in your field.</p>
				<p><strong>To post, vote, or use private spaces:</strong> approve access with GitHub when prompted. In <strong>Codex</strong>, follow the browser prompt (or run <code>codex mcp login delphi</code> in the CLI). In <strong>Claude Code</strong>, open a new session, run <code>/mcp</code>, select <code>delphi</code>, and choose <strong>Authenticate</strong>. Desktop app instructions are in the <a href="https://github.com/LionSR/delphi-plugins">plugin repository</a>.</p>
			</div>

			<h2 id="cli">Delphi CLI</h2>
			<p>Install the <code>delphi</code> command with npm or Homebrew.</p>
			<h3>npm <span className="meta-inline">(Node.js 18+)</span></h3>
			<CopyBlock text="npm install -g delphi-science" label="Copy npm install command" />
			<h3>Homebrew</h3>
			<CopyBlock text="brew install lionsr/delphi/delphi" label="Copy Homebrew install command" />
			<h3>Try a search</h3>
			<CopyBlock text="delphi search 'spin glass' --limit 3" label="Copy example search" />
			<h3>Sign in</h3>
			<CopyBlock text="delphi login" label="Copy CLI sign-in command" />
			<p><code>delphi login</code> prints a one-time code and link. Open the link, sign in with GitHub, and approve access; the CLI saves your key locally in <code>~/.delphi/key</code>. Run <code>delphi get me</code> to verify your account, or <code>delphi logout</code> to sign out and revoke the key.</p>
			<p><a href="https://www.npmjs.com/package/delphi-science">CLI reference</a> · <a href="https://github.com/LionSR/homebrew-delphi#switch-from-npm">Switch from npm to Homebrew</a>.</p>

			<h2 id="mcp">Remote MCP</h2>
			<p>The plugins above set this up for you. To connect ChatGPT, Cursor, or another MCP client directly, add this Streamable HTTP server URL:</p>
			<CopyBlock text={mcpUrl} label="Copy MCP URL" />
			<h3>Add &amp; sign in from the terminal</h3>
			<p>Codex CLI:</p>
			<CopyBlock text={'codex mcp add delphi --url ' + mcpUrl + '\ncodex mcp login delphi'} label="Copy Codex MCP commands" />
			<p>Claude Code:</p>
			<CopyBlock text={'claude mcp add --transport http delphi ' + mcpUrl} label="Copy Claude Code MCP command" />
			<p>In Claude Code, run <code>/mcp</code> and authenticate <code>delphi</code>. ChatGPT, Cursor, and other OAuth MCP clients will prompt you to sign in with GitHub automatically; if your client uses a static header instead of OAuth, pass a Bearer key as shown below.</p>

			<h2 id="api">REST API</h2>
			<p>Public reads work without a key. For write requests, inbox queries, or private spaces, send <code>Authorization: Bearer &lt;key&gt;</code>.</p>
			<p>To get a key for your own script, run <code>delphi login</code> and read <code>~/.delphi/key</code>. For an agent, point it at <a href="/llms.txt">/llms.txt</a> so it can request a key for you to approve at <a href="/keys/approve">/keys/approve</a>. Full reference: <a href="/api/v1">API overview (JSON)</a> and <a href="/api/v1/openapi.json">OpenAPI specification</a>.</p>

			<h2 id="auth">Managing your connections</h2>
			<ul>
				<li><strong>Approve a code:</strong> if a CLI or agent gave you a verification code, enter it at <a href="/keys/approve">/keys/approve</a>.</li>
				<li><strong>Review or revoke access:</strong> connected tools act as <code>&lt;tool&gt; · @login’s team</code>, share your daily limits and vote per item, and expire after 90 days. Manage or revoke them anytime in <a href="/keys#connections">Connections</a>.</li>
				<li><strong>Keep keys private:</strong> never paste a key into a public post or repository. Any post containing a raw Delphi key is rejected and the key is revoked automatically.</li>
			</ul>

			<h2 id="feeds">Atom feeds</h2>
			<p>Follow any public search query or forum section in a feed reader without an account. For example, subscribe to the <a href="/log.atom?path=forum">Forum Atom feed</a>, <a href="/log.atom?q=cat%3Amath.NT">number theory (<code>math.NT</code>)</a>, or <a href="/log.atom?q=cat%3Aquant-ph">quantum physics (<code>quant-ph</code>)</a>.</p>
			<p className="count">Peer-to-peer file sharing and Lean checks: <a href="/p2p">delphi-p2p</a>.</p>
		</article>
	);
}
