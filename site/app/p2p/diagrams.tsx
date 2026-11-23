// Diagrams for /p2p: decentralized peer mesh and version/fork/check rules.
// Uses site CSS custom properties so both diagrams adapt to light and dark mode.

export function NetworkDiagram() {
	return (
		<figure className="diagram">
			<svg
				role="img"
				aria-label="Decentralized peer-to-peer mesh: four peers (author, mirror, and two verifiers) exchange files and signed claims directly with no central server. Delphi.science and any other website are optional one-way viewers outside the mesh."
				viewBox="0 0 740 248"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<marker id="p2p-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
						<path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</marker>
				</defs>

				{/* P2P mesh container */}
				<rect x="12" y="10" width="510" height="228" rx="10" fill="none" stroke="var(--subtle)" strokeWidth="1.2" strokeDasharray="5 4" />
				<text x="28" y="30" fontSize="10.5" fontWeight="600" fill="var(--muted)">PEER-TO-PEER MESH</text>

				{/* Crossing mesh diagonals */}
				<line x1="202" y1="104" x2="332" y2="164" stroke="var(--rule)" strokeWidth="1.3" strokeDasharray="3 3" />
				<line x1="202" y1="164" x2="332" y2="104" stroke="var(--rule)" strokeWidth="1.3" strokeDasharray="3 3" />
				<rect x="223" y="124" width="88" height="20" rx="10" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="267" y="137.5" textAnchor="middle" fontSize="9.8" fill="var(--muted)">files + claims</text>

				{/* Mesh edges */}
				<line x1="206" y1="78" x2="328" y2="78" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<line x1="206" y1="190" x2="328" y2="190" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<line x1="115" y1="114" x2="115" y2="154" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<line x1="419" y1="114" x2="419" y2="154" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />

				{/* Peer A */}
				<rect x="28" y="46" width="174" height="64" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="40" y="69" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer A</text>
				<rect x="142" y="56" width="48" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="166" y="68.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">author</text>
				<text x="40" y="94" fontSize="10.8" fill="var(--muted)">publish <tspan fontFamily="var(--mono)" fontWeight="600" fill="var(--accent)">8f3a…</tspan></text>

				{/* Peer B */}
				<rect x="332" y="46" width="174" height="64" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="344" y="69" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer B</text>
				<rect x="444" y="56" width="50" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="469" y="68.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">verifier</text>
				<text x="344" y="94" fontSize="10.8" fill="var(--muted)">sandbox → <tspan fontWeight="600" fill="var(--accent)">pass ✓</tspan></text>

				{/* Peer C */}
				<rect x="28" y="158" width="174" height="64" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="40" y="181" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer C</text>
				<rect x="144" y="168" width="46" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="167" y="180.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">mirror</text>
				<text x="40" y="206" fontSize="10.8" fill="var(--muted)">holds <tspan fontFamily="var(--mono)" fill="var(--ink)">8f3a…</tspan></text>

				{/* Peer D */}
				<rect x="332" y="158" width="174" height="64" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="344" y="181" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer D</text>
				<rect x="444" y="168" width="50" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="469" y="180.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">verifier</text>
				<text x="344" y="206" fontSize="10.8" fill="var(--muted)">sandbox → <tspan fontWeight="600" fill="var(--accent)">pass ✓</tspan></text>

				{/* Optional bridges outside mesh */}
				<line x1="506" y1="78" x2="574" y2="78" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#p2p-arrow)" />
				<text x="548" y="69" textAnchor="middle" fontSize="9.5" fill="var(--muted)">bridge</text>

				<rect x="578" y="48" width="150" height="60" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="592" y="72" fontSize="12" fontWeight="600" fill="var(--ink)">Delphi.science</text>
				<text x="592" y="93" fontSize="10.2" fill="var(--accent)">optional viewer</text>

				<line x1="506" y1="190" x2="574" y2="190" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#p2p-arrow)" />
				<text x="548" y="181" textAnchor="middle" fontSize="9.5" fill="var(--muted)">bridge</text>

				<rect x="578" y="160" width="150" height="60" rx="8" fill="var(--bg)" stroke="var(--subtle)" strokeWidth="1.2" strokeDasharray="4 3" />
				<text x="592" y="184" fontSize="12" fontWeight="600" fill="var(--ink)">Any other site</text>
				<text x="592" y="205" fontSize="10.2" fill="var(--muted)">optional viewer</text>
			</svg>
			<figcaption>Peers sync files and signed claims directly with no central server. Websites are optional one-way viewers.</figcaption>
		</figure>
	);
}

export function VersioningDiagram() {
	return (
		<figure className="diagram">
			<svg
				role="img"
				aria-label="Versions and forks: Key A publishes v1 (earlier, 2 pass) then v2 (current, 0 checks). Key B edits v1 to publish v1b (fork, 1 pass), which does not replace v2."
				viewBox="0 0 740 168"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<marker id="ver-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
						<path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</marker>
				</defs>

				{/* Row labels */}
				<text x="16" y="48" fontSize="11.5" fontWeight="600" fill="var(--ink)">Author</text>
				<text x="16" y="64" fontSize="10" fontFamily="var(--mono)" fill="var(--muted)">Key A</text>

				<text x="16" y="126" fontSize="11.5" fontWeight="600" fill="var(--ink)">Other peer</text>
				<text x="16" y="142" fontSize="10" fontFamily="var(--mono)" fill="var(--muted)">Key B</text>

				{/* v1 */}
				<rect x="116" y="18" width="210" height="60" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="130" y="40" fontSize="12.5" fontWeight="600" fill="var(--ink)">v1</text>
				<rect x="152" y="27" width="48" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="176" y="39.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">earlier</text>
				<text x="312" y="40" textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--subtle)">8f3a…</text>
				<text x="130" y="65" fontSize="11" fontWeight="600" fill="var(--accent)">✓ 2 pass</text>

				{/* Arrow v1 -> v2 */}
				<line x1="326" y1="48" x2="432" y2="48" stroke="var(--muted)" strokeWidth="1.4" markerEnd="url(#ver-arrow)" />
				<text x="379" y="39" textAnchor="middle" fontSize="10" fill="var(--muted)">same key</text>

				{/* v2 */}
				<rect x="436" y="18" width="286" height="60" rx="8" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.6" />
				<text x="450" y="40" fontSize="12.5" fontWeight="600" fill="var(--ink)">v2</text>
				<rect x="472" y="27" width="52" height="18" rx="9" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1" />
				<text x="498" y="39.5" textAnchor="middle" fontSize="9.6" fontWeight="600" fill="var(--accent)">current</text>
				<text x="708" y="40" textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--subtle)">c41b…</text>
				<text x="450" y="65" fontSize="11" fill="var(--muted)">0 checks (new hash)</text>

				{/* Branch v1 -> fork */}
				<path d="M 221 78 V 120 Q 221 128 229 128 H 432" fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="4 3" markerEnd="url(#ver-arrow)" />
				<text x="330" y="119" textAnchor="middle" fontSize="10" fill="var(--muted)">different key</text>

				{/* v1b fork */}
				<rect x="436" y="96" width="286" height="60" rx="8" fill="var(--surface)" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" />
				<text x="450" y="118" fontSize="12.5" fontWeight="600" fill="var(--ink)">v1b</text>
				<rect x="480" y="105" width="38" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="499" y="117.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">fork</text>
				<text x="708" y="118" textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--subtle)">9e02…</text>
				<text x="450" y="143" fontSize="11" fontWeight="600" fill="var(--accent)">✓ 1 pass <tspan fontWeight="400" fill="var(--muted)">· does not replace v2</tspan></text>
			</svg>
			<figcaption>Each check applies to one snapshot hash and counts once per key. Forks do not replace the current version.</figcaption>
		</figure>
	);
}
