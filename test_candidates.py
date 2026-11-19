"""Tests for candidates.py, offline: no source is fetched."""

import datetime as dt
import tempfile
import unittest
from pathlib import Path

import candidates as C
import sources as S


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

    def test_a_text_is_matched_against_the_records_of_the_labs_it_names_in_full(self):
        lab = lambda full: C.candidate("u", "", [], "", "", "arXiv", full=full)["labs"]  # noqa: E731
        self.assertEqual(lab("OpenAI's proof, checked with Claude"), ["anthropic-science", "lean", "openai-math"])
        self.assertEqual(lab("hexagonal boron nitride, an open AI question, and GPTs"), [])
        self.assertEqual(self.m.match("Ryser's covering conjecture for intersecting tripartite hypergraphs", ["openai-math"]), [])

    def test_a_link_already_attached_is_known_for_that_record_only(self):
        entries = [{**ENTRIES[0], "discussion": [{"url": "https://arxiv.org/abs/2610.01234v2"}, {"url": "https://mathoverflow.net/questions/1/x#a2"}]}]
        known = C.attached(entries)
        rid = "openai-math/A-counterexample-to-Sidorenkos-conjecture"
        self.assertIn((rid, S.identity("http://www.arxiv.org/pdf/2610.01234v3.pdf")), known)
        self.assertIn((rid, S.identity("https://mathoverflow.net/questions/1/x?r=1")), known)
        self.assertNotIn(("openai-math/Siegel-zeros", S.identity("https://arxiv.org/abs/2610.01234")), known)
        blog = "https://www.math.columbia.edu/~woit/wordpress/?p=15979"
        self.assertEqual(S.identity(blog + "&utm_source=rss#:~:text=Witten"), S.identity(blog))
        self.assertNotEqual(S.identity(blog), S.identity(blog.replace("15979", "15957")))
        folder = "The-periodic-spin-one-Haldane-gap-September-24-2026"
        self.assertEqual({S.identity(f"https://github.com/openai/math/blob/fd4aeeb/preprints/{folder}/paper.pdf"),
                          S.identity(f"https://mathcommunity.github.io/oai-math-revised/papers/{folder}/")}, {"openai-math/The-periodic-spin-one-Haldane-gap"})

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
            Path(d, "2026-11-06.md").write_text("  `python3 index.py discuss arxiv/2610.09093 'https://example.org/today'`\n")
            seen = C.reported(Path(d), *WEEK)
        self.assertEqual(seen, {("openai-math/Siegel-zeros", "arxiv/2610.00002")})
        text = C.report(cands, self.m, {"arxiv/2610.09093": CRAIG}, seen, *WEEK, ["MathOverflow (down)"])
        self.assertIn("python3 index.py discuss openai-math/Siegel-zeros https://arxiv.org/abs/2610.00001", text)
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

    def test_a_citing_paper_counts_when_its_abstract_names_the_cited_work_but_not_its_own(self):
        ref = lambda arxiv, *names: {"reference": {"arxiv_eprint": arxiv, "authors": [{"full_name": n} for n in names]}}  # noqa: E731
        witten = {"arxiv_eprints": [{"value": "2611.05051"}], "titles": [{"title": "A Note On Lattice Definition"}], "authors": [{"full_name": "Witten, Edward"}],
                  "abstracts": [{"value": "Recently, an algorithm has been described by Craig. Witten and Yonekura found the eta-invariant earlier."}],
                  "references": [ref("2610.09093", "Craig, N."), ref("1909.08775", "Witten, E.", "Yonekura, K."), ref("2610.29019", "Hsu, S.D.H.")]}
        (got,) = C.citing([C.inspire_paper(witten), None])
        self.assertEqual([got["url"], got["records"], got["how"]], ["https://arxiv.org/abs/2611.05051", ["arxiv/2610.09093"], "cites"])

if __name__ == "__main__":
    unittest.main()
