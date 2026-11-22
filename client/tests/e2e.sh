#!/usr/bin/env bash
# End-to-end run of the client on one machine: a relay, a seed, and three other clients.
#
# It walks the acceptance list of the MVP: publish, list and fetch while the publisher is
# offline, two keys checking the same proof, a new version, a fork, a rejected proof, and the
# same work again after the seed is switched off.
#
#   RELAY_BIN=/path/to/iroh-relay tests/e2e.sh
#
# RELAY_BIN  the iroh-relay binary (cargo install iroh-relay --features server). Not needed
#            when a relay already listens on localhost:3340.
# RUNNER     how `check` confines the project: none (default here, the test projects are ours),
#            docker or bwrap.
# DELPHI_P2P the client binary. Default: target/debug/delphi-p2p.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
DELPHI_P2P=${DELPHI_P2P:-$here/../target/debug/delphi-p2p}
RUNNER=${RUNNER:-none}
RELAY=http://localhost:3340
root=$(mktemp -d)
pids=()

cleanup() {
	for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
	rm -rf "$root"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }
# field <name> <text>: the value of a "Name: value" line.
field() { awk -v name="$1:" '$1 == name { print $2; exit }' <<<"$2"; }
expect() { grep -qF -- "$2" <<<"$1" || fail "expected \"$2\" in:
$1"; }
client() { local home=$1; shift; "$DELPHI_P2P" --home "$root/$home" "$@"; }
# serve <name>: an always-on client in the background. Its process id is in $!.
serve() { "$DELPHI_P2P" --home "$root/$1" serve --mirror >"$root/$1.log" 2>&1 & }

if ! curl -s -o /dev/null "$RELAY"; then
	"${RELAY_BIN:?no relay on localhost:3340, and RELAY_BIN is not set}" --dev >"$root/relay.log" 2>&1 &
	pids+=($!)
	sleep 1
fi

lean_project() { # lean_project <dir> <theorem body>
	mkdir -p "$1"
	printf 'leanprover/lean4:v4.36.0\n' >"$1/lean-toolchain"
	printf 'name = "toy"\ndefaultTargets = ["Toy"]\n\n[[lean_lib]]\nname = "Toy"\n' >"$1/lakefile.toml"
	printf '{"version": "1.3.0", "packagesDir": ".lake/packages", "packages": [], "name": "toy", "lakeDir": ".lake", "fixedToolchain": false}\n' >"$1/lake-manifest.json"
	printf '%s\n' "$2" >"$1/Toy.lean"
}

step "Four clients: a seed and three others that start from it"
client seed init --relay "$RELAY" --no-mdns >/dev/null
seed=$(field Node "$(client seed status)")
for name in ann ben cy; do
	client $name init --relay "$RELAY" --bootstrap "$seed@$RELAY" --no-mdns --agent "agent of $name" >/dev/null
done
ben=$(field Node "$(client ben status)")
cy=$(field Node "$(client cy status)")
serve seed
seed_pid=$!
pids+=($seed_pid)

step "Ann publishes a Lean proof"
lean_project "$root/proof" 'theorem two_add_two : 2 + 2 = 4 := rfl'
# A file of more than one chunk (1024 bytes), so that listing and fetching differ.
head -c 5000 /dev/zero | tr '\0' 'n' >"$root/proof/Notes.txt"
out=$(client ann publish "$root/proof" --title "Two plus two" --author "Ann")
echo "$out"
v1=$(field Id "$out")
[ -n "$v1" ] || fail "publish printed no id"
# Publish returns once the seed has the files, so they outlast this command.
expect "$out" "Other-Holders: 1"

step "Cy lists its files while Ann is offline, without fetching them"
out=$(client cy files "$v1")
echo "$out"
expect "$out" "Files: 5 ("
expect "$out" "$(printf -- '-\t5000\t')"
expect "$out" "$(printf '\tToy.lean')"
# With no time to ask anyone, get succeeds only if the files are already here.
if client cy get "$v1" --files "$root/cy-none" --wait 0 >/dev/null 2>&1; then fail "listing fetched the files"; fi

step "Ben fetches it while Ann is offline: the files come from the seed"
out=$(client ben get "$v1" --files "$root/ben-copy")
echo "$out"
cmp "$root/proof/Toy.lean" "$root/ben-copy/Toy.lean" || fail "Ben's copy differs"

step "Ben and Cy each re-run the checker and sign the result"
out=$(client ben check "$v1" --runner "$RUNNER")
echo "$out"
expect "$out" "Result: pass"
out=$(client cy check "$v1" --runner "$RUNNER")
expect "$out" "Result: pass"
expect "$out" "Checks: 2 pass, 0 fail"
checkers=$(client cy log --kind check --json)
expect "$checkers" "$ben"
expect "$checkers" "$cy"
if grep -qF "\"author\":\"$seed\"" <<<"$checkers"; then fail "the seed signed a check"; fi

step "Ann publishes a second version from the same directory"
lean_project "$root/proof" 'theorem two_add_two : 2 + 2 = 4 := by decide'
out=$(client ann publish "$root/proof" --note "proved by decide")
echo "$out"
v2=$(field Id "$out")
expect "$out" "Follows: $v1"
out=$(client ben files "$v1")
echo "$out"
expect "$out" "Compared-With: $v1"
expect "$(grep 'Toy.lean$' <<<"$out")" "changed"
expect "$(grep 'Notes.txt$' <<<"$out")" "same"

step "Fetching the record by its first id now gives the second version"
out=$(client cy get "$v1" --files "$root/cy-copy")
expect "$out" "Id: $v2"
expect "$out" "Checks: 0 pass, 0 fail"
grep -q decide "$root/cy-copy/Toy.lean" || fail "Cy did not get the second version"
out=$(client cy get "$v1" --exact --files "$root/cy-old")
expect "$out" "Id: $v1"
expect "$out" "Checks: 2 pass, 0 fail"

step "Ben publishes his own change: a fork, which does not replace Ann's version"
printf '\ntheorem three : 1 + 2 = 3 := rfl\n' >>"$root/ben-copy/Toy.lean"
rm "$root/ben-copy/Notes.txt"
printf 'Ben added a theorem.\n' >"$root/ben-copy/Changes.txt"
out=$(client ben publish "$root/ben-copy" --note "one more theorem")
fork=$(field Id "$out")
out=$(client cy files "$fork" --exact --json)
expect "$out" "\"after\":\"$v1\""
expect "$out" '{"bytes":21,"change":"added",'
expect "$out" '"removed":[{"bytes":5000,'
out=$(client ben log "$v1")
echo "$out"
expect "$out" "Versions: 3"
expect "$(grep "^$v1" <<<"$out")" "earlier"
expect "$(grep "^$v2" <<<"$out")" "current"
expect "$(grep "^$fork" <<<"$out")" "fork"
expect "$(grep "^$v1" <<<"$out")" "pass=2"

step "A proof that rests on sorry is rejected, and the rejection is signed"
lean_project "$root/bad" 'theorem wrong : 1 + 1 = 3 := sorry'
bad=$(field Id "$(client ann publish "$root/bad" --title "One plus one is three")")
out=$(client cy check "$bad" --runner "$RUNNER")
echo "$out"
expect "$out" "Result: fail"
expect "$out" "Checks: 0 pass, 1 fail"

step "A proof judged against a challenge: lake comparator, with its configuration named in the claim"
lean_project "$root/cmp" 'theorem unused : True := trivial'
printf 'name = "toy"\n\n[[lean_lib]]\nname = "Challenge"\n\n[[lean_lib]]\nname = "Solution"\n' >"$root/cmp/lakefile.toml"
rm "$root/cmp/Toy.lean"
printf 'theorem sum_comm (a b : Nat) : a + b = b + a := by\n  sorry\n' >"$root/cmp/Challenge.lean"
printf 'theorem sum_comm (a b : Nat) : a + b = b + a := Nat.add_comm a b\n' >"$root/cmp/Solution.lean"
mkdir "$root/cmp/challenges"
printf '{"challenge_module": "Challenge", "solution_module": "Solution", "theorem_names": ["sum_comm"], "permitted_axioms": ["propext", "Quot.sound", "Classical.choice"]}\n' >"$root/cmp/challenges/sum_comm.json"
cmp_id=$(field Id "$(client ann publish "$root/cmp" --title "Addition commutes" --comparator challenges/sum_comm.json)")
out=$(client cy check "$cmp_id" --runner "$RUNNER")
echo "$out"
expect "$out" "lake comparator --config challenges/sum_comm.json"
expect "$out" "Result: pass"

step "A project that does not build gets no verdict at all"
lean_project "$root/broken" 'theorem broken : 1 + 1 = 2 := by exact nonsense'
broken=$(field Id "$(client ann publish "$root/broken" --title "Does not compile")")
if out=$(client cy check "$broken" --runner "$RUNNER" 2>&1); then fail "a broken build produced a verdict: $out"; fi
expect "$out" "did not reach a verdict"

step "Ann starts serving too, and the others hear of it"
serve ann
pids+=($!)
sleep 15
client cy log --kind endpoint >/dev/null
client ben log --kind endpoint >/dev/null

step "The seed is switched off. The others carry on among themselves"
kill "$seed_pid"
wait "$seed_pid" 2>/dev/null || true
if kill -0 "$seed_pid" 2>/dev/null; then fail "the seed is still running"; fi
lean_project "$root/later" 'theorem later : 3 + 3 = 6 := rfl'
out=$(client cy --linger 25 publish "$root/later" --title "Published without the seed")
later=$(field Id "$out")
out=$(client ben get "$later" --files "$root/ben-later" --wait 60)
echo "$out"
cmp "$root/later/Toy.lean" "$root/ben-later/Toy.lean" || fail "Ben's copy differs"
out=$(client ben check "$later" --runner "$RUNNER")
expect "$out" "Result: pass"
out=$(client ann log "$later")
echo "$out"
expect "$out" "pass=1"
# Cy published it and Ann mirrors it. The seed, being off, does not hold it, and Ben, who
# stops after each command, does not claim to.
expect "$out" "holders=2"

printf '\nAll steps passed.\n'
