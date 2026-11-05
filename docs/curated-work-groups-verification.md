# Curated work grouping: verification

2026-11-05. Feature branch `curated-work-grouping`, validated on main `ff34c497329f6d3b52dd9eee02623cdf74951605`. The agent-attribution change in #61 was merged independently while this feature was being prepared; the feature was rebased cleanly onto that main and does not modify its attribution implementation, tests or documentation. No migration, storage merge, interaction transfer or production data write is included.

## Automated validation

- `python test_index.py`: **64 passed**; `python test_candidates.py`: **4 passed**; `python test_x_candidates.py`: **6 passed**. Repository requirements were installed at their pinned versions.
- `cd site && npm test`: **324 passed, 0 failed, 0 skipped** on the final rebased implementation. The local index used the 344-record fixture build plus the two read-only source snapshots, exercising the actual duplicate pair in the general search suite.
- Dedicated `lib/records/work-groups.test.ts`: **12 passed**. Coverage includes exact IDs, source/boolean/date/text filters, all 10 sorts, counts/numbered pages/cursors, repeated/shared response URLs and conflicting assertions, missing members, an unrelated similar-title OpenAI result, the same human interacting separately with both IDs, keyword/vector ranking, groups outside the 200-candidate hybrid window, REST/MCP/Markdown contracts and unchanged upstream redirects.
- The canonical-main regression asserts the official Lean/GitHub ID across sorts and filtered views, and retains that main ID even if it is temporarily unavailable.
- The title/publication regression asserts the corrected exponent without overwriting raw titles, preserves the raw repository creation date, selects paper publication for citation/JSON-LD metadata, and omits publication metadata if the paper source is absent.
- `npx tsc --noEmit`, normal Next.js 16.4.3 Turbopack `npm run build`, and `git diff --check`: passed. No package manifest or lockfile changed.

Tests create throwaway PGlite instances using the existing schema. No migration was added or applied to a real database.

## Browser QA

Chromium against the final local production build, desktop 1280×900 light and mobile 390×844 dark, using local PGlite. Browser requests outside localhost were blocked; external X widgets were intentionally not loaded. No vote/comment/sign-in/write action was submitted.

- One grouped card, both original source links, per-source interaction links, no ambiguous group vote button, and **10 distinct responses** from 6 paper links plus 10 repository links (**6 shared**).
- Official Lean/GitHub remains main under newest/oldest/score and a Hexagon-source search. Both original detail URLs use the official main canonical URL/JSON-LD identifier; the Hexagon page explicitly labels its alternative source view. Raw JSON roots retain their requested source identity and counters.
- Card title, H1, citation title and JSON-LD name preserve `A 2^{o(n)} Time Algorithm for 3-SAT`. Raw parser-derived titles remain separately visible as source titles and in JSON.
- Both `citation_publication_date` and JSON-LD `datePublished` use the paper's **2026-10-27**, never repository creation **2026-08-06**. The paper PDF remains in citation metadata. Source dates retain their distinct visible meanings.
- Original source-bound vote form IDs and upstream redirects remain intact. All 10 provenance disclosures exist; 6 identify both sources, and a shared disclosure was opened and inspected.
- No page errors or horizontal overflow. Desktop/mobile search and detail screenshots were captured and visually inspected.

## Independent review and limits

Independent read-only review passed, including a separate 203-source-record hybrid reproduction that correctly returns **202 grouped works**, and a final independent **12/12** targeted test run. Fragment identities, hybrid-window counts, stable official main, publication-date separation, preserved raw source/write identity and the evidence-backed title were reviewed.

See [the query and interaction contract](curated-work-groups.md). Rank and interactions remain source-bound; unique-person counts and scores are not summed. Full `work.discussion` is the normalized URL union; legacy root arrays/counters and MCP latest-response remain source-specific. Source-date filters/order retain original semantics. Ordinary fragments remain distinct because they may identify different answers/comments. The existing hybrid candidate cap and cached-total/live-read behavior remain. Production query latency/load and concurrent source removal were not tested. No merge or manual deployment is part of this change.
