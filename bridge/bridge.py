#!/usr/bin/env python3
"""Hand the claims a delphi-p2p client has received to a website.

The client is https://github.com/LionSR/delphi-p2p. A website cannot be a client itself: it has no process that
stays up. So a bridge runs beside a client that does (`delphi-p2p serve --mirror`), reads that client's log, and
posts what is new to the site (POST /api/v1/claims). The site then shows, on each record's page, the versions,
holders and checks the network has for it.

The site's reply names the versions whose file list it lacks. For those the client holds, the bridge sends the
list (`delphi-p2p files`): each file's path, size and hash, never the files.

    python3 bridge.py --site https://delphi.science --key-file bridge.key --cursor bridge.cursor

The key is an agent key of an account the site lists in P2P_BRIDGE_LOGINS. The cursor file remembers the last
sequence number the site took; sequence numbers belong to one client's directory, so with a new directory delete
the file. Sending a claim twice does no harm: the site keeps the first copy of each id.

Claims go one way, from the network to the site. Anyone can run a bridge to a site of their own.
Python 3.9 or later, no packages.
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

BATCH = 200  # the most claims the site takes in one request
MAX_FILES = 10000  # the most files the site takes for one snapshot, and the most this sends in one request


def new_claims(client: str, home, since: int) -> list:
    """The claims the client received after sequence number `since`, oldest first."""
    command = [client, *(["--home", home] if home else []), "log", "--json", "--since", str(since), "--limit", str(BATCH)]
    done = subprocess.run(command, capture_output=True, text=True, timeout=300)
    if done.returncode != 0:
        raise RuntimeError(f"{client} log failed: {done.stderr.strip()}")
    return json.loads(done.stdout)["entries"]


def file_lists(client: str, home, versions: list) -> list:
    """The file lists of those versions that the client holds. It asks no other client: a client that mirrors
    gets the files by itself, and the site asks again until then."""
    lists, files = {}, 0
    for version in versions:
        command = [client, *(["--home", home] if home else []), "files", version, "--exact", "--wait", "0", "--json"]
        done = subprocess.run(command, capture_output=True, text=True, timeout=300)
        if done.returncode != 0:
            continue
        listed = json.loads(done.stdout)
        if listed["snapshot"] in lists or files + len(listed["files"]) > MAX_FILES:
            continue
        files += len(listed["files"])
        lists[listed["snapshot"]] = [{"path": f["path"], "bytes": f["bytes"], "hash": f["hash"]} for f in listed["files"]]
    return [{"hash": snapshot, "files": listing} for snapshot, listing in lists.items()]


def hand_over(site: str, key: str, entries: list, snapshots: list) -> dict:
    """Posts one batch. The reply says how many claims were new, the sequence number to continue from, and the
    versions whose file list the site lacks."""
    request = urllib.request.Request(
        f"{site.rstrip('/')}/api/v1/claims",
        data=json.dumps({"entries": entries, "snapshots": snapshots}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "delphi-p2p-bridge"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as reply:
            return json.load(reply)
    except urllib.error.HTTPError as refused:
        raise RuntimeError(f"the site answered {refused.code}: {refused.read().decode(errors='replace')[:500]}") from None


def main() -> None:
    parser = argparse.ArgumentParser(description="Hand the claims a delphi-p2p client has received to a website.")
    parser.add_argument("--site", required=True, help="the website, e.g. https://delphi.science")
    parser.add_argument("--key-file", required=True, type=pathlib.Path, help="a file holding the bridge account's agent key")
    parser.add_argument("--cursor", required=True, type=pathlib.Path, help="a file that remembers how far the site has been told")
    parser.add_argument("--home", help="the client's directory; by default the client's own default")
    parser.add_argument("--client", default="delphi-p2p", help="the client binary")
    parser.add_argument("--every", type=float, default=30, help="seconds to wait when there is nothing new; 0 stops instead")
    args = parser.parse_args()
    key = args.key_file.read_text().strip()

    wanted = None  # versions whose file list the site lacks; not known until the site has answered once
    while True:
        since = int(args.cursor.read_text()) if args.cursor.exists() else 0
        try:
            entries = new_claims(args.client, args.home, since)
            lists = file_lists(args.client, args.home, wanted or [])
            if entries or lists or wanted is None:
                reply = hand_over(args.site, key, entries, lists)
                if reply["through"] is not None:
                    args.cursor.write_text(f"{reply['through']}\n")
                wanted = reply["wanted"]
                told = f"{len(entries)} claims after {since}, {reply['stored']} new to the site; {len(lists)} file lists"
                print(f"bridge: {told}", flush=True)
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as problem:
            print(f"bridge: {problem}", file=sys.stderr, flush=True)
            entries = []
        if len(entries) == BATCH:
            continue  # there is more waiting
        if not args.every:
            return
        time.sleep(args.every)


if __name__ == "__main__":
    main()
