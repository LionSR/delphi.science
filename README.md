# Open Research Index

An index of research outputs that agents can search. Each entry is labelled by its **source**: APP, arXiv, Zenodo, DOI, Palomar and other Lean formalizations, or lab releases (OpenAI Math, Anthropic Science). arXiv is harvested for this year's quant-ph and hep-th papers; arXiv is moderated, so these are not labelled. Repositories of AI-generated papers (clawXiv, aiXiv, ai.viXra, JAIGP) are not listed: most of what they hold is pseudoscience, and their URLs are refused, also as web pages (`BLOCKED_HOSTS` in `sources.py`). Only releases that pass APP verification get the APP label. They are read from the registry's published list, https://agenticpapers.app/papers/index.json, and not copied.

The site and API are in `site/` (Next.js on Vercel, Supabase Postgres). The harvester and the build are the Python files here.

## Rules

- **Research outputs only, not software.** GitHub repositories are not listed on their own; a paper's code is reached through the paper (APP, arXiv, DOI). Lean formalizations come in through Palomar and `formalization.yaml` projects.
- **Everything that resolves is posted.** The only hard checks are: the record exists and is public, it has a title, it is not listed already (also as an APP paper), and a person adds at most 20 links a day.
- **An agent labels each entry** with `research`, `non-research`, `fiction`, `low-info`, or `harmful`, and up to 4 topic tags (`label-prompt.md`). The page shows research by default. Entries labelled `harmful` are left out of the page and `index.json`, but their files keep the label so an editor can review them.
- **Metadata only, read from the source.** Each entry has a title, authors, an abstract trimmed to about 600 characters, a date, and a link back. Nothing is typed in by hand. Requests go one at a time with a delay for each host, and responses are cached in `.cache/`.
- **Ids work like DOIs.** Every record id is `<prefix>/<suffix>`: the source's prefix, then the source's own identifier (`palomar/PALOMAR-2026-08-08-000001`, `app/APP-260923-0000`). The prefixes are listed in `site/lib/prefixes.json`. A prefix is given once and is never renamed or reused; a new source needs a new prefix there before it builds. `/id/<id>` redirects to the original.
- **What others said is shown, not copied.** `discuss` attaches posts and articles about a record. Only voices with a public scholarly record are taken: researchers and their labs, journals, established research blogs. Anonymous accounts, news aggregators and reposts are not, however sharp the point. An X post is read from X's oEmbed endpoint and shown with X's own embed, so it carries attribution and disappears when the author deletes it; a blog post or article is shown as its Open Graph title and description with a link. `refresh` reads each link again and drops the ones that are gone. Each link counts like an upvote in the popularity sorts and shows as 🔥 in listings.
- **Entries are refreshed.** `refresh` reads each entry again, because sources revise their records. If the text changed, the entry is labelled again. If the source returns 404, the entry is marked `gone`.

## Commands

```bash
python3 index.py add <url or id> [--by <github login>] [--dry-run]
python3 index.py harvest [--source palomar] [--limit N] [--dry-run]
python3 index.py label [--all] [--labeler claude|none|canned:<file.json>]
python3 index.py refresh [--older-than 7] [--dry-run]
python3 index.py discuss openai-math/<key> <url>...   # X posts, blog posts, articles about the record
python3 index.py build     # dist/index.json, dist/index.db, dist/llms.txt
cd site && npm run dev     # the site and API, on local Postgres (PGlite)
python3 test_index.py
```

`harvest.json` lists the harvest jobs. A job with `"enabled": false` is kept in the file but does not run. The arXiv searches are off for now.

To add a source, write one adapter class in `sources.py` with `match`, `fetch`, and `harvest`, and add it to `SOURCES`.
