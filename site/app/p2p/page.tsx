import { CopyBlock } from '#app/copy-block.tsx';
import { NetworkDiagram, VersioningDiagram } from './diagrams.tsx';
import { P2P_REPO, REPO } from '#lib/contact.ts';
import { NAME } from '#lib/view.ts';

export const metadata = {
	title: `Peer-to-peer files and Lean checks · ${NAME}`,
	description: 'Share research snapshots by hash and independently verify Lean proofs in a sandbox with delphi-p2p.',
};

export default function P2P() {
	return (
		<article className="prose">
			<h1>Peer-to-peer files and Lean checks</h1>
			<p className="lead">Share versioned research files and verify Lean proofs directly between peers, without a central server.</p>
			<p className="count">Early preview · No Delphi account required · <a href={P2P_REPO}>delphi-p2p on GitHub</a></p>

			<h2>Why it exists</h2>
			<p>A Git branch can change or vanish after someone reviews it, building an untrusted Lean project locally can run arbitrary code, and claims that a proof passed rarely stay tied to the exact files checked.</p>
			<p><code>delphi-p2p</code> hashes each published directory, runs Lean’s kernel checker (Lean 4.35+) in a sandbox, and signs pass or fail verdicts with the verifier’s key. Delphi.science mirrors versions, file diffs, and check counts under <strong>Files and checks</strong> on record pages, while files and signatures stay on the peer network.</p>
			<NetworkDiagram />

			<h2>Versions, forks, and checks</h2>
			<p>Updates signed by the original key advance the record’s current version; edits from another key create a separate fork. Every signed verdict applies only to one snapshot hash and counts once per key.</p>
			<VersioningDiagram />

			<h2>Getting started</h2>
			<p>Requires Rust 1.96+ on Linux or macOS:</p>
			<CopyBlock text={`git clone ${P2P_REPO}.git\ncd delphi-p2p\ncargo install --locked --path .`} label="Copy install commands" />
			<p>Join a network with the operator’s relay URL and seed key (or run <code>delphi-p2p init</code> with no flags on a local network):</p>
			<CopyBlock text="delphi-p2p init --relay <relay-URL> --bootstrap <seed-key>@<relay-URL>" label="Copy init command" />

			<h3>Fetch and check</h3>
			<pre>{`delphi-p2p log --kind publish        # list published artifacts
delphi-p2p files <id>                # preview files and diffs
delphi-p2p get <id> --files ./work   # download into an empty folder
delphi-p2p check <id>                # check Lean proof in a sandbox and sign verdict`}</pre>
			<p className="count">Always use <code>delphi-p2p check</code> instead of running <code>lake</code> or <code>lean</code> directly on downloaded files; Lean builds can run project code. Checking on macOS requires Docker.</p>

			<h3>Publish</h3>
			<CopyBlock text={`delphi-p2p publish ./my-proof \\\n  --title "Proof of Theorem 1" \\\n  --author "Ada Lovelace" \\\n  --source "https://arxiv.org/abs/2610.20058"`} label="Copy publish command" />
			<p><code>--source</code> links the artifact to that record page on Delphi.science. Re-running <code>delphi-p2p publish ./my-proof --note &quot;…&quot;</code> publishes a new version (or a fork on downloaded files).</p>

			<h2>More</h2>
			<ul>
				<li><a href={P2P_REPO}>Full guide &amp; hosting</a>: mirroring (<code>serve --mirror</code>), running a relay and seed peer, and the agent skill (<code>skills/delphi-p2p/SKILL.md</code>).</li>
				<li><a href={`${REPO}/tree/main/bridge`}>Website bridge</a>: relay claims and file lists from a mirroring peer to a site.</li>
			</ul>
		</article>
	);
}
