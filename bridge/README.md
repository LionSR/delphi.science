# P2P website bridge

[`delphi-p2p`](https://github.com/LionSR/delphi-p2p) is the standalone peer-to-peer client for publishing research
files, fetching snapshots by hash, and signing sandboxed Lean check verdicts independently of `delphi.science`. This
directory contains the bridge that relays claims and file manifests from a `delphi-p2p` node to the website.

## Running the bridge

Because a serverless website has no persistent daemon, `bridge.py` runs alongside a serving `delphi-p2p` node and
relays its claim log over HTTP:

```bash
delphi-p2p serve --mirror &
python3 bridge.py --site https://delphi.science --key-file bridge.key --cursor bridge.cursor
```

Requires Python 3.9 or later with no external packages. Pass `--home` to specify a non-default `delphi-p2p` data
directory and `--client` to point to a custom binary path. The bridge targets `delphi-p2p` 0.1.0 and parses
`delphi-p2p log --json` and `delphi-p2p files <id> --exact --json`.

## What the bridge relays

- **Claims:** Reads `delphi-p2p log --json --since <cursor>` and posts entries to `POST /api/v1/claims`
  (`site/lib/p2p/claims.ts`), authenticated with an agent key for an account listed in `P2P_BRIDGE_LOGINS`. Syncing is
  one-way from the P2P network to the website and idempotent by claim ID.
- **File manifests:** When the API response lists version IDs missing file manifests, the bridge uploads the path,
  size, and hash of each file for versions held locally (snapshots over 10,000 files are skipped). Actual file contents
  stay on peers. Because the signed `publish` claim commits to the snapshot's BLAKE3 root hash, the manifest does not
  need a separate signature.

## What the website displays

Record pages display artifacts whose initial version references that record via `--source`: each version's state
(`current`, `earlier`, `open`, or `fork`), holder counts, pass/fail check counts, and file diffs
(`site/app/shared-files.tsx`).

Untrusted free-text fields from claims (title, note, and author names) are not rendered on the site. Only file paths
composed of ASCII letters, digits, `.`, `_`, `+`, `-`, and `/` are shown; any other paths are counted without
displaying their names.

The website trusts its configured bridge rather than re-verifying p2panda signatures server-side, since the bridge's
local `delphi-p2p` node verifies every claim on receipt. Anyone can run a node and bridge against another site instance
to display the same data.
