// Text in a box with a Copy button. The text is rendered once, on the server; the button copies it from the page.
import { CopyButton } from './copy-button.tsx';

export function CopyBlock({ text, label }: { text: string; label?: string }) {
	return (
		<div className="copy-block">
			<pre>{text}</pre>
			<CopyButton label={label} />
		</div>
	);
}
