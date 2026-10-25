// Who runs the site and how to reach them, in one place: /privacy, /support, /llms.txt and the API read it.
// owner: confirm the name, and set SUPPORT_EMAIL to an address you read before /privacy and /support are
// relied on. The repository is private, so its issues are not a public contact; set ISSUES_PUBLIC to
// true if it becomes public.
export const OPERATOR = 'Sirui Lu';
export const SUPPORT_EMAIL = '';
export const ISSUES = 'https://github.com/lionsr/open-research-index/issues';
export const ISSUES_PUBLIC = false;

/** How to write to us, as text: the address, or a marked placeholder until the owner adds one. */
export const SUPPORT = SUPPORT_EMAIL || '[support email: the owner adds it in site/lib/contact.ts]';
