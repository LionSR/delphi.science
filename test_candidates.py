"""Tests for candidates.py, offline: arXiv and MathOverflow are stubbed."""

import datetime as dt
import unittest

import candidates as C


def rec(source, key, title, **kw):
    return {"source": source, "key": key, "title": title, **kw}


ENTRIES = [
    rec("openai-math", "A-counterexample-to-Sidorenkos-conjecture", "A counterexample to Sidorenko's conjecture", family="161"),
    rec("openai-math", "A-counterexample-to-Sidorenkos-conjecture-v2", "A counterexample to Sidorenko's conjecture (revised)", family="161"),
    rec("openai-math", "Siegel-zeros", "Exceptional characters and Siegel zeros of Dirichlet L-functions"),
    rec("hexagon", "HEX-1", "Ryser's covering conjecture for intersecting tripartite hypergraphs"),
]


class Matching(unittest.TestCase):
    def setUp(self):
        self.m = C.Matcher(ENTRIES)

    def test_response_matches_its_record_once_per_family(self):
        got = self.m.match("A short human proof of OpenAI's counterexample to Sidorenko's conjecture. We give a readable account.")
        self.assertEqual([e["family"] for _, e in got], ["161"])

    def test_unrelated_abstract_matches_nothing(self):
        self.assertEqual(self.m.match("Large language models as tutors in undergraduate calculus: a survey from OpenAI users"), [])

    def test_urls_normalise(self):
        self.assertEqual(C.norm("http://www.arxiv.org/pdf/2610.01234v3.pdf"), "https://arxiv.org/abs/2610.01234")
        self.assertEqual(C.norm("https://mathoverflow.net/questions/1/x?r=1#a2"), "https://mathoverflow.net/questions/1/x")

    def test_report_lists_commands_and_survives_a_source_down(self):
        cands = [{"url": "https://arxiv.org/abs/2610.00001", "title": "Siegel zeros after OpenAI", "authors": ["A. Person"], "date": "2026-10-20",
                  "where": "arXiv", "text": "We check the argument on exceptional characters and Siegel zeros of Dirichlet L-functions."}]
        text = C.report(cands, self.m, dt.date(2026, 10, 19), dt.date(2026, 10, 25), ["MathOverflow (down)"])
        self.assertIn("python3 index.py discuss openai-math/Siegel-zeros https://arxiv.org/abs/2610.00001", text)
        self.assertIn("Not searched: MathOverflow", text)


if __name__ == "__main__":
    unittest.main()
