# delphi-p2p

`delphi-p2p` is a peer-to-peer CLI for sharing research files and independently checking Lean proofs. Peers fetch files
by content hash and exchange signed claims about which versions they hold or have verified, without relying on
[delphi.science](https://delphi.science).

The standalone client repository is at [LionSR/delphi-p2p](https://github.com/LionSR/delphi-p2p). This directory also
includes `bridge.py` for relaying claims and file manifests to a Delphi website instance.

## Using the client

### Commands

| Command | Description |
| --- | --- |
| `delphi-p2p init --relay <URL> --bootstrap <key>@<URL>` | Initialize keys and configuration |
| `delphi-p2p publish <dir> --title <t>` | Publish a new record or a new version of an existing one |
| `delphi-p2p files <id>` | List files and changes for a version without downloading contents |
| `delphi-p2p get <id> --files <dir>` | Download files for a record's latest version |
| `delphi-p2p check <id>` | Run the Lean checker in a sandbox and sign the verdict |
| `delphi-p2p log [<id>]` | List received claims, or show all versions of one record |
| `delphi-p2p serve [--mirror]` | Run as a background server (`--mirror` downloads and serves all versions) |
| `delphi-p2p status` | Show local keys, relays, and store counts |

By default, each command runs and exits. If `delphi-p2p serve` is already running in the same data directory, CLI
commands forward requests to it over a Unix socket. Running `delphi-p2p serve` does not start an AI agent.

After publishing, `publish` waits up to 120 seconds by default (`--wait`) for another peer to confirm it holds the
files, reporting the count as `Other-Holders`. During downloads, `--wait` limits how long the client searches for a
holder; once a transfer begins it can run past that deadline, and stalled transfers abort after 60 seconds without data.
Under `--mirror`, failed downloads retry with exponential backoff from 1 minute up to 1 hour for 7 days.

### Checking on macOS

`lake check` sandboxes builds with bubblewrap, which is Linux-only. On macOS and other non-Linux platforms,
`delphi-p2p check` builds a Docker image (`docker/lean-check.Dockerfile`), copies the snapshot into a container with
networking disabled, and runs Lake inside it. This requires a running Docker daemon. On an Ubuntu-based Docker VM such
as Colima, bubblewrap also requires enabling unprivileged user namespaces:

```bash
colima ssh -- sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

The container runs with Docker's seccomp and AppArmor profiles disabled so bubblewrap can create namespaces inside it.
Project code still runs inside bubblewrap as an unprivileged user without network access.

## Running a network

A network requires a relay server so peers behind NAT or firewalls can connect, plus at least one always-on node to
bootstrap discovery and mirror files:

```bash
iroh-relay --config relay.toml                  # run an iroh relay server
delphi-p2p init --relay https://relay.example   # initialize the seed node
delphi-p2p serve --mirror                       # serve and mirror files
```

Other participants join with:

```bash
delphi-p2p init --relay https://relay.example --bootstrap <seed-key>@https://relay.example
```

Both `--relay` and `--bootstrap` can be passed multiple times. Without a relay, discovery is limited to the local
network via mDNS.

New nodes bootstrap from the configured seed and from `endpoint` claims published by running servers. Once a node
discovers another serving peer, it can reconnect without the seed. Publishers and serving nodes advertise the snapshots
they hold via `have` claims.

### Website bridge

Because a serverless website has no persistent daemon, `bridge.py` runs alongside a serving `delphi-p2p` node and
relays its claims to the site:

```bash
delphi-p2p serve --mirror &
python3 bridge.py --site https://delphi.science --key-file bridge.key --cursor bridge.cursor
```

`bridge.py` reads `delphi-p2p log --json --since <cursor>` and posts claims to `POST /api/v1/claims`
(`site/lib/p2p/claims.ts`), authenticated with an agent key for an account listed in `P2P_BRIDGE_LOGINS`. Syncing is
one-way from the P2P network to the website and idempotent by claim ID.

When the API response lists version IDs missing file manifests, the bridge uploads `delphi-p2p files <id> --exact --json`
for any version held locally (path, size, and hash per file; snapshots over 10,000 files are skipped) while file
contents remain on peers. Because the signed `publish` claim commits to the snapshot's BLAKE3 root hash, the manifest
needs no separate signature. Record pages show artifacts whose first version links that record via `--source` (version
states, holder counts, check counts, and file diffs) while omitting untrusted free-text fields (title, note, author
names) and showing only paths composed of ASCII letters, digits, `.`, `_`, `+`, `-`, and `/`.

The website trusts its configured bridge rather than re-verifying p2panda signatures server-side, as the bridge's local
node verifies every claim on receipt. Anyone can run a node and bridge against their own site instance to display the
same records.

## Technical reference

- **Discovery and claim sync:** [p2panda](https://github.com/p2panda/p2panda) 0.8
- **File transfer:** [iroh-blobs](https://github.com/n0-computer/iroh-blobs) 0.105
- **Lean verification:** `lake check` and `lake comparator` in a sandbox (Lean 4.35 or later)

### Claims and versions

Each claim is stored as the payload of a p2panda operation; the p2panda header holds the author's public key, signature,
and timestamp.

| Claim | Reference | Contents |
| --- | --- | --- |
| `publish` | Parent version ID, if any | Title, authors, source URL, snapshot hash, file count, and total size |
| `have` | `publish` claim ID | Snapshot hash held and served by the signing peer |
| `endpoint` | None | File-transfer endpoint address and serving status (latest claim applies) |
| `check` | `publish` claim ID | Checker command, Lean toolchain, sandbox runner, and `pass` or `fail` verdict |

A snapshot is an iroh-blobs collection identified by a single BLAKE3 root hash over all file paths and content hashes.
Each `publish` claim creates a version. A record's current version is the latest unsuperseded version from the original
author; versions signed by other keys are forks and never replace it.

A `publish` claim can also specify a comparator configuration path inside the snapshot (`--comparator <path>`), allowing
multiple records to share one large Lean snapshot while checking different challenge specifications. Check verdicts
apply only to the exact snapshot referenced and are counted once per signing key. If the checker fails to run or the
project fails to compile, no claim is published; `fail` is signed only when Lake explicitly reports a kernel rejection,
a disallowed axiom, or a challenge mismatch.

### Local storage

The default data directory is `~/.delphi/p2p` (override with `$DELPHI_P2P_HOME` or `--home`). The website CLI
(`delphi`) stores its credentials separately in `~/.delphi/key`.

| Path | Contents |
| --- | --- |
| `keys.json` | Private keys for claim signing and the file-transfer endpoint (mode `0600`) |
| `config.json` | Configured relays, bootstrap peers, and default agent name |
| `claims.sqlite` | p2panda store of signed operations |
| `index.sqlite` | SQLite index of claims queried by CLI commands |
| `blobs/` | iroh-blobs content-addressed file store |
| `work/` | Temporary directory where `check` unpacks snapshots |

### Current limitations

- **Single topic:** Every peer syncs all claims; p2panda sync overhead grows with the number of authors in a topic.
- **File-level deduplication only:** iroh-blobs deduplicates whole files rather than chunks, so modifying a file transfers the full file again.
- **Lean 4.35 or later only:** Older toolchains do not include `lake check` (for example, the OpenAI formalizations target Lean 4.34.1).
- **Single relay per network:** Peers announce their configured relay URL, and migrating a network to another relay is not yet supported.
- **External dependencies require `--network`:** Projects with external packages need `--network` during `check`, and Mathlib-scale builds have not yet been benchmarked.
- **3,000-byte claim limit:** Claims are capped at 3,000 bytes to fit within p2panda's default gossip message size.
- **Per-key check counts:** Signing keys are not yet linked to verified identities, so multiple keys controlled by the same person count separately.
- **Pre-1.0 dependencies:** Both `p2panda` and `iroh-blobs` are pre-1.0; breaking changes to p2panda's operation format will require re-signing claims.

## Development

Core modules: `src/claim.rs` (claim schema), `src/index.rs` (local SQLite index), `src/ops.rs` (CLI commands),
and `src/check.rs` (sandboxed Lean checker).

```bash
cargo build                                  # Rust 1.96 or later
cargo test                                   # unit tests
RELAY_BIN=/path/to/iroh-relay tests/e2e.sh   # local relay, seed peer, and three clients
```

`tests/e2e.sh` requires Lean (`elan`) and an `iroh-relay` binary (`cargo install iroh-relay --features server`).
By default it runs checks without a sandbox on its generated test projects; set `RUNNER=docker` to test inside the
Docker sandbox.
