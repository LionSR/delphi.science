"""Tests for candidates.py, offline: no source is fetched."""

import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import candidates as C  # noqa: E402


def rec(source, key, title, **kw):
    return {"source": source, "key": key, "title": title, **kw}


ENTRIES = [
    rec("openai-math", "A-counterexample-to-Sidorenkos-conjecture", "A counterexample to Sidorenko's conjecture", family="161"),
    rec("openai-math", "A-counterexample-to-Sidorenkos-conjecture-v2", "A counterexample to Sidorenko's conjecture (revised)", family="161"),
    rec("openai-math", "Siegel-zeros", "Exceptional characters and Siegel zeros of Dirichlet L-functions"),
    rec("hexagon", "HEX-1", "Ryser's covering conjecture for intersecting tripartite hypergraphs"),
]
CRAIG = rec("arxiv", "2610.09093", "A gauge-invariant measure for lattice chiral fermions")
WEEK = dt.date(2026, 11, 1), dt.date(2026, 11, 6)


class Matching(unittest.TestCase):
    def setUp(self):
        self.m = C.Matcher(ENTRIES)

    def test_response_matches_its_record_once_per_family(self):
        got = self.m.match("A short human proof of OpenAI's counterexample to Sidorenko's conjecture. We give a readable account.", ["openai-math"])
        self.assertEqual([e["family"] for _, e in got], ["161"])

    def test_unrelated_abstract_matches_nothing(self):
        self.assertEqual(self.m.match("Large language models as tutors in undergraduate calculus: a survey from OpenAI users", ["openai-math"]), [])


    def test_report_lists_new_commands_named_records_first_and_survives_a_source_down(self):
        siegel = "We check the argument on exceptional characters and Siegel zeros of Dirichlet L-functions."
        woit = "https://www.math.columbia.edu/~woit/wordpress/?p=15979"
        cands = [C.candidate("https://arxiv.org/abs/2610.00001", "Siegel zeros after OpenAI", ["A. Person"], "2026-10-20", siegel, "arXiv",
                             full=f"Siegel zeros after OpenAI {siegel}"),
                 C.candidate("https://arxiv.org/abs/2610.00002", "Siegel zeros again", ["B. Person"], "2026-10-21", siegel, "arXiv",
                             full=f"OpenAI {siegel}"),
                 C.candidate(woit, "New Morning", ["Peter Woit"], "2026-11-04", "On top of this, there's a new paper.", "Not Even Wrong",
                             records=["arxiv/2610.09093"], author="Peter Woit")]
        with tempfile.TemporaryDirectory() as d:
            earlier = Path(d, "2026-11-03.md")
            earlier.write_text("  `python3 index.py discuss openai-math/Siegel-zeros https://arxiv.org/abs/2610.00002`\n")
            Path(d, "2026-11-04.md").write_text("  `python3 indexer/index.py discuss hexagon/HEX-1 https://example.org/prev`\n")
            Path(d, "2026-11-06.md").write_text("  `python3 indexer/index.py discuss arxiv/2610.09093 'https://example.org/today'`\n")
            seen = C.reported(Path(d), *WEEK)
        self.assertEqual(seen, {("openai-math/Siegel-zeros", "arxiv/2610.00002"), ("hexagon/HEX-1", "https://example.org/prev")})
        text = C.report(cands, self.m, {"arxiv/2610.09093": CRAIG}, seen, *WEEK, ["MathOverflow (down)"])
        self.assertIn("python3 indexer/index.py discuss openai-math/Siegel-zeros https://arxiv.org/abs/2610.00001", text)
        self.assertNotIn("2610.00002", text)
        self.assertLess(text.index("- links `arxiv/2610.09093`"), text.index("- title "))
        self.assertIn(f"discuss arxiv/2610.09093 '{woit}' --author 'Peter Woit'", text)
        self.assertIn("Not searched: MathOverflow", text)


class Finding(unittest.TestCase):
    def test_feed_posts_name_the_records_they_link(self):
        rss = b"""<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
            <item><title>New Morning</title><link>https://example.org/?p=1</link><dc:creator>woit</dc:creator>
            <pubDate>Wed, 04 Nov 2026 15:31:00 +0000</pubDate><content:encoded><![CDATA[A <a href="https://arxiv.org/abs/2611.05051v1">new paper</a>,
            after arXiv:2610.09093 and <a href="https://example.org/about">this</a>.]]></content:encoded></item></channel></rss>"""
        atom = b"""<feed xmlns="http://www.w3.org/2005/Atom"><author><name>Asaf Karagila</name></author><entry><title>Choice</title>
            <link rel="alternate" href="https://karagila.org/2026/choice/"/><published>2026-11-02T08:00:00Z</published>
            <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">See <a href="https://arxiv.org/html/2610.09093v1#S2">section 2</a>.</div></content></entry></feed>"""
        (post,), (entry,) = C.posts(rss), C.posts(atom)
        self.assertEqual([post["author"], post["date"], C.named(post["body"])], ["woit", "2026-11-04", ["arxiv/2611.05051", "arxiv/2610.09093", *C.linked_ids(["https://example.org/about"])]])
        self.assertEqual([entry["link"], entry["author"], entry["date"], C.named(entry["body"])],
                         ["https://karagila.org/2026/choice/", "Asaf Karagila", "2026-11-02", ["arxiv/2610.09093"]])

    def test_web_links_resolve_custom_and_legacy_web_records_by_url(self):
        self.assertEqual(C.linked_ids(["https://alpo.ge/remark.pdf#page=1"]), ["https://alpo.ge/remark.pdf"])
        cand = C.candidate("https://blog.example.org/note", "On the proof", ["A. Author"], "2026-11-21", "Details.", "Blog",
                           records=C.linked_ids(["https://alpo.ge/remark.pdf"]))
        web_rec = rec("web", "alpoge-riemann-hypothesis", "Proof of the Riemann Hypothesis", url="https://alpo.ge/remark.pdf")
        text = C.report([cand], self.m if hasattr(self, "m") else C.Matcher([]), {"https://alpo.ge/remark.pdf": web_rec}, set(), *WEEK, [])
        self.assertIn("discuss web/alpoge-riemann-hypothesis https://blog.example.org/note", text)

    def test_a_citing_paper_counts_when_its_abstract_names_the_cited_work_but_not_its_own(self):
        ref = lambda arxiv, *names: {"reference": {"arxiv_eprint": arxiv, "authors": [{"full_name": n} for n in names]}}  # noqa: E731
        witten = {"arxiv_eprints": [{"value": "2611.05051"}], "titles": [{"title": "A Note On Lattice Definition"}], "authors": [{"full_name": "Witten, Edward"}],
                  "abstracts": [{"value": "Recently, an algorithm has been described by Craig. Witten and Yonekura found the eta-invariant earlier."}],
                  "references": [ref("2610.09093", "Craig, N."), ref("1909.08775", "Witten, E.", "Yonekura, K."), ref("2610.29019", "Hsu, S.D.H.")]}
        (got,) = C.citing([C.inspire_paper(witten), None])
        self.assertEqual([got["url"], got["records"], got["how"]], ["https://arxiv.org/abs/2611.05051", ["arxiv/2610.09093"], "cites"])

if __name__ == "__main__":
    unittest.main()
