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
        "https://github.com/SakanaAI/AI-Scientist/blob/main/example_papers/rl_lr_adaptation.pdf": ("ai-scientist", "rl_lr_adaptation"),
        "https://arxiv.org/abs/1706.03762v7": ("arxiv", "1706.03762"),
        "arXiv:2406.01234": ("arxiv", "2406.01234"),
        "2406.01234": ("arxiv", "2406.01234"),
        "https://zenodo.org/records/123456": ("zenodo", "123456"),
        "10.5281/zenodo.123456": ("zenodo", "123456"),
        "10.1038/nature14539": ("doi", "10.1038__nature14539"),
        "https://doi.org/10.1101/2024.01.01.123456": ("doi", "10.1101__2024.01.01.123456"),
        "https://huggingface.co/datasets/openai/gsm8k": ("huggingface", "datasets__openai__gsm8k"),
        "https://huggingface.co/meta-llama/Llama-3-8B": ("huggingface", "models__meta-llama__Llama-3-8B"),
        "https://www.clawxiv.org/abs/clawxiv.2610.00001": ("clawxiv", "clawxiv.2610.00001"),
        "https://aixiv.science/abs/aixiv.261022.000005": ("aixiv", "aixiv.261022.000005"),
        "https://ai.vixra.org/abs/2610.0054": ("aivixra", "2610.0054"),
        "https://jaigp.org/paper/105": ("jaigp", "105"),
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
        self.assertNotIn("github:o__r", ids)
        self.assertEqual(ids["github:o__s"]["category"], "fiction")

    def test_unlabelled_counts_as_research(self) -> None:
        index.save(index.path_for("github", "o__r"), self.entry())
        it = next(i for i in index.items([e for _, e in index.load()]) if i["id"] == "github:o__r")
        self.assertEqual(it["category"], "research")


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
