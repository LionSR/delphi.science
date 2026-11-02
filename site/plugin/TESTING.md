# Testing the Delphi Plugin

The plugin connects ChatGPT and Codex to the Delphi MCP server at `https://delphi.science/mcp` (Streamable HTTP, read-only, no authentication). It exposes three tools, all annotated with `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`:

- `search_records`: searches the index using arXiv-style queries (`ti:`, `au:`, `abs:`, `cat:`, `source:`, `is:`, `published:`), `sort`, `limit`, `cursor`, and `fields`. Returns a paginated list of records including the count of linked expert responses (`discussed`).
- `get_record`: fetches a single record by ID (`<prefix>/<suffix>`), including `discussion[]` (author, date, verbatim quote, stance, and URL for each response) and `discusses[]` (records that this item responds to).
- `list_discussed_records`: lists records that have linked expert responses, ordered by most recent response first, including `latest_response`.

No account, API key, or test credentials are required.

## Positive test cases

1. **What did mathematicians say about OpenAI's quasi-Riemann hypothesis paper?**
   - Expected tools: `search_records` (e.g. `q: "ti:\"quasi-Riemann\" source:openai-math"`), then `get_record` with `id: "openai-math/The-Quasi-Riemann-Hypothesis"` (and optionally `openai-math/The-Quasi-Riemann-Hypothesis-October-5-2026__paper2`).
   - Expected answer: cites linked responses with authors, dates, and URLs, including Alex Kontorovich on X (2026-10-06), Pace Nielsen on MathOverflow (2026-10-08), Terence Tao's blog post (2026-10-19), and follow-up arXiv preprints (Baiying Liu, `arxiv/2610.12234`).

2. **Which AI-generated papers received expert responses most recently?**
   - Expected tools: `list_discussed_records` (optionally with `query: "is:ai-generated"`).
   - Expected answer: lists discussed records ordered by most recent response, citing each latest response's author, date, and URL.

3. **Has anyone checked OpenAI's matrix multiplication exponent paper?**
   - Expected tools: `search_records` (e.g. `q: "ti:\"matrix multiplication\" source:openai-math"`), then `get_record` with `id: "openai-math/Matrix-Multiplication-Nine-Fourths"`.
   - Expected answer: cites the linked responses, including blog posts by Scott Aaronson and Gil Kalai (2026-10-07) and the arXiv paper *"Multiplying matrices via polynomials: exposition and barrier"* by Amanov, van den Berg, and Zuiddam (2026-10-21).

4. **Which arXiv papers respond to OpenAI's proof that Landau–Siegel zeros do not exist?**
   - Expected tools: `search_records` (e.g. `q: "ti:Siegel source:openai-math"`), then `get_record` with `id: "openai-math/Uniform-exclusion-of-Landau-Siegel-zeros"`.
   - Expected answer: cites responses with a `record` field pointing to an arXiv entry, including William D. Banks (`arxiv/2610.15483`), Bryce Kerr (`arxiv/2610.21099`), and Victor Zhenyu Guo (`arxiv/2610.30476`).

5. **Find recent quant-ph papers on error-correcting codes.**
   - Expected tools: `search_records` with e.g. `q: "cat:quant-ph abs:\"error-correcting code\""`, `sort: "newest"`.
   - Expected answer: lists matching arXiv records with titles, authors, dates, and links, without fabricating reviews for records where `discussed` is absent.

## Negative test cases (should not invoke the plugin)

1. **Write a Python function that removes duplicates from a list.** No tool call (general coding question).
2. **What will the weather be in Paris tomorrow?** No tool call (unrelated to research records).
3. **Book a table for two at an Italian restaurant tonight.** No tool call (the plugin is read-only and scoped to the research index).

## Notes for reviewers

- An empty `discussion[]` array indicates that no responses have been linked in the index yet, not that no external discussion exists.
- Response `quote` fields contain short verbatim excerpts; full text is at `url`.
- Invalid query syntax returns a structured tool error explaining the valid fields and operators.

## CLI verification

```bash
claude mcp add --transport http open-research-index https://delphi.science/mcp
npx @modelcontextprotocol/inspector --cli https://delphi.science/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli https://delphi.science/mcp --transport http \
  --method tools/call --tool-name get_record --tool-arg id=openai-math/The-Quasi-Riemann-Hypothesis
```
