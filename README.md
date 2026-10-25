# Open Research Index

An index of research outputs that agents can search. Each entry is labelled by its **source**: APP, arXiv, Zenodo, DOI, Palomar and other Lean formalizations, lab releases (OpenAI Math, Anthropic Science), or Hexagon, the archive for LLM-assisted mathematics. Hexagon does not judge correctness, so its records keep the deposit's declarations: `authorship` and `human_understanding` (none, some, all). arXiv is harvested for this year's quant-ph and hep-th papers; arXiv is moderated, so these are not labelled. Repositories of AI-generated papers (clawXiv, aiXiv, ai.viXra, JAIGP) are not listed: most of what they hold is pseudoscience, and their URLs are refused, also as web pages (`BLOCKED_HOSTS` in `sources.py`). Only releases that pass APP verification get the APP label. They are read from the registry's published list, https://agenticpapers.app/papers/index.json, and not copied.

The site and API are in `site/` (Next.js on Vercel, Supabase Postgres). The harvester and the build are the Python files here.

Agents read the index through the API (https://open-research-index.vercel.app/api/v1, also as an OpenAPI document at `/api/v1/openapi.json`) or as an MCP server at `/mcp`: Streamable HTTP, read-only, no sign-in, with the tools `search_records`, `get_record` (a record with its responses, `discussion[]`) and `list_discussed_records`. In Claude Code:

```bash
claude mcp add --transport http open-research-index https://open-research-index.vercel.app/mcp
```

`site/plugin/` is the same server packaged as a ChatGPT and Codex plugin: `plugin.json` (names, descriptions, example prompts, icon), `mcp.json` (the remote server, no sign-in) and `TESTING.md` (test cases for reviewers). The files say `{{SITE}}` where the host goes; `cd site && npm run plugin` fills in `SITE_URL` (default https://open-research-index.vercel.app), checks the names, prompts and links, and writes `dist/open-research-index-plugin.zip`. To verify the domain, set the portal's token as `OPENAI_APPS_CHALLENGE` on Vercel: the site serves it at `/.well-known/openai-apps-challenge`, and 404 while it is unset.

## Rules

- **Research outputs only, not software.** GitHub repositories are not listed on their own; a paper's code is reached through the paper (APP, arXiv, DOI). Lean formalizations come in through Palomar and `formalization.yaml` projects.
- **Everything that resolves is posted.** The only hard checks are: the record exists and is public, it has a title, it is not listed already (also as an APP paper), and a person adds at most 20 links a day.
- **An agent labels each entry** with `research`, `non-research`, `fiction`, `low-info`, or `harmful`, and up to 4 topic tags (`label-prompt.md`). The page shows research by default. Entries labelled `harmful` are left out of the page and `index.json`, but their files keep the label so an editor can review them.
- **Metadata only, read from the source.** Each entry has a title, authors, an abstract trimmed to about 600 characters, a date, and a link back. Nothing is typed in by hand. Requests go one at a time with a delay for each host, and responses are cached in `.cache/`.
- **Ids work like DOIs.** Every record id is `<prefix>/<suffix>`: the source's prefix, then the source's own identifier (`palomar/PALOMAR-2026-08-08-000001`, `app/APP-260923-0000`). The prefixes are listed in `site/lib/prefixes.json`. A prefix is given once and is never renamed or reused; a new source needs a new prefix there before it builds. `/id/<id>` redirects to the original.
- **What others said is shown, not copied.** `discuss` attaches posts and articles about a record. Only voices with a public scholarly record are taken: researchers and their labs, journals, established research blogs. Anonymous accounts, news aggregators and reposts are not, however sharp the point. An X post is read from X's oEmbed endpoint for its author, handle and date only; its text is not stored or served, and the page shows the post with X's own embed, so it carries attribution and disappears when the author deletes it. A blog post, paper, talk or MathOverflow thread is shown as its title and a quote with a link. `discuss --recheck` reads every link again each day and drops the ones that are gone, so a deleted post leaves the index within a day. Each link shows as 🔥 in listings.
- **Each response has a stance, set by a person** (`discuss --stance`): `refutes` (finds an error that breaks the main result), `questions` (raises a gap, a mismatch such as Lean against prose, a weaker statement than claimed, or a priority issue), `confirms` (checks the result or formalizes it independently), `simplifies` (a shorter or human-readable proof), `extends` (builds on it), or `reacts` (a general reaction, no technical claim). Only `confirms`, `simplifies` and `extends` count like an upvote in the popularity sorts, and so does a link not yet labelled. A record with a response that refutes or questions it is `is:disputed`; `is:discussed` finds every record with responses. `discuss --propose-stances` asks the labelling agent for a stance per unlabelled link (`stance-prompt.md`) and prints each as the command that sets it; nothing is written until a person runs the ones they agree with.
- **A discussed record opens with where it stands, once a person has reviewed it.** `reception` keeps one or two sentences ("Withdrawn on 7 October after a sign error, analysed by Lekili and Sheridan"), the date written, the links it rests on, and `reviewed_by`, the reviewer's GitHub login. `reception <id> --draft` asks the labelling agent for a draft from the labelled links (`reception-prompt.md`); a person publishes it with `--reviewed-by`, or writes their own with `--text`. Only reviewed text is shown (above "Discussed elsewhere", and as the page's description) and served. When the record's links change after it was written (one added, dropped or relabelled), it stops being published until it is reviewed again, and `build` names it.
- **Entries are refreshed.** `refresh` reads each entry again, because sources revise their records. If the text changed, the entry is labelled again. If the source returns 404, the entry is marked `gone`.

## Commands

```bash
python3 index.py add <url or id> [--by <github login>] [--dry-run]
python3 index.py harvest [--source palomar] [--limit N] [--dry-run]
python3 index.py label [--all] [--labeler claude|none|canned:<file.json>]
python3 index.py refresh [--older-than 7] [--dry-run]
python3 index.py discuss openai-math/<key> <url>...   # X posts, blog posts, articles about the record
python3 index.py discuss --recheck [<record id>...]    # read the links again; deleted posts drop out (daily)
python3 index.py discuss <record id> <url>... --stance confirms   # label links (already attached ones are not read again)
python3 index.py discuss --propose-stances [<record id>...]       # the agent proposes stances, as commands to run
python3 index.py reception <record id> --draft             # the agent drafts where the work stands; not published
python3 index.py reception <record id> --reviewed-by <login> [--text "..."] [--links <url>...]   # a person publishes it
python3 index.py reception                                 # every reception: published, draft or stale
python3 index.py build     # dist/index.json, dist/index.db, dist/llms.txt
python3 candidates.py [--days 7]   # this week's arXiv and MathOverflow items that may respond to a record
cd site && npm run dev     # the site and API, on local Postgres (PGlite)
python3 test_index.py && python3 test_candidates.py
```

Commit as a member of the Vercel team, today the owner (`git config user.email 14889516+LionSR@users.noreply.github.com`): Vercel deploys a commit of this private repository only when its author is a member of the team (on Pro, each member is a seat), and `.github/workflows/author-check.yml` fails on any other. A new member's commit email goes in the repository variable `VERCEL_TEAM_EMAILS`. `Co-Authored-By` trailers are fine.

New responses are found weekly, not attached: `.github/workflows/responses.yml` runs `candidates.py` on Mondays and commits its report to `reports/responses/`, with the `discuss` command for each candidate; a person reads it and runs the ones that hold up.

`harvest.json` lists the harvest jobs. A job with `"enabled": false` is kept in the file but does not run. The arXiv searches are off for now.

To add a source, write one adapter class in `sources.py` with `match`, `fetch`, and `harvest`, and add it to `SOURCES`.
