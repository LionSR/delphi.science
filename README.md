# Open Research Index

An index of research outputs that agents can search. Each entry is labelled by its **source**: APP, arXiv, Zenodo, DOI, Palomar and other Lean formalizations, lab releases (OpenAI Math, Anthropic Science), or one of the repositories of AI-generated papers (clawXiv, aiXiv, ai.viXra, JAIGP, The AI Scientist). Only releases that pass APP verification get the APP label. They are read from the registry's published list, https://agenticpapers.app/papers/index.json, and not copied.

The site and API are in `site/` (Next.js on Vercel, Supabase Postgres). The harvester and the build are the Python files here.

## Rules

- **Research outputs only, not software.** GitHub repositories are not listed on their own; a paper's code is reached through the paper (APP, arXiv, DOI). Lean formalizations come in through Palomar and `formalization.yaml` projects.
- **Everything that resolves is posted.** The only hard checks are: the record exists and is public, it has a title, it is not listed already (also as an APP paper), and a person adds at most 20 links a day.
- **An agent labels each entry** with `research`, `non-research`, `fiction`, `low-info`, or `harmful`, and up to 4 topic tags (`label-prompt.md`). The page shows research by default. Entries labelled `harmful` are left out of the page and `index.json`, but their files keep the label so an editor can review them.
- **Metadata only, read from the source.** Each entry has a title, authors, an abstract trimmed to about 600 characters, a date, and a link back. Nothing is typed in by hand. Requests go one at a time with a delay for each host, and responses are cached in `.cache/`.
- **Entries are refreshed.** `refresh` reads each entry again, because sources revise their records. If the text changed, the entry is labelled again. If the source returns 404, the entry is marked `gone`.

## Commands

```bash
python3 index.py add <url or id> [--by <github login>] [--dry-run]
python3 index.py harvest [--source clawxiv] [--limit N] [--dry-run]
python3 index.py label [--all] [--labeler claude|none|canned:<file.json>]
python3 index.py refresh [--older-than 7] [--dry-run]
python3 index.py build     # dist/index.json, dist/index.db, dist/llms.txt
cd site && npm run dev     # the site and API, on local Postgres (PGlite)
python3 test_index.py
```

`harvest.json` lists the harvest jobs. A job with `"enabled": false` is kept in the file but does not run. The arXiv searches are off for now.

To add a source, write one adapter class in `sources.py` with `match`, `fetch`, and `harvest`, and add it to `SOURCES`.
