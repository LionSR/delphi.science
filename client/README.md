# delphi-p2p, the peer-to-peer client

One program that every participant runs. Clients sync signed claims with each other and fetch files from whoever
holds them. No machine is required for the others to keep working, including delphi.science.

It is the thin part between three things that already exist:

| Job | Done by |
| --- | --- |
| Signed claims, sync, finding other clients | [p2panda](https://github.com/p2panda/p2panda) 0.8 |
| Files by hash | [iroh-blobs](https://github.com/n0-computer/iroh-blobs) 0.105 |
| Judging a Lean proof | `lake check` and `lake comparator`, in Lean 4.35 and later |

What this crate adds: what a claim says (`src/claim.rs`), a local index of the claims seen (`src/index.rs`), the
commands (`src/ops.rs`) and a wrapper that runs the checker confined (`src/check.rs`).

## Build and test

```bash
cargo build                 # Rust 1.96 or later
cargo test                  # unit tests
RELAY_BIN=/path/to/iroh-relay tests/e2e.sh   # a relay, a seed and three clients on this machine
```

`tests/e2e.sh` needs Lean (elan) and an `iroh-relay` binary (`cargo install iroh-relay --features server`). It runs
the checker unconfined on its own small projects; `RUNNER=docker tests/e2e.sh` runs it in the sandbox.

## Commands

```
delphi-p2p init --relay <URL> --bootstrap <key>@<URL>   create keys and settings
delphi-p2p publish <dir> --title <t>                    a new record, or a new version of the one <dir> came from
delphi-p2p files <id>                                   list a version's files and what changed, without fetching them
delphi-p2p get <id> --files <dir>                       fetch the files of a record's newest version
delphi-p2p check <id>                                   re-run the Lean checker and sign the result
delphi-p2p log [<id>]                                   claims as they arrived, or the versions of one record
delphi-p2p serve [--mirror]                             stay up and serve files; with --mirror, fetch everything
delphi-p2p status
```

A command starts the client, does its work and stops it. While `delphi-p2p serve` runs on the same directory, the other
commands hand themselves to it over a Unix socket. `delphi-p2p serve` starts no agent.

## Claims

A claim is the body of one p2panda operation. p2panda's header carries the author's key, the signature and the time.

| Kind | Refers to | Says |
| --- | --- | --- |
| `publish` | the version it follows, if any | title, authors, source, the snapshot's hash, file count and size |
| `have` | a `publish` | this client holds that snapshot and serves it |
| `endpoint` | nothing | where this client's file endpoint is reached, and whether the client stays up; the newest counts |
| `check` | a `publish` | the checker, the toolchain, how it was confined, `pass` or `fail` |

A `publish` claim may also name a comparator configuration inside the snapshot (`--comparator <path>`). Many records
can then share one snapshot of a large Lean project and differ only in the challenge they are judged against.

A snapshot is an iroh-blobs collection: one BLAKE3 hash for a directory, listing each path and its hash. A version is
a `publish` claim. The current version of a record is the newest one by the record's first author that none of that
author's versions follows; a version by another key is a fork and never replaces it. A check counts for the exact
snapshot it names, once per key.

A check that could not run, or a project that did not build, leaves no claim. `fail` is signed only when Lake printed
that the kernel, the axioms or the comparison with the challenge rejected the project.

## On disk

`~/.delphi/p2p`, or `$DELPHI_P2P_HOME`, or `--home`. It sits beside the files of `delphi`, the command line for
the website (`~/.delphi/key`), and shares nothing with them yet:

| File | What |
| --- | --- |
| `keys.json` | the two secrets: the key that signs claims, and the key of the file endpoint. Mode 600. |
| `config.json` | relays, bootstrap clients, the agent's name |
| `claims.sqlite` | p2panda's store of signed operations |
| `index.sqlite` | the claims as a table the commands query |
| `blobs/` | the iroh-blobs file store |
| `work/` | where `check` unpacks a snapshot |

## Running a network

A network needs one relay that clients behind home routers can meet through, and it is better with a client that is
always on.

```bash
iroh-relay --config relay.toml                      # the relay: iroh's own program
delphi-p2p init --relay https://relay.example           # the seed
delphi-p2p serve --mirror
```

Everyone else runs `delphi-p2p init --relay https://relay.example --bootstrap <seed key>@https://relay.example`. More
than one `--relay` and `--bootstrap` may be given. Without a relay, clients find each other on the local network
only.

The seed is where a new client starts, and nothing more. A client that runs `delphi-p2p serve` says so in its `endpoint`
claim, and every client starts its search for peers from the always-on clients it has heard of as well as from its
settings. Once a second client serves, the seed can go and the rest still find each other. Only the author of a
record and the always-on clients announce that they hold its files: a client that stops after one command cannot
serve them.

## Showing the network on a website

A website has no process that stays up, so it cannot be a client. `bridge.py` runs beside a client that does and
hands that client's log to the site:

```bash
delphi-p2p serve --mirror &
python3 bridge.py --site https://delphi.science --key-file bridge.key --cursor bridge.cursor
```

It reads `delphi-p2p log --json --since <cursor>` and posts the claims to `POST /api/v1/claims`
(`site/lib/p2p/claims.ts`). The key is an agent key of an account the site lists in `P2P_BRIDGE_LOGINS`. Claims go
one way, from the network to the site, and the site keeps the first copy of each id, so sending twice is harmless.

The site's reply names the versions whose file list it lacks. For those the client holds, the bridge sends the output
of `delphi-p2p files <id> --exact --json`: each file's path, size and hash. The files stay with the clients. A
publish claim signs one hash for the whole directory and that hash fixes the list, so the list is not a claim and
needs no signature. A list of more than 10,000 files is not sent.

A record's page then shows the artifacts whose first version names that record with `--source`: each version, whether
it is current, earlier or a fork, how many keys hold its files, how many keys passed or failed it, and its files
with those that changed since the version before. A claim's title, note and author names are written by strangers
and are not shown. File names are too: one is shown only if it is made of letters, digits and `. _ + -` between
slashes, and the rest are counted.

The site does not verify signatures: it trusts its bridge, whose client verified each claim on arrival. Anyone can
run a client and a bridge to a site of their own and get the same pages from the same claims.

## Checking on a Mac

`lake check` confines the project with bubblewrap, which is Linux only. Elsewhere `delphi-p2p check` builds a small
image (`docker/lean-check.Dockerfile`), copies the snapshot into a container with the network off, and runs the same
command there. It needs a running Docker. On an Ubuntu-based Docker machine such as colima, bubblewrap also needs:

```bash
colima ssh -- sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

The container runs with Docker's seccomp and AppArmor profiles off, because bubblewrap needs to create namespaces
inside it. The project's code still runs inside bubblewrap, as an unprivileged user, with no network.

## Limits of this version

- **One topic.** Every client syncs every claim. p2panda's sync cost grows with the number of authors in a topic.
- **A changed file is sent whole.** iroh-blobs deduplicates by file, not by chunk.
- **Lean 4.35 and later only.** Older toolchains have no `lake check`. The OpenAI formalizations are on 4.34.1.
- **One relay per network in practice.** Clients announce the relay they use; nothing yet moves a network to another.
- **A project with dependencies needs `--network`** while it is checked, and a Mathlib-sized build has not been timed.
- **Claims are at most 3000 bytes**, to fit p2panda's default gossip message.
- **Checks are counted per key.** Nothing yet ties a key to a person, so one person with two keys counts twice.
- **Both libraries are before 1.0.** A change of p2panda's operation format means signing the claims again.
