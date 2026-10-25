# Testing the Open Research Index plugin

The plugin connects ChatGPT and Codex to the index's MCP server at `https://open-research-index.vercel.app/mcp`
(Streamable HTTP, read-only, no sign-in). It has three tools, all marked `readOnlyHint: true`,
`destructiveHint: false`, `openWorldHint: false`:

- `search_records`: arXiv-style query (`ti:`, `au:`, `abs:`, `cat:`, `source:`, `is:`, `published:`), sort, limit, cursor. Returns one page of records with the number of expert responses each has (`discussed`).
- `get_record`: one record by id (`<prefix>/<suffix>`), with `discussion[]` (author, date, quote, url of each response) and `discusses[]` (the records it responds to).
- `list_discussed_records`: the records that have responses, newest response first, each with its latest response.

No account, key or test credentials are needed. The records named below were in the index on 2026-10-25;
the index only grows, so later answers may list more responses.

## Test cases

1. **What did mathematicians say about OpenAI's quasi-Riemann hypothesis paper?**
   - Expected tools: `search_records` (e.g. `query: "ti:\"quasi-Riemann\" source:openai-math"`), then `get_record` with `id: "openai-math/The-Quasi-Riemann-Hypothesis"` (and possibly the alternate proof, `openai-math/The-Quasi-Riemann-Hypothesis-October-5-2026__paper2`).
   - Expected answer: quotes responses with their authors, dates and links, e.g. Alex Kontorovich on X (2026-10-06), Pace Nielsen on MathOverflow (2026-10-08), Terence Tao's blog post sketching the proof (2026-10-19), and arXiv papers that build on it (Baiying Liu, arXiv 2610.12234).

2. **Which AI-generated papers got expert responses most recently?**
   - Expected tools: `list_discussed_records` (optionally `query: "is:ai-generated"`).
   - Expected answer: a list of records, newest response first, each with its latest response's author, date and link.

3. **Has anyone checked OpenAI's matrix multiplication exponent paper?**
   - Expected tools: `search_records` (e.g. `query: "ti:\"matrix multiplication\" source:openai-math"`), then `get_record` with `id: "openai-math/Matrix-Multiplication-Nine-Fourths"`.
   - Expected answer: the responses, e.g. Scott Aaronson's and Gil Kalai's blog posts (2026-10-07) and the arXiv paper "Multiplying matrices via polynomials: exposition and barrier" by Amanov, van den Berg and Zuiddam (2026-10-21), with links.

4. **Which arXiv papers respond to OpenAI's proof that Landau–Siegel zeros do not exist?**
   - Expected tools: `search_records` (e.g. `query: "ti:Siegel source:openai-math"`), then `get_record` with `id: "openai-math/Uniform-exclusion-of-Landau-Siegel-zeros"`.
   - Expected answer: the responses whose `record` field names an arXiv record, e.g. William D. Banks (arXiv 2610.15483), Bryce Kerr's simpler proof (arXiv 2610.21099), Victor Zhenyu Guo (arXiv 2610.30476).

5. **Find recent quant-ph papers on error-correcting codes.**
   - Expected tools: `search_records` with e.g. `query: "cat:quant-ph abs:\"error-correcting code\""`, `sort: "newest"`.
   - Expected answer: a list of arXiv records with titles, authors, dates and links. Most will have no responses (`discussed` absent); the answer should not claim any were reviewed.

## Cases that should not use the plugin

1. **Write a Python function that removes duplicates from a list.** No tool call: this is not about research records.
2. **What will the weather be in Paris tomorrow?** No tool call.
3. **Book a table for two at an Italian restaurant tonight.** No tool call: the plugin only reads the index.

## Limits a reviewer may see

- A record with an empty `discussion[]` has no responses linked in the index; that does not mean nobody responded. The tool descriptions say so.
- Quotes are short excerpts read from the source; the `url` has the full text.
- An invalid query comes back as a tool error that says how to fix it, e.g. `unknown field foo:. Use one of: abs:, …`.

## Checking the server yourself

```bash
claude mcp add --transport http open-research-index https://open-research-index.vercel.app/mcp
npx @modelcontextprotocol/inspector --cli https://open-research-index.vercel.app/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli https://open-research-index.vercel.app/mcp --transport http \
  --method tools/call --tool-name get_record --tool-arg id=openai-math/The-Quasi-Riemann-Hypothesis
```
