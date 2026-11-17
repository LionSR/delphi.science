# Testing the Delphi.science Plugin

The plugin connects ChatGPT and Codex to the Delphi.science MCP server at `https://delphi.science/mcp` (Streamable HTTP). Submit it in the portal as **With MCP**, by that URL.

`npm run plugin` (in `site/`) writes `dist/chatgpt-app-submission.json`, which the submission form imports: the listing text, every tool's hints with a justification for each, and the test cases below.

**Access is mixed.** Searching and reading need no account. Voting, commenting, forum posting and submitting links act publicly for a person and need sign-in by OAuth 2.1 (authorization code with PKCE S256). The site is its own authorization server; ChatGPT registers by Dynamic Client Registration and no client ID or secret has to be entered in the portal.

- Protected resource metadata: `https://delphi.science/.well-known/oauth-protected-resource/mcp` (also served without `/mcp`)
- Authorization server metadata: `https://delphi.science/.well-known/oauth-authorization-server` (also `/.well-known/openid-configuration`)
- Scope: `write` (the only one). No refresh tokens: the access token lasts 90 days; after that, or when revoked, the server answers 401 and ChatGPT links again.
- Every authorization response carries `iss`, so ChatGPT's stable redirect URI `https://chatgpt.com/connector_platform_oauth_redirect` applies.

## Reviewer sign-in (demo account)

People sign in with GitHub. Reviewers do not need a GitHub account:

1. Ask the plugin for something that needs sign-in (test case 4 below) and choose to connect when ChatGPT offers it.
2. On the Delphi.science page "Connect an app", choose **Sign in with the demo account** (below the GitHub link).
3. Enter the demo login and password supplied with the submission. There is no 2FA, email or SMS step.
4. Choose **Approve**. ChatGPT returns to the conversation, connected.

The demo account is a normal account whose posts are public and moderated like anyone's. It may leave its test vote and comment in place; nothing needs cleaning up. To disconnect, open `https://delphi.science/keys` while signed in and revoke the connection.

## Tools

Every tool sets `readOnlyHint`, `destructiveHint` and `openWorldHint` explicitly, and declares `securitySchemes` (`noauth`, or `oauth2` with scope `write`).

| Tool | Sign-in | readOnly | destructive | openWorld | Why |
|---|---|---|---|---|---|
| `search_records` | no | true | false | false | Reads the index only. |
| `get_record` | no | true | false | false | Reads one record. |
| `list_discussed_records` | no | true | false | false | Reads the index only. |
| `list_record_comments` | no | true | false | false | Reads a record's comments. |
| `search_forum` | no | true | false | false | Reads forum topics. |
| `get_forum_topic` | no | true | false | false | Reads one topic. |
| `whoami` | yes | true | false | false | Reads which account is connected. |
| `post_comment` | yes | false | false | true | Adds a public comment or review; removes nothing. |
| `submit_record` | yes | false | false | true | Adds a public record from a URL; removes nothing. |
| `ask_forum_question` | yes | false | false | true | Adds a public forum topic. |
| `reply_in_forum` | yes | false | false | true | Adds a public forum reply. |
| `edit_post` | yes | false | true | true | Public; overwrites the text of one of the person's own posts. |
| `vote_on_record` | yes | false | true | true | Public; replaces the person's earlier vote on that record unless `if_absent` is set. |
| `remove_record_vote` | yes | false | true | true | Deletes the person's public vote. |
| `vote_on_forum_post` | yes | false | true | true | Public score; replaces or (value 0) removes the person's earlier vote. |
| `accept_forum_answer` | yes | false | true | true | Public; sets or takes back the accepted answer on the person's own topic. |

Read tools are bounded to this index (`openWorldHint: false`); they fetch nothing from the open web. Write tools change public pages on delphi.science (`openWorldHint: true`). Posts (`post_comment`, `edit_post`, `submit_record`, forum posts, vote notes) pass an automated quality check before they are stored; a refusal is returned as a tool error with the reason and a fix, and nothing is published. A person and all their connected apps share one vote per item and 30 post attempts per day.

Called without sign-in, a tool that needs it returns an error result with `_meta["mcp/www_authenticate"]` (`Bearer resource_metadata=…, scope="write", error="insufficient_scope", error_description=…`), which is what makes ChatGPT offer to connect. A token that is expired or revoked gets HTTP 401 with the same challenge and `error="invalid_token"`.

## Positive test cases

1. **What did mathematicians say about OpenAI's quasi-Riemann hypothesis paper?** (no sign-in)
   - Expected tools: `search_records` (e.g. `q: "ti:\"quasi-Riemann\" source:openai-math"`), then `get_record` with `id: "openai-math/The-Quasi-Riemann-Hypothesis"`.
   - Expected answer: cites linked responses with authors, dates, and URLs, including Alex Kontorovich on X (2026-10-06), Pace Nielsen on MathOverflow (2026-10-08), Terence Tao's blog post (2026-10-19), and follow-up arXiv preprints (Baiying Liu, `arxiv/2610.12234`).

2. **Which AI-generated papers received expert responses most recently?** (no sign-in)
   - Expected tools: `list_discussed_records` (optionally with `query: "is:ai-generated"`).
   - Expected answer: lists discussed records ordered by most recent response, citing each latest response's author, date, and URL.

3. **Has anyone checked OpenAI's matrix multiplication exponent paper, and are there comments on it on Delphi.science?** (no sign-in)
   - Expected tools: `search_records` (e.g. `q: "ti:\"matrix multiplication\" source:openai-math"`), `get_record` with `id: "openai-math/Matrix-Multiplication-Nine-Fourths"`, and `list_record_comments` with the same id.
   - Expected answer: cites the linked responses, including blog posts by Scott Aaronson and Gil Kalai (2026-10-07) and the arXiv paper *"Multiplying matrices via polynomials: exposition and barrier"* by Amanov, van den Berg, and Zuiddam (2026-10-21); reports the site's own comments separately, or says there are none.

4. **Upvote OpenAI's quasi-Riemann hypothesis paper on Delphi.science for me, and tell me which account the vote is under.** (sign-in)
   - Expected: ChatGPT offers to connect Delphi.science; sign in as above. Then `vote_on_record` with `id: "openai-math/The-Quasi-Riemann-Hypothesis"`, `value: 1` (ChatGPT asks for confirmation first, as the tool is not read-only), and `whoami`.
   - Expected answer: the record's new score, and that the vote is public as `ChatGPT · @<demo login>’s team`. The vote is visible at `https://delphi.science/r/openai-math/The-Quasi-Riemann-Hypothesis`.

5. **Remove my vote on OpenAI's quasi-Riemann hypothesis paper on Delphi.science.** (sign-in; run after case 4)
   - Expected tools: `remove_record_vote` with `id: "openai-math/The-Quasi-Riemann-Hypothesis"`, after confirmation (the tool is marked destructive).
   - Expected answer: the record's score without the vote, and that the vote is gone from the record's page.

## Negative test cases (should not invoke the plugin)

1. **Write a Python function that removes duplicates from a list.** No tool call (general coding question).
2. **What will the weather be in Paris tomorrow?** No tool call (unrelated to research records).
3. **Book a table for two at an Italian restaurant tonight.** No tool call (the plugin is scoped to the research index).

## Further checks

- **Reading stays open after connecting, and without connecting.** Decline to connect in case 4: cases 1–3 still work.
- **No unrequested writes.** "Summarize the discussion of the quasi-Riemann hypothesis paper" calls read tools only; it must not vote or comment.
- **Forum.** "Search the Delphi.science forum for questions about Lean formalization" calls `search_forum` (no sign-in), then `get_forum_topic` for a hit.
- **Commenting.** Ask the plugin to post a comment of your own on a record, e.g. a specific technical remark about a step or a reference. Expected: `post_comment` after confirmation, then either the posted comment (public under the demo account with ChatGPT's name) or, if the quality check declines it, the stated reason and fix with a clear statement that nothing was posted. Both are correct; the server makes that decision, not ChatGPT. Generic praise ("great paper") is declined by design.

## Notes for reviewers

- An empty `discussion[]` array indicates that no responses have been linked in the index yet, not that no external discussion exists.
- Response `quote` fields contain short verbatim excerpts; full text is at `url`.
- Invalid query syntax returns a structured tool error explaining the valid fields and operators.
- Tool results contain public site content and, for write tools, the connected account's own GitHub username. They contain no tokens, session identifiers or internal account IDs.

## Testing with Codex

Codex signs in to an MCP server itself (`codex mcp login`, or **Authenticate** under `/mcp` in the app): it reads the discovery documents above, registers by Dynamic Client Registration as "Codex", opens the browser at `/oauth/authorize`, and listens on `http://127.0.0.1:<port>/callback`. No key is copied anywhere.

### Before deployment: against a local server

From the repository root (the index build needs network access to the sources):

```bash
pip install -r requirements.txt && (cd site && npm ci)
node --experimental-strip-types site/scripts/db.ts --entries fixtures/entries.jsonl > db.url &
sleep 5 && SUPABASE_DB_URL="$(head -1 db.url)" python3 index.py build      # writes dist/index.json
cd site && SITE_URL=http://localhost:3000 npm run dev                       # leave running
```

In another terminal:

```bash
codex mcp add delphi-local --url http://localhost:3000/mcp
codex mcp login delphi-local
```

The browser opens "Connect an app" naming **Codex**. Choose **Sign in with GitHub** (the local server signs you in as `@local-dev` without contacting GitHub), check that the page says what Codex may do and that it returns to `127.0.0.1`, then **Approve**. Codex reports the login succeeded. Then, in `codex`:

1. "Use delphi-local to search for records about matrix multiplication and show the first one." Expect `search_records`, then `get_record`; no sign-in involved.
2. "Which account am I signed in as on delphi-local?" Expect `whoami`: login `local-dev`, attribution `Codex · @local-dev’s team`.
3. "Upvote that record." Expect `vote_on_record` (Codex asks first; the tool is not read-only). Open `http://localhost:3000/r/<id>`: the vote shows as `Codex · @local-dev’s team`.
4. "Post a comment on it: <a specific technical remark>." Expect `post_comment` to be refused with `moderation_unavailable` and nothing posted, since a local server has no moderation provider. With `DEEPSEEK_API_KEY` set it is accepted or returned with a reason.
5. "Remove my vote." Expect `remove_record_vote`; the record page no longer shows it.
6. Open `http://localhost:3000/keys`: **Codex** is listed. **Revoke** it, then ask Codex for `whoami` again: the server answers 401 and Codex asks you to log in again. Reading (step 1) still works after `codex mcp logout delphi-local`.
7. Run `codex mcp login delphi-local` again and choose **Deny**: Codex reports that access was denied, and `/keys` lists no new connection.

To try the reviewers' password sign-in locally, start the server with `REVIEW_ACCOUNT_LOGIN=demo_reviewer REVIEW_ACCOUNT_PASSWORD=<20+ characters>`; the approval page then also offers **Sign in with the demo account**.

`node scripts/mcp-e2e.mjs` (see its header) runs the same flow unattended with the MCP SDK client and a headless browser.

### After deployment: the plugin itself

The repository is a plugin marketplace (`.agents/plugins/marketplace.json` points at `site/plugin/`, whose `.mcp.json` names `https://delphi.science/mcp`):

```bash
codex plugin marketplace add LionSR/open-research-index
```

Restart the ChatGPT desktop app, open the Plugins Directory, choose the **Delphi.science** marketplace and install the plugin. Sign-in is asked for on first use of a tool that needs it, not at install. Run the positive test cases above in Codex; with a GitHub account, or with the demo account once it is configured on the live site.

## CLI verification

```bash
# Anonymous: tools and a read
npx @modelcontextprotocol/inspector --cli https://delphi.science/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli https://delphi.science/mcp --transport http \
  --method tools/call --tool-name get_record --tool-arg id=openai-math/The-Quasi-Riemann-Hypothesis
# A write without sign-in: an error result carrying _meta["mcp/www_authenticate"]
npx @modelcontextprotocol/inspector --cli https://delphi.science/mcp --transport http --method tools/call --tool-name whoami
# Discovery
curl -s https://delphi.science/.well-known/oauth-protected-resource/mcp
curl -s https://delphi.science/.well-known/oauth-authorization-server
# Sign-in from other clients
claude mcp add --transport http open-research-index https://delphi.science/mcp   # then /mcp → Authenticate
codex mcp add open-research-index --url https://delphi.science/mcp && codex mcp login open-research-index
```
