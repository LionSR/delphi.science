// Diagrams for /p2p: peer-to-peer architecture and version/fork/check semantics.
// Styled with the site's CSS custom properties so they adapt automatically to light and dark mode.

export function NetworkDiagram() {
	return (
		<figure className="diagram">
			<svg
				role="img"
				aria-label="Decentralized peer-to-peer mesh in delphi-p2p: four independent peers (author, mirror, and two verifiers) exchange files and signed claims directly with each other with no central server. Delphi.science and any other website sit outside the mesh as optional one-way mirrors of claim metadata."
				viewBox="0 0 760 344"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<marker id="p2p-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
						<path d="M1 1.5L8.5 5L1 8.5" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</marker>
				</defs>

				{/* Dashed P2P mesh container */}
				<rect x="14" y="12" width="526" height="320" rx="10" fill="none" stroke="var(--subtle)" strokeWidth="1.2" strokeDasharray="5 4" />
				<text x="30" y="33" fontSize="11" fontWeight="600" fill="var(--muted)">PEER-TO-PEER MESH (NO CENTRAL SERVER)</text>

				{/* Diagonal mesh connections (behind cards & center pill) */}
				<line x1="232" y1="146" x2="324" y2="220" stroke="var(--rule)" strokeWidth="1.3" strokeDasharray="3 3" />
				<line x1="232" y1="220" x2="324" y2="146" stroke="var(--rule)" strokeWidth="1.3" strokeDasharray="3 3" />
				<rect x="242" y="173" width="72" height="20" rx="10" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="278" y="186.5" textAnchor="middle" fontSize="9.8" fill="var(--muted)">peer mesh</text>

				{/* Top horizontal bidirectional: Peer A <-> Peer B */}
				<line x1="236" y1="103" x2="320" y2="103" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<text x="278" y="94" textAnchor="middle" fontSize="9.8" fill="var(--muted)">files + claims</text>

				{/* Bottom horizontal bidirectional: Peer C <-> Peer D */}
				<line x1="236" y1="263" x2="320" y2="263" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<text x="278" y="279" textAnchor="middle" fontSize="9.8" fill="var(--muted)">files + claims</text>

				{/* Left vertical bidirectional: Peer A <-> Peer C */}
				<line x1="131" y1="164" x2="131" y2="204" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<text x="140" y="188" fontSize="9.8" fill="var(--muted)">mirror + sync</text>

				{/* Right vertical bidirectional: Peer B <-> Peer D */}
				<line x1="425" y1="164" x2="425" y2="204" stroke="var(--muted)" strokeWidth="1.3" markerStart="url(#p2p-arrow)" markerEnd="url(#p2p-arrow)" />
				<text x="434" y="188" fontSize="9.8" fill="var(--muted)">claims + files</text>

				{/* Peer A (Author) */}
				<rect x="30" y="48" width="202" height="112" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="42" y="70" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer A</text>
				<rect x="88" y="57" width="46" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="111" y="69.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">author</text>
				<text x="220" y="70" textAnchor="end" fontSize="9.8" fontFamily="var(--mono)" fill="var(--subtle)">Key A</text>
				<text x="42" y="94" fontSize="10.8" fill="var(--ink)">Hashes files → <tspan fontFamily="var(--mono)" fontWeight="600" fill="var(--accent)">8f3a…</tspan></text>
				<text x="42" y="114" fontSize="10.5" fill="var(--muted)">Signs publish claim</text>
				<text x="42" y="144" fontSize="9.8" fill="var(--subtle)">Can go offline once mirrored</text>

				{/* Peer B (Verifier) */}
				<rect x="324" y="48" width="202" height="112" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="336" y="70" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer B</text>
				<rect x="382" y="57" width="50" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="407" y="69.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">verifier</text>
				<text x="514" y="70" textAnchor="end" fontSize="9.8" fontFamily="var(--mono)" fill="var(--subtle)">Key B</text>
				<text x="336" y="92" fontSize="10.5" fill="var(--muted)">Fetches <tspan fontFamily="var(--mono)" fill="var(--ink)">8f3a…</tspan> by hash</text>
				<rect x="336" y="101" width="178" height="24" rx="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.1" strokeDasharray="3 2" />
				<text x="425" y="116.5" textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--ink)">Sandbox · lake check</text>
				<text x="336" y="146" fontSize="10.5" fontWeight="600" fill="var(--accent)">Signs check: pass ✓</text>

				{/* Peer C (Mirror) */}
				<rect x="30" y="208" width="202" height="112" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="42" y="230" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer C</text>
				<rect x="88" y="217" width="44" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="110" y="229.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">mirror</text>
				<text x="220" y="230" textAnchor="end" fontSize="9.8" fontFamily="var(--mono)" fill="var(--subtle)">Key C</text>
				<text x="42" y="254" fontSize="10.8" fill="var(--ink)">Holds snapshot <tspan fontFamily="var(--mono)" fill="var(--accent)">8f3a…</tspan></text>
				<text x="42" y="274" fontSize="10.5" fill="var(--muted)">Syncs all signed claims</text>
				<text x="42" y="304" fontSize="9.8" fill="var(--subtle)">Serves peers if A is offline</text>

				{/* Peer D (Verifier) */}
				<rect x="324" y="208" width="202" height="112" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="336" y="230" fontSize="12.5" fontWeight="600" fill="var(--ink)">Peer D</text>
				<rect x="382" y="217" width="50" height="18" rx="9" fill="var(--bg)" stroke="var(--rule)" strokeWidth="1" />
				<text x="407" y="229.5" textAnchor="middle" fontSize="9.6" fill="var(--muted)">verifier</text>
				<text x="514" y="230" textAnchor="end" fontSize="9.8" fontFamily="var(--mono)" fill="var(--subtle)">Key D</text>
				<text x="336" y="252" fontSize="10.5" fill="var(--muted)">Fetches <tspan fontFamily="var(--mono)" fill="var(--ink)">8f3a…</tspan> from B or C</text>
				<rect x="336" y="261" width="178" height="24" rx="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.1" strokeDasharray="3 2" />
				<text x="425" y="276.5" textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--ink)">Sandbox · lake check</text>
				<text x="336" y="306" fontSize="10.5" fontWeight="600" fill="var(--accent)">Signs check: pass ✓</text>

				{/* Optional one-way bridges to independent websites */}
				<line x1="526" y1="104" x2="584" y2="104" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#p2p-arrow)" />
				<text x="564" y="95" textAnchor="middle" fontSize="9.5" fill="var(--muted)">bridge</text>

				<rect x="588" y="56" width="158" height="96" rx="8" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1.3" />
				<text x="600" y="79" fontSize="12" fontWeight="600" fill="var(--ink)">Delphi.science</text>
				<rect x="600" y="88" width="90" height="18" rx="9" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1" />
				<text x="645" y="100.5" textAnchor="middle" fontSize="9.5" fontWeight="500" fill="var(--accent)">optional viewer</text>
				<text x="600" y="123" fontSize="10.2" fill="var(--muted)">Shows Files and checks</text>
				<text x="600" y="139" fontSize="9.8" fill="var(--subtle)">Files stay on peers</text>

				<text x="667" y="179" textAnchor="middle" fontSize="9.8" fill="var(--muted)">Websites are optional;</text>
				<text x="667" y="193" textAnchor="middle" fontSize="9.8" fill="var(--muted)">peers work without them</text>

				<line x1="526" y1="264" x2="584" y2="264" stroke="var(--subtle)" strokeWidth="1.3" strokeDasharray="4 3" markerEnd="url(#p2p-arrow)" />
				<text x="564" y="255" textAnchor="middle" fontSize="9.5" fill="var(--muted)">bridge</text>

				<rect x="588" y="216" width="158" height="96" rx="8" fill="var(--bg)" stroke="var(--subtle)" strokeWidth="1.2" strokeDasharray="4 3" />
				<text x="600" y="239" fontSize="12" fontWeight="600" fill="var(--ink)">Any other site</text>
				<rect x="600" y="248" width="90" height="18" rx="9" fill="var(--surface)" stroke="var(--rule)" strokeWidth="1" />
				<text x="645" y="260.5" textAnchor="middle" fontSize="9.5" fill="var(--muted)">optional viewer</text>
				<text x="600" y="283" fontSize="10.2" fill="var(--muted)">Runs its own bridge</text>
				<text x="600" y="299" fontSize="9.8" fill="var(--subtle)">Reads the same claims</text>
			</svg>
			<figcaption>Peers exchange files and signed claims directly in a mesh with no central server. Delphi.science and any other site are optional one-way mirrors of claim metadata.</figcaption>
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
