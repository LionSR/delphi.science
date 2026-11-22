// A record's "Files and checks": what the peer-to-peer network (github.com/LionSR/delphi-p2p) holds for it. One row per version of each
// artifact; a row opens to the version's files and what changed in them. The data and its rules: #lib/p2p/claims.ts.
import { CopyBlock } from './copy-block.tsx';
import { date } from '#lib/view.ts';
import { short, size, type Artifact, type State, type Version } from '#lib/p2p/claims.ts';

/** What a version's state means, said when the version is opened. */
const MEANING: Record<State, string> = {
	current: 'Latest version from the original publisher’s key.',
	earlier: 'Superseded by a newer version from the same key.',
	open: 'Branch version from the original key.',
	fork: 'Version published by a different key; does not replace the original.',
};

const count = (n: number, thing: string) => `${n} ${thing}${n === 1 ? '' : 's'}`;

/** "2 passed · Lean v4.36.0" or "1 passed, 1 failed"; a version no key has checked says so. */
function Checks({ v }: { v: Version }) {
	if (!v.pass && !v.fail) return <span className="none">not checked</span>;
	const verdicts = [v.pass > 0 && `${v.pass} passed`, v.fail > 0 && `${v.fail} failed`].filter(Boolean).join(', ');
	return (
		<span className={v.fail ? 'failed' : undefined} title="Keys whose newest check of exactly this version passed or failed">
			{verdicts}{v.lean.length > 0 && ` · Lean ${v.lean.join(', ')}`}
		</span>
	);
}

function Row({ v }: { v: Version }) {
	const list = v.listing;
	return (
		<details open={v.state === 'current'}>
			<summary>
				<span><span className={`state ${v.state}`}>{v.state}</span><code title={v.id}>{short(v.id)}</code></span>
				<span title={new Date(v.at).toISOString()}>{date(v.at)}</span>
				<span>{count(v.files, 'file')} · {size(v.bytes)}</span>
				<span title="Clients that say they hold these files">{count(v.holders, 'holder')}</span>
				<Checks v={v} />
			</summary>
			<div className="opened">
				<p className="count">
					{MEANING[v.state]} Signed by key <code title={v.author}>{short(v.author)}</code>
					{v.after && <>, after version <code title={v.after}>{short(v.after)}</code></>}.
					{v.state !== 'current' && <> To fetch exactly this version: <code>delphi-p2p get {short(v.id)} --exact --files ./work</code></>}
				</p>
				{list ? (
					<>
						<table className="stats">
							<thead>
								<tr><th>File</th><th className="num">Size</th>{list.after && <th>Since <code>{short(list.after)}</code></th>}</tr>
							</thead>
							<tbody>
								{list.files.map((f) => (
									<tr key={f.path} className={f.change ?? undefined}>
										<td><code>{f.path}</code></td>
										<td className="num">{size(f.bytes)}</td>
										{list.after && <td>{f.change}</td>}
									</tr>
								))}
							</tbody>
						</table>
						{list.more + list.unshown > 0 && (
							<p className="count">
								{[list.more > 0 && `${list.more} more files are not listed.`, list.unshown > 0 && `${list.unshown} have names this site does not show.`].filter(Boolean).join(' ')}
							</p>
						)}
					</>
				) : <p className="count">This site has no file list for this version.</p>}
			</div>
		</details>
	);
}

export function SharedFiles({ artifacts }: { artifacts: Artifact[] }) {
	if (!artifacts.length) return null;
	return (
		<section className="record-section" aria-label="Files and checks">
			<h2>Files and checks</h2>
			<p className="count">Peer-shared files and independent Lean verification checks linked to this record via <code>delphi-p2p</code> (<a href="https://github.com/LionSR/delphi-p2p">client guide</a>). Files are hosted by peers and each check is signed by the verifying client’s key.</p>
			{artifacts.map((a) => {
				// The current version first, then the others, newest first.
				const versions = [...a.versions].sort((x, y) => Number(y.state === 'current') - Number(x.state === 'current') || +new Date(y.at) - +new Date(x.at));
				const forks = a.versions.filter((v) => v.state === 'fork').length;
				return (
					<div key={a.id} className="artifact">
						<p className="meta">
							<span>Artifact <code title={a.id}>{short(a.id)}</code></span>
							<span>{count(a.versions.length - forks, 'version')}{forks > 0 && `, ${count(forks, 'fork')}`}</span>
						</p>
						<div className="versions">{versions.map((v) => <Row key={v.id} v={v} />)}</div>
						<CopyBlock text={`# Fetch the current version from any client that holds it.\ndelphi-p2p get ${short(a.id)} --files ./work\n# Re-run the Lean checker in a sandbox and sign the result.\ndelphi-p2p check ${short(a.id)}`} />
					</div>
				);
			})}
		</section>
	);
}
