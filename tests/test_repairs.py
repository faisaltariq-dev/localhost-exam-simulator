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


def read_sample(*parts):
    with open(os.path.join(ROOT, "samples", *parts), encoding="utf-8") as f:
        return f.read()


class RepairsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = store.Store(self.dir)
        self.broken = read_sample("broken", "questions-and-answers-badchoices-demo-1.md")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def agent_queues(self, number, text, message):
        """What an agent does: write fixed.md and append one log line by hand."""
        folder = os.path.join(self.store.repairs_dir, "%03d" % number)
        with open(os.path.join(folder, "fixed.md"), "w", encoding="utf-8") as f:
            f.write(text)
        with open(self.store.repairs_log, "a", encoding="utf-8") as f:
            f.write("2026-10-27 21:30 · #%03d · agent · queued · %s" % (number, message))  # no newline, on purpose

    def test_send_creates_folder_and_log(self):
        sent = self.store.send_to_repairs(self.broken, "Q2 looked short")
        self.assertEqual(sent, {"id": 1, "folder": "repairs/001"})
        folder = os.path.join(self.store.repairs_dir, "001")
        self.assertEqual(sorted(os.listdir(folder)), ["exam.md", "reasons.txt"])
        with open(os.path.join(folder, "reasons.txt"), encoding="utf-8") as f:
            self.assertIn("Q2: found 3 choices", f.read())
        status = self.store.repairs_status()
        self.assertEqual((status["inbox"], status["queue"]), ([1], []))
        latest = status["items"][0]["latest"]
        self.assertEqual((latest["who"], latest["event"], latest["message"]), ("owner", "sent", "Q2 looked short"))

    def test_valid_exam_is_refused_unless_it_clashes(self):
        with self.assertRaises(StoreError):
            self.store.send_to_repairs(read_sample(SAMPLE))
        self.store.import_exam(SAMPLE, read_sample(SAMPLE))
        with self.assertRaises(StoreError):  # identical: already in the library
            self.store.send_to_repairs(read_sample(SAMPLE))
        changed = read_sample(SAMPLE).replace("Answer: B\nDomain: D1", "Answer: A\nDomain: D1", 1)
        self.assertEqual(self.store.send_to_repairs(changed)["id"], 1)  # same ID, different questions

    def test_queue_then_approve_loads_and_closes(self):
        self.store.send_to_repairs(self.broken)
        self.agent_queues(1, read_sample(SAMPLE), "Q2 was missing choice D; restored from the explanation")
        status = self.store.repairs_status()
        self.assertEqual((status["inbox"], status["queue"]), ([], [1]))
        self.assertTrue(status["items"][0]["fix_ready"])
        loaded = self.store.approve_repair(1)
        self.assertEqual(loaded["id"], "sample-demo-1")
        status = self.store.repairs_status()
        self.assertEqual((status["inbox"], status["queue"], status["items"]), ([], [], []))
        self.assertEqual(status["log"][-1]["event"], "approved")  # kept in the log
        self.assertTrue(os.path.isdir(os.path.join(self.store.repairs_dir, "001")))  # never deleted by the app

    def test_failed_approve_is_logged_and_stays_queued(self):
        self.store.import_exam(SAMPLE, read_sample(SAMPLE))
        changed = read_sample(SAMPLE).replace("Answer: B\nDomain: D1", "Answer: A\nDomain: D1", 1)
        self.store.send_to_repairs(changed)
        self.agent_queues(1, changed, "looks fine to me")
        with self.assertRaises(StoreError):
            self.store.approve_repair(1)
        item = self.store.repairs_status()["items"][0]
        self.assertEqual((item["where"], item["latest"]["who"], item["latest"]["event"]), ("queue", "app", "failed"))

    def test_reject_keeps_the_fix_and_returns_to_inbox(self):
        self.store.send_to_repairs(self.broken)
        self.agent_queues(1, read_sample(SAMPLE), "first try")
        self.store.reject_repair(1, "you changed an answer")
        folder = os.path.join(self.store.repairs_dir, "001")
        self.assertIn("fixed-rejected-1.md", os.listdir(folder))
        self.assertNotIn("fixed.md", os.listdir(folder))
        status = self.store.repairs_status()
        self.assertEqual((status["inbox"], status["items"][0]["latest"]["message"]), ([1], "you changed an answer"))

    def agent_proposes_delete(self, number, message):
        with open(self.store.repairs_log, "a", encoding="utf-8") as f:
            f.write("2026-10-27 22:40 · #%03d · agent · queued-delete · %s\n" % (number, message))

    def test_delete_proposal_approved_moves_folder_to_trash(self):
        self.store.send_to_repairs(self.broken)
        self.agent_proposes_delete(1, "owner asked to delete it")
        status = self.store.repairs_status()
        self.assertEqual((status["queue"], status["items"][0]["kind"]), ([1], "delete"))
        result = self.store.approve_repair(1)
        self.assertEqual(result["moved_to"], "repairs/trash/001")
        self.assertFalse(os.path.exists(os.path.join(self.store.repairs_dir, "001")))
        self.assertTrue(os.path.isfile(os.path.join(self.store.repairs_dir, "trash", "001", "exam.md")))
        self.assertEqual(self.store.repairs_status()["items"], [])
        self.assertEqual(self.store.send_to_repairs(self.broken)["id"], 2)  # trashed numbers are not reused

    def test_delete_proposal_rejected_goes_back_to_inbox(self):
        self.store.send_to_repairs(self.broken)
        self.agent_proposes_delete(1, "not worth fixing")
        self.store.reject_repair(1, "keep it, I'll regenerate")
        item = self.store.repairs_status()["items"][0]
        self.assertEqual((item["where"], item["kind"], item["latest"]["message"]), ("inbox", "fix", "keep it, I'll regenerate"))
        self.assertTrue(os.path.isdir(os.path.join(self.store.repairs_dir, "001")))

    def test_notes_only_on_inbox_items_and_do_not_change_state(self):
        self.store.send_to_repairs(self.broken)
        self.store.note_repair(1, "import it as -3")
        item = self.store.repairs_status()["items"][0]
        self.assertEqual((item["state"], item["latest"]["event"]), ("sent", "note"))
        self.agent_queues(1, read_sample(SAMPLE), "done")
        with self.assertRaises(StoreError):
            self.store.note_repair(1, "too late")
        with self.assertRaises(StoreError):
            self.store.note_repair(99, "no such item")

    def test_numbers_never_repeat_after_manual_delete(self):
        self.store.send_to_repairs(self.broken)
        shutil.rmtree(os.path.join(self.store.repairs_dir, "001"))  # owner deletes by hand
        self.assertEqual(self.store.repairs_status()["items"], [])
        self.assertEqual(self.store.send_to_repairs(self.broken)["id"], 2)

    def test_log_parsing_is_lenient_and_keeps_odd_lines(self):
        entries = store.parse_log("2026-10-27 21:30 ·  #7·agent· declined ·same ID, delete it?\nrandom text\n")
        self.assertEqual((entries[0]["id"], entries[0]["event"], entries[0]["message"]), (7, "declined", "same ID, delete it?"))
        self.assertEqual((entries[1]["id"], entries[1]["message"]), (None, "random text"))


if __name__ == "__main__":
    unittest.main()
