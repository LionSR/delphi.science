import { CopyBlock } from '#app/copy-block.tsx';
import { NetworkDiagram, VersioningDiagram } from './diagrams.tsx';
import { P2P_REPO, REPO } from '#lib/contact.ts';
import { NAME } from '#lib/view.ts';

export const metadata = {
	title: `Peer-to-peer files and Lean checks · ${NAME}`,
	description: 'Share research snapshots by content hash and check Lean proofs in a sandbox with delphi-p2p.',
};

export default function P2P() {
	return (
		<article className="prose">
			<h1>Peer-to-peer files and Lean checks</h1>
			<p className="lead">Share versioned research files and check Lean proofs between peers, with no central server.</p>
			<p className="count">Early preview · No Delphi account required · <a href={P2P_REPO}>delphi-p2p on GitHub</a></p>

			<h2>How it works</h2>
			<p><code>delphi-p2p</code> publishes directories by content hash so files cannot change after review. Peers transfer files with <a href="https://github.com/n0-computer/iroh-blobs">iroh-blobs</a> over <a href="https://github.com/n0-computer/iroh">iroh</a> and sync signed claims with <a href="https://github.com/p2panda/p2panda">p2panda</a>.</p>
			<p>To check a Lean 4.35+ proof without running untrusted build code on the host, <code>delphi-p2p check</code> runs <code>lake check</code> or <code>lake comparator</code> inside a sandbox and signs a pass or fail verdict for that snapshot hash. Record pages on Delphi.science mirror versions, file diffs, and check counts under <strong>Files and checks</strong>. The files and signed claims remain on the peer network.</p>
			<NetworkDiagram />

			<h2>Versions, forks, and checks</h2>
			<p>A new version signed by the original key replaces the current version. A version signed by another key is a fork and does not replace it. Each check applies to one snapshot hash, and each key counts once.</p>
			<VersioningDiagram />

			<h2>Install and use</h2>
			<p>Requires Rust 1.96+ on Linux or macOS:</p>
			<CopyBlock text={`git clone ${P2P_REPO}.git\ncd delphi-p2p\ncargo install --locked --path .`} label="Copy install commands" />
			<p>Join a network using the operator’s iroh relay URL and seed key, or run <code>delphi-p2p init</code> with no flags on a local network:</p>
			<CopyBlock text="delphi-p2p init --relay <relay-URL> --bootstrap <seed-key>@<relay-URL>" label="Copy init command" />

			<h3>Fetch and check</h3>
			<pre>{`delphi-p2p log --kind publish        # list published artifacts
delphi-p2p files <id>                # preview files and diffs
delphi-p2p get <id> --files ./work   # download into an empty folder
delphi-p2p check <id>                # check Lean proof in a sandbox and sign verdict`}</pre>
			<p className="count">Use <code>delphi-p2p check</code> instead of running <code>lake</code> or <code>lean</code> directly on downloaded files, since Lean builds can run project code. Checking on macOS requires Docker.</p>

			<h3>Publish</h3>
			<CopyBlock text={`delphi-p2p publish ./my-proof \\\n  --title "Proof of Theorem 1" \\\n  --author "Ada Lovelace" \\\n  --source "https://arxiv.org/abs/2610.20058"`} label="Copy publish command" />
			<p><code>--source</code> links the artifact to that record on Delphi.science. Re-run <code>delphi-p2p publish ./my-proof --note &quot;…&quot;</code> to publish a new version, or run it on downloaded files to publish a fork.</p>

			<h2>More</h2>
			<ul>
				<li><a href={P2P_REPO}>delphi-p2p repository</a>: command reference, mirroring (<code>serve --mirror</code>), running an <code>iroh-relay</code> and seed peer, and the agent skill (<code>skills/delphi-p2p/SKILL.md</code>).</li>
				<li><a href={`${REPO}/tree/main/bridge`}>Website bridge</a>: relay claims and file lists from a mirroring peer to a website.</li>
			</ul>
		</article>
	);
}
