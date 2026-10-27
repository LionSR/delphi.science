// Forum bodies are untrusted Markdown. Sanitize the input tree before trusted MathJax SVG output.
// No raw HTML, remote images, TeX HTML/URL extensions, autoload or author-triggered package loading.
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeMathjax from 'rehype-mathjax/svg';
import { unified } from 'unified';

type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; data?: Record<string, unknown>; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
type Prepared = { markdown: string; tokens: { marker: string; value: string; display: boolean }[] };

/** Preserve MathJax's existing backslash delimiters without changing code, URLs or escaped backslashes. */
function prepareMath(text: string): Prepared {
	const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(text) as Node;
	const protectedRanges: [number, number][] = [];
	function visit(node: Node) {
		const start = node.position?.start.offset, end = node.position?.end.offset;
		if (start !== undefined && end !== undefined) {
			if (['code', 'inlineCode', 'html', 'definition', 'image', 'imageReference', 'math', 'inlineMath'].includes(node.type)) {
				protectedRanges.push([start, end]); return;
			}
			if (node.type === 'link' || node.type === 'linkReference') {
				const raw = text.slice(start, end);
				if (!raw.startsWith('[')) { protectedRanges.push([start, end]); return; }
				const labelEnd = node.children?.at(-1)?.position?.end.offset;
				if (labelEnd !== undefined) protectedRanges.push([labelEnd, end]);
			}
		}
		for (const child of node.children ?? []) visit(child);
	}
	visit(tree);
	const protectedAt = (at: number) => protectedRanges.some(([start, end]) => start <= at && at < end);
	const escaped = (at: number) => {
		let count = 0;
		while (at > 0 && text[--at] === '\\') count++;
		return count % 2 === 1;
	};
	let out = '', prefix = 'ORIbackslashMathToken';
	while (text.includes(prefix)) prefix += 'Z';
	const tokens: Prepared['tokens'] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '\\' || escaped(i) || protectedAt(i) || !['(', '['].includes(text[i + 1])) { out += text[i]; continue; }
		const display = text[i + 1] === '[', close = display ? ']' : ')';
		let end = i + 2;
		for (; end < text.length; end++) if (text[end] === '\\' && text[end + 1] === close && !escaped(end) && !protectedAt(end)) break;
		if (end === text.length || protectedRanges.some(([start]) => i < start && start < end)) { out += text[i]; continue; }
		const math = text.slice(i + 2, end);
		const marker = `${prefix}${tokens.length}END`;
		tokens.push({ marker, value: math, display });
		out += marker;
		i = end + 1;
	}
	return { markdown: out, tokens };
}

export const mathDelimiters = (text: string) => prepareMath(text).markdown;

/** Restore AST nodes rather than dollar strings: TeX dollars and Markdown list/quote containers stay intact. */
function restoreBackslashMath(prepared: Prepared) {
	return (tree: Node) => {
		if (!prepared.tokens.length) return;
		const tokenPattern = new RegExp(prepared.tokens.map((t) => t.marker).join('|'), 'g');
		const byMarker = new Map(prepared.tokens.map((t) => [t.marker, t]));
		function mathNode(value: string, display: boolean): Node {
			const code = { type: 'element', tagName: 'code', properties: { className: ['language-math', display ? 'math-display' : 'math-inline'] }, children: [{ type: 'text', value }] };
			return { type: display ? 'math' : 'inlineMath', value, data: display ? { hName: 'pre', hChildren: [code] }
				: { hName: 'code', hProperties: code.properties, hChildren: code.children } };
		}
		function walk(parent: Node) {
			if (!parent.children) return;
			parent.children = parent.children.flatMap((child): Node[] => {
				if (child.type !== 'text' || !child.value) { walk(child); return [child]; }
				const parts: Node[] = []; let at = 0;
				for (const match of child.value.matchAll(tokenPattern)) {
					if (match.index > at) parts.push({ type: 'text', value: child.value.slice(at, match.index) });
					const token = byMarker.get(match[0])!;
					parts.push(mathNode(token.value, token.display && parent.type === 'paragraph'));
					at = match.index + match[0].length;
				}
				if (!parts.length) return [child];
				if (at < child.value.length) parts.push({ type: 'text', value: child.value.slice(at) });
				return parts;
			});
			parent.children = parent.children.flatMap((child): Node[] => {
				if (child.type !== 'paragraph' || !child.children?.some((n) => n.type === 'math')) return [child];
				const blocks: Node[] = []; let inline: Node[] = [];
				for (const node of child.children) {
					if (node.type === 'math') { if (inline.length) blocks.push({ type: 'paragraph', children: inline }); blocks.push(node); inline = []; }
					else inline.push(node);
				}
				if (inline.length) blocks.push({ type: 'paragraph', children: inline });
				return blocks;
			});
		}
		walk(tree);
	};
}

/** TeX tags/eqref must resolve within this post, never to an identically tagged equation in another post. */
function namespaceMathIds(namespace: string) {
	return (tree: Node) => {
		const hex = (value: string) => Array.from(new TextEncoder().encode(value), (b) => b.toString(16).padStart(2, '0')).join('');
		const prefix = `ori-math-${hex(namespace)}-`, ids = new Map<string, string>();
		function visit(node: Node, inside: boolean, action: (node: Node) => void) {
			const math = inside || node.tagName === 'mjx-container';
			if (math) action(node);
			for (const child of node.children ?? []) visit(child, math, action);
		}
		visit(tree, false, (node) => { const id = node.properties?.id; if (typeof id === 'string') ids.set(id, prefix + hex(id)); });
		visit(tree, false, (node) => {
			const props = node.properties;
			if (!props) return;
			if (typeof props.id === 'string') props.id = ids.get(props.id)!;
			for (const name of ['href', 'xLinkHref']) {
				const value = props[name];
				if (typeof value !== 'string' || !value.startsWith('#')) continue;
				let id = value.slice(1); try { id = decodeURIComponent(id); } catch { /* malformed ref stays local */ }
				props[name] = `#${ids.get(id) ?? `${prefix}unresolved-${hex(id)}`}`;
			}
		});
	};
}

const sanitize = {
	...defaultSchema,
	attributes: {
		...defaultSchema.attributes,
		code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'math-inline', 'math-display']],
	},
};

const mathjax = {
	tex: {
		packages: ['base', 'ams', 'newcommand', 'noerrors', 'noundefined'],
		maxMacros: 1000, maxBuffer: 8192, tags: 'none', useLabelIds: false,
		processRefs: false, processEnvironments: false,
	},
	svg: { fontCache: 'none' },
};

export function Markdown({ text, postId }: { text: string; postId: number }) {
	const prepared = prepareMath(text);
	return createElement('div', { className: 'markdown tex2jax_ignore' }, createElement(ReactMarkdown, {
		skipHtml: true,
		remarkPlugins: [remarkGfm, remarkMath, [restoreBackslashMath, prepared]],
		rehypePlugins: [[rehypeSanitize, sanitize], [rehypeMathjax, mathjax], [namespaceMathIds, String(postId)]],
		components: {
			// Images were previously plaintext. Keep their useful link/alt text without third-party tracking fetches.
			img: ({ src, alt }) => typeof src === 'string' && src ? createElement('a', { href: src, rel: 'noopener noreferrer' }, alt || 'Image') : createElement('span', null, alt),
		},
	}, prepared.markdown));
}
