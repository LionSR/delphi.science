#!/usr/bin/env python3
"""Offline tests: source detection, duplicate checks, build filtering. No network.

    python test_index.py
"""

from __future__ import annotations

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
        return {"key": "o__r", "source": "github", "url": "https://github.com/o/r", "title": "r", **kw}

    def test_new_entry_passes(self) -> None:
        self.assertEqual(index.check(self.entry()), [])

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
            "handle": "AndrewLott1331", "text": "Did you notice that the bound is weaker? Still gets Erdős Turán", "date": "2026-10-08",
        })

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

    def test_discussion_is_served(self) -> None:
        e = {"key": "k", "source": "web", "url": "https://e.org/p", "title": "T", "discussion": [{"kind": "x", "url": "https://x.com/a/status/1", "text": "hi"}]}
        self.assertEqual(index.to_item(e)["discussion"], e["discussion"])


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
