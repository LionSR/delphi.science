#!/usr/bin/env python3
"""Offline tests: source detection, duplicate checks, build filtering. No network.

    python test_index.py
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import index  # noqa: E402
import sources as S  # noqa: E402


class Detect(unittest.TestCase):
    CASES = {
        "https://github.com/SakanaAI/AI-Scientist": ("github", "SakanaAI__AI-Scientist"),
        "github.com/owner/repo.git": ("github", "owner__repo"),
        "owner/repo": ("github", "owner__repo"),
        "https://github.com/o/r/tree/main/src": ("github", "o__r"),
        "https://arxiv.org/abs/1706.03762v7": ("arxiv", "1706.03762"),
        "arXiv:2406.01234": ("arxiv", "2406.01234"),
        "2406.01234": ("arxiv", "2406.01234"),
        "https://zenodo.org/records/123456": ("zenodo", "123456"),
        "10.5281/zenodo.123456": ("zenodo", "123456"),
        "https://hexagonmath.org/abs/2610.00292v1": ("hexagon", "2610.00292"),
        "hexagonmath.org/pdf/2610.00244v2": ("hexagon", "2610.00244"),
        "hexagon:2609.00104": ("hexagon", "2609.00104"),
        "10.1038/nature14539": ("doi", "10.1038__nature14539"),
        "https://doi.org/10.1101/2024.01.01.123456": ("doi", "10.1101__2024.01.01.123456"),
        "https://huggingface.co/datasets/openai/gsm8k": ("huggingface", "datasets__openai__gsm8k"),
        "https://huggingface.co/meta-llama/Llama-3-8B": ("huggingface", "models__meta-llama__Llama-3-8B"),
        "https://github.com/anthropics/formal-math/blob/main/zeta23/formalization.yaml": ("lean", "anthropics__formal-math__zeta23"),
        "https://github.com/anthropics/fermats-last-theorem/blob/main/formalization.yaml": ("lean", "anthropics__fermats-last-theorem"),
        "PALOMAR-2026-10-23-000018": ("palomar", "PALOMAR-2026-10-23-000018"),
        "https://www.anthropic.com/research/riemann-zeta": ("anthropic-science", "riemann-zeta"),
        "https://github.com/openai/math/blob/main/preprints/Sharp-integral-fillings-in-CAT(0)-spaces-September-23-2026/paper.pdf":
            ("openai-math", "Sharp-integral-fillings-in-CAT(0)-spaces"),
    }

    def test_known_sources(self) -> None:
        for url, want in self.CASES.items():
            with self.subTest(url=url):
                s, key = S.detect(url)
                self.assertEqual((s.name, key), want)

    def test_anything_else_is_web(self) -> None:
        s, key = S.detect("https://example.org/some/paper")
        self.assertEqual(s.name, "web")
        self.assertEqual(len(key), 12)

    def test_blocked_venues_are_rejected(self) -> None:
        for url in ["https://www.clawxiv.org/abs/clawxiv.2610.00001", "aixiv.science/abs/aixiv.261022.000005",
                    "https://ai.vixra.org/abs/2610.0054", "https://vixra.org/abs/2401.0001", "https://jaigp.org/paper/105"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                S.detect(url)

    def test_garbage_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            S.detect("not a url")


class Checks(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = index.ENTRIES
        index.ENTRIES = Path(self.tmp.name)

    def tearDown(self) -> None:
        index.ENTRIES = self.saved
        self.tmp.cleanup()

    def entry(self, **kw: object) -> dict:
        return {"key": "o__r", "source": "github", "url": "https://github.com/o/r", "title": "r", "stars": 120, **kw}

    def test_new_entry_passes(self) -> None:
        self.assertEqual(index.check(self.entry()), [])

    def test_repository_needs_stars_or_a_citation_file(self) -> None:
        self.assertIn("CITATION.cff", index.check(self.entry(stars=3))[0])
        self.assertEqual(index.check(self.entry(stars=3, citation_cff=True)), [])

    def test_duplicate_is_rejected(self) -> None:
        index.save(index.path_for("github", "o__r"), self.entry())
        self.assertIn("already listed", index.check(self.entry())[0])

    def test_app_repo_is_rejected(self) -> None:
        papers = index.load_entries()
        if not papers:
            self.skipTest("no APP entries in registry/entries")
        repo = papers[0]["repo_url"]
        owner, name = repo.rstrip("/").split("/")[-2:]
        problems = index.check(self.entry(key=f"{owner}__{name}", url=repo))
        self.assertTrue(any("APP paper" in p for p in problems))

    def test_harmful_is_left_out_of_build(self) -> None:
        index.save(index.path_for("github", "o__r"), self.entry(review={"category": "harmful"}))
        index.save(index.path_for("github", "o__s"), self.entry(key="o__s", url="https://github.com/o/s", review={"category": "fiction"}))
        ids = {i["id"]: i for i in index.items([e for _, e in index.load()]) if i["source"] != "app"}
        self.assertNotIn("github/o__r", ids)
        self.assertEqual(ids["github/o__s"]["category"], "fiction")

    def test_unlabelled_counts_as_research(self) -> None:
        index.save(index.path_for("github", "o__r"), self.entry())
        it = next(i for i in index.items([e for _, e in index.load()]) if i["id"] == "github/o__r")
        self.assertEqual(it["category"], "research")


class Discussion(unittest.TestCase):
    OEMBED = {
        "url": "https://twitter.com/AndrewLott1331/status/2108189504259727838", "author_name": "Andrew Lott",
        "author_url": "https://twitter.com/AndrewLott1331",
        "html": '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">Did you notice that the bound is weaker?<br>'
                'Still gets Erd&#337;s Turán</p>&mdash; Andrew Lott (@AndrewLott1331) '
                '<a href="https://twitter.com/AndrewLott1331/status/2108189504259727838?ref_src=twsrc%5Etfw">October 8, 2026</a></blockquote>',
    }

    def test_parse_oembed(self) -> None:
        self.assertEqual(S.parse_oembed(self.OEMBED), {
            "kind": "x", "url": "https://x.com/AndrewLott1331/status/2108189504259727838", "author": "Andrew Lott",
            "handle": "AndrewLott1331", "date": "2026-10-08",
        })  # not the text: X's embed shows it

    def test_first_title_only(self) -> None:
        m = S.MetaParser(); m.feed("<html><title>Post | Asaf Karagila</title><svg><title>Search</title></svg><h1>H</h1><p>First.</p><p>Second.</p>")
        self.assertEqual((m.title, m.h1, m.p), ("Post | Asaf Karagila", "H", "First."))

    def test_passage_from_text_fragment(self) -> None:
        page = "<html><script>x()</script><p>Intro.</p><p>Jakob Glas: the zero-free region to the right of 7/8 is striking. More.</p></html>"
        quote = "the zero-free region to the right of 7/8 is striking. More."
        self.assertEqual(S.passage(page, "the%20zero-free%20region"), ("", quote))
        self.assertEqual(S.passage(page, "the%20zero-free%20region,striking"), ("", quote))  # start,end
        self.assertEqual(S.passage(page, "Jakob%20Glas-,the%20zero-free%20region"), ("Jakob Glas", quote))  # prefix-,start names the person
        self.assertEqual(S.passage(page, "Glas%3A%20the%20zero-free%2C"), ("", ""))  # an encoded comma is part of the text
        self.assertEqual(S.passage(page, "Nobody-,the%20zero-free%20region"), ("", ""))  # the prefix must be on the page

    def test_crosslink_both_ways(self) -> None:
        paper = {"id": "openai-math/P", "title": "P", "discussion": [{"kind": "web", "url": "https://arxiv.org/abs/2610.20058"}, {"kind": "x", "url": "https://x.com/a/status/1"}]}
        reply = {"id": "arxiv/2610.20058", "title": "Primes between 8th powers?"}
        index.crosslink([paper, reply, {"id": "arxiv/9999.00001", "title": "unrelated"}])
        self.assertEqual(paper["discussion"][0]["record"], "arxiv/2610.20058")
        self.assertNotIn("record", paper["discussion"][1])
        self.assertEqual(reply["discusses"], [{"id": "openai-math/P", "title": "P"}])

    def test_discussion_is_served_without_x_text(self) -> None:
        x = {"kind": "x", "url": "https://x.com/a/status/1", "author": "A", "handle": "a", "text": "hi", "date": "2026-10-08", "added": "2026-10-09"}
        web = {"kind": "web", "url": "https://e.org/q", "title": "Q", "text": "a quote", "added": "2026-10-09"}
        e = {"key": "k", "source": "web", "url": "https://e.org/p", "title": "T", "discussion": [x, web]}
        served = index.to_item(e)["discussion"]
        self.assertEqual(served, [{k: v for k, v in x.items() if k != "text"}, web])
        self.assertNotIn('"hi"', index.dumps(index.to_item(e)))
        self.assertEqual(e["discussion"][0]["text"], "hi")  # serving does not change the entry


class Entries(unittest.TestCase):
    """A temporary entries/ folder; links are read through self.link, not the network."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = index.ENTRIES, S.discussion_link
        index.ENTRIES = Path(self.tmp.name)
        S.discussion_link = self.link

    def tearDown(self) -> None:
        index.ENTRIES, S.discussion_link = self.saved
        self.tmp.cleanup()

    def link(self, url: str) -> dict:
        return {"kind": "web", "url": url, "title": "new"}

    def entry(self, key: str = "k", links: list | None = None) -> None:
        index.save(index.path_for("web", key), {"key": key, "source": "web", "url": f"https://e.org/{key}", "title": key.upper(), "discussion": links})

    def read(self, key: str = "k") -> dict:
        return json.loads(index.path_for("web", key).read_text())

    def cmd(self, *argv: str) -> int:
        """index.py with these arguments; what it prints goes to self.out."""
        self.out = io.StringIO()
        with contextlib.redirect_stdout(self.out):
            return index.main(list(argv))


class Drop(Entries):
    """discuss --drop takes a link off by the URL it was attached with, as a takedown asks."""

    def test_drop_finds_a_page_whose_query_matters_and_an_x_post_in_any_form(self) -> None:
        self.entry("k", [{"kind": "web", "url": "https://www.youtube.com/watch?v=abc", "added": "2026-10-09"},
                         {"kind": "x", "url": "https://x.com/a/status/1", "added": "2026-10-09"},
                         {"kind": "web", "url": "https://e.org/kept", "added": "2026-10-09"}])
        self.cmd("discuss", "web/k", "https://www.youtube.com/watch?v=abc", "https://twitter.com/a/status/1?s=20", "--drop")
        self.assertEqual([d["url"] for d in self.read()["discussion"]], ["https://e.org/kept"])


class Recheck(Entries):
    """discuss --recheck reads every link again: a deleted post drops out, an unreachable one is kept."""

    def link(self, url: str) -> dict:
        if "deleted" in url:
            raise S.NotFound(url)
        if "down" in url:
            raise S.SourceError("timed out")
        return {"kind": "x", "url": url, "author": "A", "handle": "a", "date": "2026-10-08"}

    def test_recheck_drops_deleted_and_keeps_the_rest(self) -> None:
        links = [{"kind": "x", "url": "https://x.com/a/status/1", "text": "old", "added": "2026-10-09"},
                 {"kind": "x", "url": "https://x.com/a/status/2/deleted", "added": "2026-10-09"},
                 {"kind": "web", "url": "https://down.example/p", "title": "P", "added": "2026-10-10"}]
        self.entry("k", links)
        self.entry("j")
        self.assertEqual(self.cmd("discuss", "--recheck"), 0)
        after = self.read()["discussion"]
        self.assertEqual([d["url"] for d in after], ["https://x.com/a/status/1", "https://down.example/p"])
        self.assertNotIn("text", after[0])  # read again, without the post's text
        self.assertEqual(after[0]["added"], "2026-10-09")
        self.assertEqual(after[1], links[2])  # unreachable: kept as it was

    def test_recheck_keeps_the_stance(self) -> None:
        self.entry("k", [{"kind": "x", "url": "https://x.com/a/status/1", "added": "2026-10-09", "stance": "questions"}])
        self.cmd("discuss", "--recheck")
        self.assertEqual(self.read()["discussion"][0]["stance"], "questions")

    def test_recheck_only_named_records(self) -> None:
        for k in ("a", "b"):
            self.entry(k, [{"kind": "x", "url": "https://x.com/a/status/9/deleted"}])
        self.cmd("discuss", "--recheck", "web/a")
        self.assertNotIn("discussion", self.read("a"))
        self.assertIn("discussion", self.read("b"))


class Stance(Entries):
    """A person labels what each response does; only support counts as an upvote, refutes or questions mark it disputed."""

    def setUp(self) -> None:
        super().setUp()
        self.entry("k", [{"kind": "x", "url": "https://x.com/a/status/1", "author": "A", "handle": "a", "added": "2026-10-09"}])

    def links(self) -> list:
        return self.read()["discussion"]

    def test_stance_on_an_attached_link_is_set_without_reading_it(self) -> None:
        S.discussion_link = lambda url: self.fail("an attached link is not read again to label it")
        self.cmd("discuss", "web/k", "https://twitter.com/a/status/1?s=20", "--stance", "refutes")
        self.assertEqual(self.links()[0], {"kind": "x", "url": "https://x.com/a/status/1", "author": "A", "handle": "a",
                                           "added": "2026-10-09", "stance": "refutes"})
        self.cmd("discuss", "web/k", "https://x.com/a/status/1", "--stance", "none")
        self.assertNotIn("stance", self.links()[0])

    def test_new_links_take_the_stance_and_keep_it_when_read_again(self) -> None:
        self.cmd("discuss", "web/k", "https://e.org/reply", "--stance", "simplifies")
        self.assertEqual(self.links()[1]["stance"], "simplifies")
        self.cmd("discuss", "web/k", "https://e.org/reply")  # read again, no stance given: it keeps its own
        self.assertEqual([d.get("stance") for d in self.links()], [None, "simplifies"])

    def test_unknown_stance_is_refused(self) -> None:
        with self.assertRaises(SystemExit):
            index.main(["discuss", "web/k", "https://x.com/a/status/1", "--stance", "likes"])

    def test_proposals_are_printed_as_commands_and_nothing_is_written(self) -> None:
        self.cmd("discuss", "web/k", "https://e.org/a#:~:text=a%20gap", "https://e.org/b")
        self.cmd("discuss", "web/k", "https://e.org/b", "--stance", "extends")
        before = index.path_for("web", "k").read_text()
        canned = Path(self.tmp.name) / "stances.json"
        canned.write_text(json.dumps({"https://e.org/a#:~:text=a%20gap": {"stance": "questions", "reason": "Lean states less"},
                                      "https://e.org/b": {"stance": "refutes"}, "https://x.com/a/status/1": {"stance": "likes"}}))
        self.cmd("discuss", "--propose-stances", "--labeler", f"canned:{canned}")
        text = self.out.getvalue()
        self.assertIn("python3 index.py discuss web/k 'https://e.org/a#:~:text=a%20gap' --stance questions   # Lean states less", text)
        self.assertNotIn("e.org/b", text)  # already labelled by a person
        self.assertIn("# no proposal, open it: https://x.com/a/status/1", text)  # not a stance
        self.assertEqual(index.path_for("web", "k").read_text(), before)

    def test_the_labeler_gets_the_responses_as_data(self) -> None:
        seen = {}

        def run(cmd: list, input: str | None = None, **kw: object) -> object:
            if input is None:  # not the labeller: `gh auth token`, where gh is installed
                return saved(cmd, **kw)
            seen["prompt"] = input
            return type("Done", (), {"returncode": 0, "stderr": "", "stdout": 'Sure. [{"url": "https://x.com/a/status/1", "stance": null}]'})()

        saved, index.subprocess.run = index.subprocess.run, run
        try:
            self.cmd("discuss", "--propose-stances")
        finally:
            index.subprocess.run = saved
        data = json.loads(seen["prompt"].split("BEGIN_RECORDS\n")[1].split("\nEND_RECORDS")[0])
        self.assertEqual(data, [{"id": "web/k", "title": "K", "summary": "", "responses": [
            {"url": "https://x.com/a/status/1", "kind": "x", "author": "A"}]}])

    def test_counts_and_flags(self) -> None:
        links = [{"url": "1"}, {"url": "2", "stance": "confirms"}, {"url": "3", "stance": "reacts"}, {"url": "4", "stance": "questions"}]
        self.assertEqual(index.upvoting(links), 2)  # unlabelled and confirms
        self.assertTrue(index.disputed(links))
        self.assertFalse(index.disputed(links[:3]))
        e = {"key": "k", "source": "web", "url": "https://e.org/p", "title": "T",
             "discussion": [{"kind": "x", "url": "https://x.com/a/status/1", "text": "t", "stance": "refutes"}]}
        it = index.to_item(e)
        self.assertEqual((it["disputed"], it["discussion"][0]), (True, {"kind": "x", "url": "https://x.com/a/status/1", "stance": "refutes"}))
        self.assertNotIn("disputed", index.to_item({**e, "discussion": [{"kind": "web", "url": "u", "stance": "extends"}]}))

    def test_is_disputed_and_is_discussed_in_the_snapshot(self) -> None:
        import query
        base = {"source": "web", "url": "u", "title": "T"}
        items = [{**base, "id": "web/a", "discussion": [{"url": "1", "stance": "refutes"}], "disputed": True},
                 {**base, "id": "web/b", "discussion": [{"url": "1", "stance": "confirms"}]}, {**base, "id": "web/c"}]
        path = Path(self.tmp.name) / "index.db"
        query.build_db(path, items, {}, {})
        db = query.connect(path)
        ids = lambda q: sorted(r["id"] for r in query.search(db, q)["results"])  # noqa: E731
        self.assertEqual((ids("is:disputed"), ids("is:discussed"), ids("T ANDNOT is:discussed")), (["web/a"], ["web/a", "web/b"], ["web/c"]))
        db.close()


class StanceCopies(unittest.TestCase):
    """site/lib/stances.json is the one list of stances. The migration's generated columns and the labelling
    prompt cannot read it, so they must name the same stances, with the same upvoting/disputing split."""

    ROOT = Path(__file__).resolve().parent

    def test_the_migration_counts_and_disputes_the_same_stances(self) -> None:
        import re
        sql = next(t for f in sorted((self.ROOT / "site" / "supabase" / "migrations").glob("*.sql"), reverse=True)
                   if "upvoting integer generated" in (t := f.read_text()))  # the latest migration that defines them
        column = lambda name: re.search(rf"add column {name} \w+ generated always as \((.*?)\) stored", sql, re.S).group(1)  # noqa: E731
        named = lambda path: set(re.findall(r'@\.stance == "(\w+)"', path))  # noqa: E731
        upvoting, disputing = column("upvoting"), column("disputed")
        self.assertEqual(named(upvoting), index.UPVOTING)
        self.assertEqual("!(exists(@.stance))" in upvoting, index.STANCE_FILE["unlabelled_upvotes"])
        self.assertEqual(named(disputing), index.DISPUTING)
        self.assertNotIn("exists(@.stance)", disputing)  # an unlabelled link disputes nothing
        self.assertLessEqual(index.UPVOTING | index.DISPUTING, set(index.STANCES))

    def test_the_labelling_prompt_offers_the_same_stances(self) -> None:
        import re
        prompt = (self.ROOT / "stance-prompt.md").read_text()
        self.assertEqual(re.findall(r"^- `(\w+)`:", prompt, re.M), list(index.STANCES))


class Reception(Entries):
    """Where the work stands: drafted by the agent from labelled links, published only once a person reviews it,
    and no longer published once the links change."""

    LINKS = [{"kind": "web", "url": "https://e.org/sign-error", "author": "Lekili", "stance": "refutes", "text": "a sign error"},
             {"kind": "x", "url": "https://x.com/a/status/1", "author": "A"}]

    def setUp(self) -> None:
        super().setUp()
        self.entry("k", self.LINKS)
        self.canned = Path(self.tmp.name) / "drafts.json"
        self.canned.write_text(json.dumps({"web/k": {"text": "Withdrawn on 7 October after a sign error found by Lekili.",
                                                     "links": ["https://e.org/sign-error", "https://not.attached/x"]}}))

    def reception(self, *argv: str) -> int:
        return self.cmd("reception", "web/k", *argv)

    def test_a_draft_is_not_published_until_a_person_reviews_it(self) -> None:
        self.assertEqual(self.reception("--draft", "--labeler", f"canned:{self.canned}"), 0)
        e = self.read()
        self.assertEqual(e["reception"]["links"], ["https://e.org/sign-error"])  # only links the record has
        self.assertNotIn("reviewed_by", e["reception"])
        self.assertEqual(index.reception_state(e), "draft")
        self.assertNotIn("reception", index.to_item(e))
        self.assertEqual(self.reception("--reviewed-by", "LionSR"), 0)
        self.assertEqual(index.to_item(self.read())["reception"], {"text": "Withdrawn on 7 October after a sign error found by Lekili.",
                                                                   "written": S.today(), "links": ["https://e.org/sign-error"], "reviewed_by": "LionSR"})

    def test_text_by_hand_and_stale_when_the_links_change(self) -> None:
        self.assertEqual(self.reception("--text", "Refuted by Lekili.", "--reviewed-by", "LionSR", "--links", "https://e.org/sign-error"), 0)
        self.assertEqual(index.reception_state(self.read()), "published")
        self.cmd("discuss", "web/k", "https://x.com/a/status/1", "--stance", "confirms")  # relabelled
        e = self.read()
        self.assertEqual(index.reception_state(e), "stale")
        self.assertNotIn("reception", index.to_item(e))
        self.assertEqual(self.reception("--reviewed-by", "LionSR"), 0)  # reviewed again against the links as they are
        self.assertEqual(index.reception_state(self.read()), "published")
        self.cmd("discuss", "web/k", "https://e.org/new-reply")  # a link added
        self.assertEqual(index.reception_state(self.read()), "stale")

    def test_refusals(self) -> None:
        self.assertEqual(self.reception("--reviewed-by", "LionSR"), 2)  # nothing to review yet
        self.assertEqual(self.reception("--text", "x", "--reviewed-by", "not a login"), 2)
        self.assertEqual(self.reception("--text", "x", "--links", "https://elsewhere.org/p"), 2)
        self.assertEqual(self.reception("--text", "word " * 100), 2)
        self.assertEqual(self.reception("--draft", "--reviewed-by", "LionSR", "--labeler", f"canned:{self.canned}"), 2)
        self.entry("k", [{**d, "stance": None} for d in self.LINKS])
        self.assertEqual(self.reception("--draft", "--labeler", f"canned:{self.canned}"), 2)  # no labelled links
        self.assertNotIn("reception", self.read())


class RecordShape(unittest.TestCase):
    """The items index.py builds are the records /api/v1 serves (the loader stores them, the API adds the live
    counts), so every field they carry must be documented in the API's Record schema, at every depth, with its
    type. The schema is read from site/openapi.json, the static copy of site/lib/openapi.ts (npm run openapi)."""

    ROOT = Path(__file__).resolve().parent
    SPEC = json.loads((ROOT / "site" / "openapi.json").read_text())
    TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict, "null": type(None)}

    def problems(self, value: object, schema: dict, at: str) -> list[str]:
        """Where value does not fit schema: a field the schema does not list (objects are closed), a missing
        required field, a wrong type or a value outside an enum. Covers the keywords the document uses."""
        if "$ref" in schema:
            schema = self.SPEC["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
        types = schema.get("type", [])
        types = [types] if isinstance(types, str) else types
        if types and not any(isinstance(value, self.TYPES[t]) and not (t in ("integer", "number") and isinstance(value, bool)) for t in types):
            return [f"{at}: {value!r} is not {' or '.join(types)}"]
        if "enum" in schema and value not in schema["enum"]:
            return [f"{at}: {value!r} is not one of {schema['enum']}"]
        out = []
        if isinstance(value, dict) and "properties" in schema:
            props = schema["properties"]
            out += [f"{at}.{k}: not in the schema" for k in value if k not in props]
            out += [f"{at}.{k}: required" for k in schema.get("required", []) if k not in value]
            out += [p for k, v in value.items() if k in props for p in self.problems(v, props[k], f"{at}.{k}")]
        if isinstance(value, list) and "items" in schema:
            out += [p for v in value for p in self.problems(v, schema["items"], f"{at}[]")]
        return out

    def built(self) -> list[dict]:
        """Items from entries that use every field to_item serves: each source's fields, both kinds of link with
        stances, a reviewed reception, and a response that is itself a record (record, discusses)."""
        links = [{"kind": "x", "url": "https://x.com/a/status/1", "author": "A", "handle": "a", "text": "t", "date": "2026-10-08", "added": "2026-10-09", "stance": "refutes"},
                 {"kind": "web", "url": "https://arxiv.org/abs/2610.20058", "author": "B", "site": "arXiv", "title": "Reply", "text": "a quote",
                  "date": "2026-10-08", "added": "2026-10-09", "stance": "questions"}]
        paper = {"key": "P", "source": "openai-math", "url": "https://github.com/openai/math/P", "title": "P", "authors": ["C"],
                 "summary": "s", "domain": "Number theory", "origin": "ai-generated", "gone": True, "stars": 3, "pdf": "https://e.org/p.pdf",
                 "family": "017", "family_title": "F", "formalized": True, "withdrawn": True, "withdrawn_on": "2026-10-07", "verified": True,
                 "trust": "high", "ai_models": ["model"], "formalizes": [{"id": "arxiv/2610.20058"}], "formalizations": ["lean/o__r"],
                 "authorship": "human", "human_understanding": "all", "repo": "https://github.com/o/r", "json": "https://e.org/p.json",
                 "tags": ["t"], "published": "2026-10-01", "review": {"category": "research", "subject": "math.NT", "tags": ["u"]},
                 "discussion": links, "reception": {"text": "Refuted.", "written": "2026-10-09", "links": [links[0]["url"]],
                                                    "reviewed_by": "LionSR", "basis": index.basis(links)}}
        reply = {"key": "2610.20058", "source": "arxiv", "url": "https://arxiv.org/abs/2610.20058", "title": "Reply", "added": "2026-10-08"}
        app = index.app_entry({"id": "APP-260923-0000", "repo_url": "https://github.com/o/app", "versions": [
            {"title": "A", "authors": [{"name": "D"}], "paper_summary": "s", "tags": ["physics"], "domain": "hep-th", "listed_at": "2026-09-23"}]})
        self.assertEqual(set(index.PASSTHROUGH) - set(paper) - set(app), set(), "a served field this fixture leaves out")
        items = [index.to_item(e) for e in (paper, reply, app)]
        index.crosslink(items)
        self.assertEqual((items[0]["reception"]["reviewed_by"], items[0]["discussion"][1]["record"], items[1]["discusses"][0]["id"]),
                         ("LionSR", "arxiv/2610.20058", "openai-math/P"))  # the fixture reaches every part
        return items

    def check(self, items: list[dict]) -> None:
        record = {"$ref": "#/components/schemas/Record"}
        found = [p for it in items for p in self.problems(it, record, it.get("id", "?"))]
        self.assertFalse(found, "index.py serves records that do not fit the API's Record schema (fix site/lib/openapi.ts, then run "
                                "npm run openapi in site/):\n" + "\n".join(found[:20]))

    def test_built_items_fit_the_record_schema(self) -> None:
        self.check(self.built())

    def test_the_whole_build_fits_the_record_schema(self) -> None:
        built = self.ROOT / "dist" / "index.json"
        if not built.exists():
            self.skipTest("no dist/index.json: python3 index.py build")
        self.check(json.loads(built.read_text())["items"])

    def test_an_undocumented_field_is_caught(self) -> None:
        item = {**self.built()[0], "secret": 1, "stars": "3"}
        item["discussion"] = [{**item["discussion"][0], "stance": "likes"}]
        self.assertEqual(sorted(self.problems(item, {"$ref": "#/components/schemas/Record"}, "r")),
                         ["r.discussion[].stance: 'likes' is not one of ['refutes', 'questions', 'confirms', 'simplifies', 'extends', 'reacts']",
                          "r.secret: not in the schema", "r.stars: '3' is not integer"])


class Text(unittest.TestCase):
    def test_trim_keeps_words_whole(self) -> None:
        out = S.trim("word " * 300, 50)
        self.assertTrue(out.endswith("…"))
        self.assertLessEqual(len(out), 50)

    def test_iso_date(self) -> None:
        self.assertEqual(S.iso_date("2026/10/22"), "2026-10-22")
        self.assertEqual(S.iso_date("2026-10-22T14:06:26"), "2026-10-22")
        self.assertEqual(S.iso_date(None), "")


if __name__ == "__main__":
    unittest.main(verbosity=1)
