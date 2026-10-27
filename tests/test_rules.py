import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import store  # noqa: E402
from store import StoreError  # noqa: E402

SAMPLE = "questions-and-answers-sample-demo-1.md"
CORRECT = {"1": "B", "2": "B", "3": "A", "4": "C", "5": "D", "6": "A"}


def read_sample(*parts):
    with open(os.path.join(ROOT, "samples", *parts), encoding="utf-8") as f:
        return f.read()


def attempt(number, score, paused=False, overtime=False):
    return {"number": number, "score_percent": score, "paused": paused, "overtime": overtime}


class GreenRuleTest(unittest.TestCase):
    def test_no_attempts(self):
        self.assertIsNone(store.green_attempt([], 70))

    def test_highest_clean_above_pass_is_green(self):
        self.assertEqual(store.green_attempt([attempt(1, 60), attempt(2, 80), attempt(3, 75)], 70), 2)

    def test_highest_paused_blocks_green(self):
        self.assertIsNone(store.green_attempt([attempt(1, 78), attempt(2, 82, paused=True)], 70))

    def test_highest_overtime_blocks_green(self):
        self.assertIsNone(store.green_attempt([attempt(1, 78), attempt(2, 82, overtime=True)], 70))

    def test_highest_below_pass_mark(self):
        self.assertIsNone(store.green_attempt([attempt(1, 50), attempt(2, 66)], 70))

    def test_exactly_pass_mark_counts(self):
        self.assertEqual(store.green_attempt([attempt(1, 70.0)], 70), 1)

    def test_tie_goes_to_most_recent_clean(self):
        attempts = [attempt(1, 80), attempt(2, 80), attempt(3, 80, paused=True)]
        self.assertEqual(store.green_attempt(attempts, 70), 2)

    def test_pass_mark_change_re_evaluates(self):
        attempts = [attempt(1, 75)]
        self.assertEqual(store.green_attempt(attempts, 70), 1)
        self.assertIsNone(store.green_attempt(attempts, 80))


class ScoringTest(unittest.TestCase):
    def setUp(self):
        import converter
        self.exam = converter.parse_exam(SAMPLE, read_sample(SAMPLE)).exam

    def test_all_correct(self):
        correct, total, pct, domains = store.score_attempt(self.exam, CORRECT)
        self.assertEqual((correct, total, pct), (6, 6, 100.0))
        self.assertEqual(domains, {"D1": {"correct": 2, "total": 2}, "D2": {"correct": 2, "total": 2},
                                   "D3": {"correct": 2, "total": 2}})

    def test_unanswered_counts_as_wrong(self):
        answers = dict(CORRECT, **{"2": None, "4": "A"})
        correct, total, pct, domains = store.score_attempt(self.exam, answers)
        self.assertEqual((correct, total, pct), (4, 6, 66.7))
        self.assertEqual(domains["D2"], {"correct": 1, "total": 2})
        self.assertEqual(domains["D3"], {"correct": 1, "total": 2})

    def test_overtime(self):
        self.assertFalse(store.is_overtime(600, 10))
        self.assertTrue(store.is_overtime(601, 10))


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = store.Store(self.dir)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def import_sample(self):
        return self.store.import_exam(SAMPLE, read_sample(SAMPLE))

    def test_import_then_duplicate_rejected(self):
        info = self.import_sample()
        self.assertEqual((info["id"], info["question_count"], info["domain_count"]), ("sample-demo-1", 6, 3))
        with self.assertRaises(StoreError) as cm:
            self.import_sample()
        self.assertEqual(cm.exception.status, 409)

    def test_same_exam_with_different_hyphenation_is_a_duplicate(self):
        text = read_sample("questions-and-answers-sample-cloud-data-1.md")
        self.assertEqual(self.store.import_exam("questions-and-answers-sample-cloud-data-1.md", text)["id"],
                         "sample-clouddata-1")
        with self.assertRaises(StoreError) as cm:
            self.store.import_exam("questions-and-answers-sample-clouddata-1.md", text)
        self.assertEqual(cm.exception.status, 409)

    def test_bad_filename_and_invalid_write_nothing(self):
        with self.assertRaises(StoreError) as cm:
            self.store.import_exam("exam.md", read_sample(SAMPLE))
        self.assertEqual(cm.exception.status, 400)
        name = "questions-and-answers-badchoices-demo-1.md"
        with self.assertRaises(StoreError) as cm:
            self.store.import_exam(name, read_sample("broken", name))
        self.assertEqual(cm.exception.status, 422)
        self.assertEqual(os.listdir(self.store.raw_dir), [])
        self.assertEqual(self.store.exam_ids(), [])

    def test_attempt_scoring_and_green(self):
        self.import_sample()
        a = self.store.add_attempt("sample-demo-1", {
            "duration_minutes": 10, "elapsed_seconds": 300, "paused": False,
            "answers": dict(CORRECT, **{"6": "B"}), "bookmarks": [2, 99], "notes": {"2": "check", "3": "  "}})
        self.assertEqual((a["number"], a["correct"], a["score_percent"]), (1, 5, 83.3))
        self.assertEqual(a["domain_scores"]["D1"], {"correct": 1, "total": 2})
        self.assertEqual(a["bookmarks"], [2])
        self.assertEqual(a["notes"], {"2": "check"})
        self.assertFalse(a["overtime"])
        summary = self.store.exam_summaries()[0]
        self.assertEqual((summary["attempt_count"], summary["green_attempt"]), (1, 1))

        b = self.store.add_attempt("sample-demo-1", {
            "duration_minutes": 10, "elapsed_seconds": 700, "paused": False, "answers": CORRECT})
        self.assertTrue(b["overtime"])
        self.assertIsNone(self.store.exam_summaries()[0]["green_attempt"])

    def test_revised_flag(self):
        self.import_sample()
        self.store.add_attempt("sample-demo-1", {"duration_minutes": 10, "elapsed_seconds": 1, "answers": {}})
        self.assertTrue(self.store.set_revised("sample-demo-1", 1, True)["revised"])
        with self.assertRaises(StoreError):
            self.store.set_revised("sample-demo-1", 2, True)

    def test_settings_validation_and_override(self):
        self.import_sample()
        s = self.store.update_settings({"theme": "dark", "duration_overrides": {"sample-demo-1": 1}})
        self.assertEqual((s["theme"], s["duration_overrides"]), ("dark", {"sample-demo-1": 1}))
        self.assertEqual(self.store.exam_for_client("sample-demo-1")["duration_minutes"], 1)
        s = self.store.update_settings({"duration_overrides": {"sample-demo-1": 10}})
        self.assertEqual(s["duration_overrides"], {})
        with self.assertRaises(StoreError) as cm:
            self.store.update_settings({"style": "fancy", "pass_mark_percent": 0})
        self.assertEqual(len(cm.exception.errors), 2)

    def test_delete_removes_files_and_override(self):
        self.import_sample()
        self.store.update_settings({"duration_overrides": {"sample-demo-1": 5}})
        self.store.add_attempt("sample-demo-1", {"duration_minutes": 5, "elapsed_seconds": 1, "answers": {}})
        self.store.delete_exam("sample-demo-1")
        self.assertEqual(self.store.exam_ids(), [])
        self.assertEqual(os.listdir(self.store.raw_dir), [])
        self.assertEqual(os.listdir(self.store.attempts_dir), [])
        s = self.store.load_settings()
        self.assertEqual(s["duration_overrides"], {})

    def test_bad_ids_never_touch_disk(self):
        for bad in ("../etc", "a-b", "x-y-0", ""):
            with self.assertRaises(StoreError):
                self.store.load_exam(bad)


if __name__ == "__main__":
    unittest.main()
