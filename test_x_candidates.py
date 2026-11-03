"""Tests for x_candidates.py, offline: the X API is stubbed."""

import datetime as dt
import io
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import x_candidates as X

ENTRIES = [
    {"source": "openai-math", "key": "The-Unique-Games-Theorem", "title": "The Unique Games Theorem",
     "url": "https://github.com/openai/math/tree/main/preprints/The-Unique-Games-Theorem-September-23-2026"},
    {"source": "lean", "key": "anthropics__formal-math__eth", "title": "A 2^o(n) Time Algorithm for 3-SAT",
     "url": "https://github.com/anthropics/formal-math/tree/main/eth"},
    {"source": "lean", "key": "anthropics__formal-math__3sum-apsp", "title": "3SUM and APSP",
     "url": "https://github.com/anthropics/formal-math/tree/main/3sum-apsp",
     "discussion": [{"kind": "x", "url": "https://x.com/old/status/7"}]},
    {"source": "hexagon", "key": "2610.00577", "title": "A 2^o(n) Time Algorithm for 3-SAT", "url": "https://hexagonmath.org/abs/2610.00577v1"},
]


def reply(*tweets):
    users = [{"id": "u1", "name": "Ada Prof", "username": "ada", "description": "Professor of mathematics, Some University",
              "public_metrics": {"followers_count": 900}},
             {"id": "u2", "name": "Hype", "username": "hype", "description": "AI news daily", "public_metrics": {"followers_count": 90000}}]
    return {"data": list(tweets), "includes": {"users": users}}


def tweet(i, author="u1", urls=(), retweet=False):
    t = {"id": str(i), "author_id": author, "text": f"post {i}", "created_at": "2026-11-02T10:00:00.000Z",
         "entities": {"urls": [{"expanded_url": u} for u in urls]}}
    if retweet:
        t["referenced_tweets"] = [{"type": "retweeted", "id": "1"}]
    return t


class Matching(unittest.TestCase):
    def setUp(self):
        self.r = X.Records(ENTRIES)

    def test_a_link_names_its_record_by_folder_mirror_or_url(self):
        self.assertEqual(self.r.linked("https://github.com/openai/math/blob/main/preprints/The-Unique-Games-Theorem-September-23-2026/paper.pdf"),
                         "openai-math/The-Unique-Games-Theorem")
        self.assertEqual(self.r.linked("https://mathcommunity.github.io/oai-math-revised/papers/The-Unique-Games-Theorem-September-23-2026/"),
                         "openai-math/The-Unique-Games-Theorem")
        self.assertEqual(self.r.linked("https://github.com/anthropics/formal-math/blob/main/eth/paper.pdf"), "lean/anthropics__formal-math__eth")
        self.assertEqual(self.r.linked("https://hexagonmath.org/abs/2610.00577v2"), "hexagon/2610.00577")
        self.assertIsNone(self.r.linked("https://github.com/anthropics/formal-math/tree/main/ethics"))
        self.assertIsNone(self.r.linked("https://example.com/news"))

    def test_posts_take_the_query_s_records_and_their_links_and_skip_retweets(self):
        got = X.posts(reply(tweet(1, urls=["https://github.com/anthropics/formal-math/tree/main/eth"]), tweet(2, retweet=True), tweet(3, "u2")),
                      ["openai-math/The-Unique-Games-Theorem"], self.r)
        self.assertEqual([p["id"] for p in got], ["1", "3"])
        self.assertEqual(got[0]["records"], ["openai-math/The-Unique-Games-Theorem", "lean/anthropics__formal-math__eth"])
        self.assertTrue(got[0]["researcher"])
        self.assertFalse(got[1]["researcher"])
        self.assertEqual(got[0]["url"], "https://x.com/ada/status/1")

    def test_a_post_about_no_record_is_dropped(self):
        self.assertEqual(X.posts(reply(tweet(4, urls=["https://example.com"])), [], self.r), [])


class Run(unittest.TestCase):
    def test_report_has_commands_leaves_out_attached_posts_and_survives_a_failed_query(self):
        calls = []

        def search(query, start, n, token):
            calls.append(query)
            if len(calls) == 2:
                raise X.S.SourceError("X API HTTP 429")
            return reply(tweet(5, urls=["https://github.com/anthropics/formal-math/tree/main/3sum-apsp"]), tweet(7))

        out = io.StringIO()
        with patch.dict(os.environ, {"X_BEARER_TOKEN": "t"}), patch.object(X, "lab_entries", return_value=ENTRIES), \
                patch.object(X, "search", search), redirect_stdout(out):
            self.assertEqual(X.main(["--days", "3"]), 0)
        text = out.getvalue()
        self.assertEqual(len(calls), len(X.QUERIES))
        self.assertIn("python3 index.py discuss lean/anthropics__formal-math__3sum-apsp https://x.com/ada/status/5", text)
        self.assertNotIn("status/7`", text)  # already attached
        self.assertIn("Not searched: X API HTTP 429", text)

    def test_no_token_no_search(self):
        with patch.dict(os.environ, {"X_BEARER_TOKEN": ""}), patch.object(X, "search", side_effect=AssertionError("searched")):
            self.assertEqual(X.main([]), 2)

    def test_queries_fit_the_api_limit(self):
        for q, about in X.QUERIES:
            self.assertLessEqual(len(q + X.NOT_RETWEETS), 512, q)


if __name__ == "__main__":
    unittest.main()
