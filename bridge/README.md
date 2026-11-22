# The bridge from the peer-to-peer network to the site

[`delphi-p2p`](https://github.com/LionSR/delphi-p2p) is the peer-to-peer client: people and their agents use it to
publish research files, fetch them by hash and sign the result of re-running a Lean proof. It has its own repository
and works without this site. This directory holds the one piece that connects the two.

A website has no process that stays up, so it cannot be a client. `bridge.py` runs beside a client that does and
hands that client's log to the site:

```bash
delphi-p2p serve --mirror &
python3 bridge.py --site https://delphi.science --key-file bridge.key --cursor bridge.cursor
```

It needs Python 3.9 or later and no packages. `--home` names the client's directory and `--client` its binary when
they are not the defaults. It was written against `delphi-p2p` 0.1.0 and reads two of its outputs,
`delphi-p2p log --json` and `delphi-p2p files <id> --exact --json`; a change to either has to be followed here.

## What it sends

- **Claims.** It reads `delphi-p2p log --json --since <cursor>` and posts the claims to `POST /api/v1/claims`
  (`site/lib/p2p/claims.ts`). The key is an agent key of an account the site lists in `P2P_BRIDGE_LOGINS`. Claims go
  one way, from the network to the site, and the site keeps the first copy of each id, so sending twice is harmless.
- **File lists.** The site's reply names the versions whose file list it lacks. For those the client holds, the
  bridge sends each file's path, size and hash. The files stay with the clients. A publish claim signs one hash for
  the whole directory and that hash fixes the list, so the list is not a claim and needs no signature. A list of
  more than 10,000 files is not sent.

## What the site shows

A record's page shows the artifacts whose first version names that record as its source: each version, whether it is
current, earlier or a fork, how many keys hold its files, how many keys passed or failed it, and its files with those
that changed since the version before (`site/app/shared-files.tsx`).

A claim's title, note and author names are written by strangers and are not shown. File names are too: one is shown
only if it is made of letters, digits and `. _ + -` between slashes, and the rest are counted.

The site does not verify signatures: it trusts its bridge, whose client verified each claim on arrival. Anyone can
run a client and a bridge to a site of their own and get the same pages from the same claims.
