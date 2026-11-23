import { CopyBlock } from '#app/copy-block.tsx';
import { NetworkDiagram, VersioningDiagram } from './diagrams.tsx';
import { P2P_REPO, REPO } from '#lib/contact.ts';
import { NAME } from '#lib/view.ts';

export const metadata = {
	title: `Peer-to-peer files and Lean checks · ${NAME}`,
	description: 'Share immutable research snapshots by hash and independently verify Lean proofs in a sandbox with delphi-p2p.',
};

export default function P2P() {
	return (
		<article className="prose">
			<h1>Peer-to-peer files and Lean checks</h1>
			<p className="lead">Share versioned research files and independently verify Lean proofs directly between peers, without depending on a central server.</p>
			<p className="count">Early preview · No Delphi account required · <a href={P2P_REPO}>delphi-p2p on GitHub</a></p>

			<h2>Why it exists</h2>
			<p>A repository branch can change or disappear after someone checks it, building an untrusted Lean project locally can run arbitrary code, and claims that a proof passed rarely stay tied to the exact files that were checked.</p>
			<p><code>delphi-p2p</code> hashes each published directory, runs Lean’s kernel checker in a sandbox, and signs pass or fail verdicts with the verifier’s key. Delphi.science displays those versions, file diffs, and check counts under <strong>Files and checks</strong> on record pages, while the files and signed claims remain on the peer network even if this site goes offline.</p>
			<NetworkDiagram />

			<h2>How it works</h2>
			<div className="feature-grid">
				<div className="feature-card">
					<strong>Versioned snapshots</strong>
					<p>Every publish hashes the full directory. New versions from the original key advance the record; edits from another key create a fork and never overwrite the original.</p>
				</div>
				<div className="feature-card">
					<strong>Sandboxed Lean checks</strong>
					<p>Re-runs <code>lake check</code> or <code>lake comparator</code> (Lean 4.35+) inside a sandbox (bubblewrap on Linux, Docker on macOS) and rejects disallowed axioms.</p>
				</div>
				<div className="feature-card">
					<strong>Verdicts tied to exact files</strong>
					<p>Each signed pass or fail applies only to one snapshot hash and counts once per verifying key. A new version starts at zero checks.</p>
				</div>
				<div className="feature-card">
					<strong>No central server</strong>
					<p>Peers host and fetch files directly. Anyone can mirror artifacts, run their own network, or show the same signed claims on another site.</p>
				</div>
			</div>
			<VersioningDiagram />

			<h2>Getting started</h2>
			<p>Requires Rust 1.96 or later on Linux or macOS:</p>
			<CopyBlock text={`git clone ${P2P_REPO}.git\ncd delphi-p2p\ncargo install --locked --path .`} label="Copy install commands" />
			<p>Join an existing network using the relay URL and seed key from its operator, or run <code>delphi-p2p init</code> with no flags to try on your local network:</p>
			<CopyBlock text="delphi-p2p init --relay <relay-URL> --bootstrap <seed-key>@<relay-URL>" label="Copy init command" />

			<h3>Inspect, fetch, and check</h3>
			<pre>{`delphi-p2p log --kind publish        # list published artifacts
delphi-p2p files <id>                # preview files and diffs without downloading
delphi-p2p get <id> --files ./work   # download the latest version into an empty folder
delphi-p2p check <id>                # verify a Lean proof in a sandbox and sign the result`}</pre>
			<div className="callout">
				<p>Always run <code>delphi-p2p check</code> rather than running <code>lake</code> or <code>lean</code> directly in a downloaded folder; Lean builds can execute project code. On macOS, checking requires Docker.</p>
			</div>

			<h3>Publish files</h3>
			<CopyBlock text={`delphi-p2p publish ./my-proof \\\n  --title "Proof of Theorem 1" \\\n  --author "Ada Lovelace" \\\n  --source "https://arxiv.org/abs/2610.20058"`} label="Copy publish command" />
			<p>Passing <code>--source</code> with the paper or repository URL attaches the artifact’s versions and check counts to that record’s page on Delphi.science. Running <code>delphi-p2p publish ./my-proof --note &quot;…&quot;</code> after editing publishes a new version (or a fork when editing someone else’s downloaded files).</p>

			<h2>Documentation and hosting</h2>
			<ul>
				<li><strong>Full client &amp; network guide:</strong> running a mirroring node (<code>delphi-p2p serve --mirror</code>), setting up a relay and seed peer, and troubleshooting are in the <a href={P2P_REPO}>delphi-p2p repository</a>.</li>
				<li><strong>AI agent skill:</strong> load <code>skills/delphi-p2p/SKILL.md</code> from the <a href={P2P_REPO}>delphi-p2p repository</a>.</li>
				<li><strong>Website bridge:</strong> run <a href={`${REPO}/tree/main/bridge`}>delphi.science/bridge</a> beside a mirroring node to relay claims and file lists to a site.</li>
			</ul>
		</article>
	);
}
