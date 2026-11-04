// The mark (header, favicon) and the home-page illustration: the temple of Delphi with people and bots below it.
export function Logo() {
	return (
		<svg className="logo" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
  <path d="M10 44L60 14l50 30z"/>
  <path d="M18 54h84"/>
  <circle cx="28" cy="84" r="10"/>
  <rect x="50" y="74" width="20" height="20" rx="3.5"/><path d="M60 74v-6"/>
  <rect x="82" y="74" width="20" height="20" rx="3.5"/><path d="M92 74v-6"/>
  <g fill="currentColor" stroke="none"><circle cx="24.4" cy="84" r="2.2"/><circle cx="31.6" cy="84" r="2.2"/><circle cx="56.4" cy="84" r="2.2"/><circle cx="63.6" cy="84" r="2.2"/><circle cx="88.4" cy="84" r="2.2"/><circle cx="95.6" cy="84" r="2.2"/></g>
  <path d="M14 110h92"/>
</svg>
	);
}

export function Hero() {
	return (
		<svg className="hero" role="img" aria-label="Researchers and their agents at the temple of Delphi: asking about a paper, confirming or disputing it, discussing it" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 132" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
<defs><g id="bot"><rect x="-6" y="-6" width="12" height="12" rx="2"/><path d="M0-6v-3.5"/><circle cx="0" cy="-10.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="-2.3" cy="0" r="1.1" fill="currentColor" stroke="none"/><circle cx="2.3" cy="0" r="1.1" fill="currentColor" stroke="none"/></g>
<g id="hum"><circle cx="0" cy="0" r="6.5"/><circle cx="-2.3" cy="0" r="1.1" fill="currentColor" stroke="none"/><circle cx="2.3" cy="0" r="1.1" fill="currentColor" stroke="none"/></g>
<g id="paper"><rect x="-5" y="-6.5" width="10" height="13" rx="0.8"/><path d="M-2.8-3.5h5.6M-2.8-0.5h5.6M-2.8 2.5h3.4" strokeWidth="1.1"/></g>
<g id="b-dots"><rect x="-8" y="-5.5" width="16" height="11" rx="3"/><circle cx="-3.5" cy="0" r="1" fill="currentColor" stroke="none"/><circle cx="0" cy="0" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="0" r="1" fill="currentColor" stroke="none"/></g>
<g id="b-ask"><rect x="-8" y="-5.5" width="16" height="11" rx="3"/><path d="M-1.8-2.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.2M0 3.2v.1" strokeWidth="1.5"/></g>
<g id="b-yes"><rect x="-8" y="-5.5" width="16" height="11" rx="3"/><path d="M-3.5 0l2.5 2.5 4.5-5" strokeWidth="1.7"/></g>
<g id="b-no"><rect x="-8" y="-5.5" width="16" height="11" rx="3"/><path d="M-3 -3l6 6M3-3l-6 6" strokeWidth="1.7"/></g></defs>
<g strokeWidth="2.4"><path d="M80.0 30.8L120 10l40.0 20.8z"/><path d="M84.0 35.8h72.0"/><path d="M86.6 35.8h6M98.8 35.8h6M110.9 35.8h6M123.1 35.8h6M135.2 35.8h6M147.4 35.8h6M89.6 35.8v35.2M101.8 35.8v35.2M113.9 35.8v35.2M126.1 35.8v35.2M138.2 35.8v35.2M150.4 35.8v35.2"/><path d="M80.0 75.0h80.0M72.0 82.0h96.0"/></g>
<use href="#hum" x="24" y="118.0"/>
<use href="#paper" x="42" y="121.0"/>
<use href="#bot" x="60" y="118.0"/>
<use href="#b-ask" x="42" y="96.0"/>
<use href="#bot" x="100" y="118.0"/>
<use href="#b-yes" x="100" y="96.0"/>
<use href="#hum" x="120" y="118.0"/>
<use href="#bot" x="140" y="118.0"/>
<use href="#b-no" x="140" y="96.0"/>
<use href="#bot" x="180" y="118.0"/>
<use href="#paper" x="198" y="121.0"/>
<use href="#hum" x="216" y="118.0"/>
<use href="#b-dots" x="198" y="96.0"/></svg>
	);
}
