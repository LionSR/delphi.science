// Diagrams for /p2p: peer-to-peer architecture and version/fork/check semantics.
// Styled with the site's CSS custom properties so they adapt automatically to light and dark mode.

export function NetworkDiagram() {
	return (
		<figure className="diagram">
			<svg
				role="img"
				aria-label="How delphi-p2p works: an author hashes a directory and publishes a signed claim to the peer-to-peer network; a mirror peer holds the snapshot; a verifier fetches the snapshot by hash, checks the Lean proof in a sandbox, and signs a verdict; an optional one-way bridge mirrors metadata to delphi.science."
				viewBox="0 0 760 318"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<marker id="p2p-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
						<path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</marker>
					<marker id="p2p-arrow-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
						<path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</marker>
				</defs>

				{/* Author box */}
				<rect x="14" y="48" width="174" height="146" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="28" y="72" fontSize="13" fontWeight="600" fill="var(--ink)">Author (Key A)</text>
				<rect x="28" y="84" width="146" height="38" rx="5" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="38" y="101" fontSize="11" fontWeight="500" fill="var(--ink)">Project directory</text>
				<text x="38" y="115" fontSize="9.8" fontFamily="var(--mono)" fill="var(--muted)">Proof.lean, lakefile</text>
				<line x1="101" y1="122" x2="101" y2="137" stroke="var(--muted)" strokeWidth="1.3" markerEnd="url(#p2p-arrow)" />
				<rect x="28" y="141" width="146" height="40" rx="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.2" />
				<text x="38" y="158" fontSize="10.5" fontFamily="var(--mono)" fontWeight="600" fill="var(--accent)">hash 8f3a…</text>
				<text x="38" y="173" fontSize="10" fill="var(--muted)">signed publish claim</text>

				{/* Dashed P2P network container */}
				<rect x="242" y="14" width="504" height="196" rx="10" fill="none" stroke="var(--subtle)" strokeWidth="1.2" strokeDasharray="5 4" />
				<text x="258" y="34" fontSize="11" fontWeight="600" fill="var(--muted)">PEER-TO-PEER NETWORK (NO CENTRAL SERVER)</text>

				{/* Arrow: Author -> Mirror */}
				<line x1="188" y1="121" x2="256" y2="121" stroke="var(--muted)" strokeWidth="1.4" markerEnd="url(#p2p-arrow)" />
				<text x="215" y="112" textAnchor="middle" fontSize="10.5" fill="var(--muted)">publish</text>

				{/* Mirror peer */}
				<rect x="260" y="48" width="186" height="146" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="274" y="72" fontSize="13" fontWeight="600" fill="var(--ink)">Mirror peer</text>
				<text x="274" y="89" fontSize="9.8" fontFamily="var(--mono)" fill="var(--muted)">delphi-p2p serve --mirror</text>
				<rect x="274" y="104" width="158" height="32" rx="5" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="284" y="124" fontSize="10.8" fill="var(--ink)">Holds snapshot <tspan fontFamily="var(--mono)" fill="var(--accent)">8f3a…</tspan></text>
				<rect x="274" y="145" width="158" height="32" rx="5" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="284" y="165" fontSize="10.8" fill="var(--muted)">Syncs signed claims</text>

				{/* Arrows: Mirror <-> Verifier */}
				<line x1="446" y1="96" x2="518" y2="96" stroke="var(--muted)" strokeWidth="1.4" markerEnd="url(#p2p-arrow)" />
				<text x="482" y="87" textAnchor="middle" fontSize="10" fill="var(--muted)">fetch 8f3a…</text>
				<line x1="518" y1="154" x2="446" y2="154" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#p2p-arrow-accent)" />
				<text x="482" y="172" textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--accent)">check: pass ✓</text>

				{/* Verifier peer */}
				<rect x="522" y="48" width="208" height="146" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="536" y="72" fontSize="13" fontWeight="600" fill="var(--ink)">Verifier (Key B)</text>
				<text x="536" y="89" fontSize="9.8" fontFamily="var(--mono)" fill="var(--muted)">delphi-p2p check</text>
				<rect x="536" y="103" width="180" height="46" rx="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3 2" />
				<text x="546" y="122" fontSize="11" fontWeight="600" fill="var(--ink)">Sandbox (no network)</text>
				<text x="546" y="139" fontSize="9.8" fontFamily="var(--mono)" fill="var(--muted)">lake check · Lean kernel</text>
				<text x="536" y="173" fontSize="10.5" fontWeight="500" fill="var(--accent)">Signs verdict for hash 8f3a…</text>

				{/* Optional bridge down to delphi.science */}
				<line x1="353" y1="194" x2="353" y2="243" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#p2p-arrow)" />
				<text x="366" y="232" fontSize="10.5" fill="var(--muted)">optional bridge: claims &amp; file lists only (files stay on peers)</text>

				{/* delphi.science box */}
				<rect x="260" y="247" width="470" height="58" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="276" y="270" fontSize="12.5" fontWeight="600" fill="var(--ink)">Delphi.science record page</text>
				<rect x="598" y="255" width="116" height="22" rx="11" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1" />
				<text x="656" y="269.5" textAnchor="middle" fontSize="10.5" fontWeight="500" fill="var(--accent)">Files and checks</text>
				<text x="276" y="291" fontSize="10.8" fill="var(--muted)">Displays versions, file diffs, holder counts, and signed checks (optional mirror).</text>
			</svg>
			<figcaption>Files and signed claims move directly between peers. Delphi.science is an optional read-only mirror of claim metadata and file lists.</figcaption>
		</figure>
	);
}

export function VersioningDiagram() {
	return (
		<figure className="diagram">
			<svg
				role="img"
				aria-label="Versioning and forks in delphi-p2p: Key A publishes v1 with 2 passing checks, then publishes v2 which becomes current and starts at 0 checks. Key B edits v1 to publish a fork with 1 passing check; the fork never replaces Key A's current version."
				viewBox="0 0 760 220"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<marker id="ver-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
						<path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</marker>
				</defs>

				{/* Track labels */}
				<text x="16" y="62" fontSize="12" fontWeight="600" fill="var(--ink)">Original author</text>
				<text x="16" y="79" fontSize="10.5" fontFamily="var(--mono)" fill="var(--muted)">Key A</text>

				<text x="16" y="160" fontSize="12" fontWeight="600" fill="var(--ink)">Another peer</text>
				<text x="16" y="177" fontSize="10.5" fontFamily="var(--mono)" fill="var(--muted)">Key B</text>

				{/* v1 card */}
				<rect x="136" y="24" width="234" height="82" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="150" y="47" fontSize="12.5" fontWeight="600" fill="var(--ink)">v1</text>
				<rect x="172" y="34" width="52" height="19" rx="9.5" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="198" y="47" textAnchor="middle" fontSize="10" fill="var(--muted)">earlier</text>
				<text x="356" y="47" textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--subtle)">8f3a…</text>
				<text x="150" y="69" fontSize="11" fill="var(--muted)">Initial Lean proof</text>
				<text x="150" y="92" fontSize="11" fontWeight="600" fill="var(--accent)">✓ 2 pass <tspan fontWeight="400" fill="var(--muted)">· signed by Keys B, C</tspan></text>

				{/* Arrow v1 -> v2 */}
				<line x1="370" y1="65" x2="462" y2="65" stroke="var(--muted)" strokeWidth="1.4" markerEnd="url(#ver-arrow)" />
				<text x="416" y="56" textAnchor="middle" fontSize="10.5" fill="var(--muted)">new version</text>
				<text x="416" y="81" textAnchor="middle" fontSize="10" fill="var(--subtle)">same key</text>

				{/* v2 card (current) */}
				<rect x="466" y="24" width="278" height="82" rx="8" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.6" />
				<text x="480" y="47" fontSize="12.5" fontWeight="600" fill="var(--ink)">v2</text>
				<rect x="502" y="34" width="54" height="19" rx="9.5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1" />
				<text x="529" y="47" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--accent)">current</text>
				<text x="730" y="47" textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--subtle)">c41b…</text>
				<text x="480" y="69" fontSize="11" fill="var(--muted)">Shortened proof of Lemma 2</text>
				<text x="480" y="92" fontSize="11" fontWeight="500" fill="var(--muted)">0 checks <tspan fontWeight="400">· new hash starts at zero</tspan></text>

				{/* Branch arrow v1 -> fork */}
				<path d="M 253 106 V 157 Q 253 165 261 165 H 462" fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="4 3" markerEnd="url(#ver-arrow)" />
				<text x="362" y="155" textAnchor="middle" fontSize="10.5" fill="var(--muted)">edits v1 (different key)</text>

				{/* Fork card */}
				<rect x="466" y="124" width="278" height="82" rx="8" fill="var(--surface)" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" />
				<text x="480" y="147" fontSize="12.5" fontWeight="600" fill="var(--ink)">v1b</text>
				<rect x="510" y="134" width="40" height="19" rx="9.5" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="530" y="147" textAnchor="middle" fontSize="10" fill="var(--muted)">fork</text>
				<text x="730" y="147" textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--subtle)">9e02…</text>
				<text x="480" y="169" fontSize="11" fill="var(--muted)">Alternative proof without helper lemma</text>
				<text x="480" y="192" fontSize="11" fontWeight="600" fill="var(--accent)">✓ 1 pass <tspan fontWeight="400" fill="var(--muted)">· never replaces Key A’s v2</tspan></text>
			</svg>
			<figcaption>Check verdicts bind to one exact snapshot hash and count once per signing key. Forks stay visible beside the original without replacing it.</figcaption>
		</figure>
	);
}
