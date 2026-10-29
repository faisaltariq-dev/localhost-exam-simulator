import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import converter  # noqa: E402

SAMPLES = os.path.join(ROOT, "samples")
VALID = "questions-and-answers-sample-demo-1.md"

# broken sample file -> substrings that must all appear in the reported errors
BROKEN = {
    "questions-and-answers-badheader-demo-1.md": ["Header: domain_count is missing"],
    "questions-and-answers-badsections-demo-1.md": ['"# Questions" appears 2 times'],
    "questions-and-answers-baddomains-demo-1.md": ["Domains: listed 2 but domain_count is 3"],
    "questions-and-answers-badchoices-demo-1.md": ["Q2: found 3 choices, need 4"],
    "questions-and-answers-badanswers-demo-1.md": ["Answers: missing Q3"],
    "questions-and-answers-badletter-demo-1.md": ['Q5: answer "E" is not A–D'],
    "questions-and-answers-baddomainref-demo-1.md": ['Q4: domain "D9" is not in # Domains'],
    "questions-and-answers-badexplanation-demo-1.md": ["Q5: explanation is empty"],
    "questions-and-answers-badmany-demo-1.md": [
        "Q2: found 3 choices, need 4",
        'Q5: answer "E" is not A–D',
    ],
}


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


class ValidSampleTest(unittest.TestCase):
    def setUp(self):
        self.result = converter.parse_exam(VALID, read(SAMPLES, VALID))

    def test_parses_without_errors(self):
        self.assertEqual(self.result.errors, [])

    def test_header_fields(self):
        e = self.result.exam
        self.assertEqual(e["id"], "sample-demo-1")
        self.assertEqual((e["exam_maker"], e["exam_name"], e["exam_number"]), ("sample", "demo", 1))
        self.assertEqual(e["duration_minutes"], 10)
        self.assertEqual(e["source_file"], VALID)

    def test_domains(self):
        self.assertEqual([d["id"] for d in self.result.exam["domains"]], ["D1", "D2", "D3"])
        self.assertEqual(self.result.exam["domains"][0]["name"], "Data Ingestion and Preparation")

    def test_questions(self):
        qs = self.result.exam["questions"]
        self.assertEqual([q["number"] for q in qs], [1, 2, 3, 4, 5, 6])
        for q in qs:
            self.assertEqual([c["label"] for c in q["choices"]], ["A", "B", "C", "D"])
            self.assertTrue(q["text"] and q["explanation"])
        self.assertEqual([q["answer"] for q in qs], ["B", "B", "A", "C", "D", "A"])
        self.assertEqual([q["domain"] for q in qs], ["D1", "D2", "D2", "D3", "D3", "D1"])

    def test_code_block_kept_in_question_text(self):
        q2 = self.result.exam["questions"][1]
        self.assertIn("```sql", q2["text"])
        self.assertIn("WHERE order_date", q2["text"])

    def test_multiline_explanation(self):
        self.assertIn("\nA waits until 06:00", self.result.exam["questions"][0]["explanation"])


class BrokenSamplesTest(unittest.TestCase):
    def test_every_broken_file_is_covered(self):
        self.assertEqual(sorted(os.listdir(os.path.join(SAMPLES, "broken"))), sorted(BROKEN))

    def test_each_broken_file_reports_its_errors(self):
        for name, expected in BROKEN.items():
            with self.subTest(name=name):
                result = converter.parse_exam(name, read(SAMPLES, "broken", name))
                self.assertIsNone(result.exam)
                joined = "\n".join(result.errors)
                for fragment in expected:
                    self.assertIn(fragment, joined)


class LenientParsingTest(unittest.TestCase):
    def setUp(self):
        self.text = read(SAMPLES, VALID)

    def test_pasted_reply_with_filename_line_and_wrapping_fence(self):
        wrapped = VALID + "\n\n```markdown\n" + self.text + "\n```\n"
        self.assertTrue(converter.parse_exam(VALID, wrapped).ok)

    def test_windows_line_endings_and_bom(self):
        self.assertTrue(converter.parse_exam(VALID, "﻿" + self.text.replace("\n", "\r\n")).ok)

    def test_bold_labels_and_choice_variants(self):
        text = (self.text.replace("Answer: B\nDomain: D1", "**Answer:** B\n**Domain:** D1", 1)
                .replace("- A) Looker Studio", "A. Looker Studio"))
        result = converter.parse_exam(VALID, text)
        self.assertTrue(result.ok, result.errors)
        self.assertEqual(result.exam["questions"][2]["choices"][0]["text"], "Looker Studio")

    def test_choice_like_line_inside_code_fence_is_not_a_choice(self):
        text = self.text.replace("WHERE order_date = '2026-10-01';", "WHERE order_date = '2026-10-01';\n-- A) not a choice")
        result = converter.parse_exam(VALID, text)
        self.assertTrue(result.ok, result.errors)
        self.assertIn("-- A) not a choice", result.exam["questions"][1]["text"])

    def test_missing_header_reported(self):
        body = self.text.split("---\n", 2)[2]
        errors = converter.parse_exam(VALID, body).errors
        self.assertTrue(any(e.startswith("Header: missing") for e in errors))


class OptionalHeaderFieldsTest(unittest.TestCase):
    """made_by and flavour are optional, single-line and capped in length."""

    def setUp(self):
        self.text = read(SAMPLES, VALID)

    def with_header(self, extra):
        return self.text.replace("domain_count: 3\n", "domain_count: 3\n" + extra, 1)

    def test_absent_fields_are_left_out(self):
        exam = converter.parse_exam(VALID, self.text).exam
        self.assertNotIn("made_by", exam)
        self.assertNotIn("flavour", exam)

    def test_present_fields_are_kept(self):
        result = converter.parse_exam(VALID, self.with_header("made_by: Model A 2.0\nflavour: Extra theory, one tempting wrong answer\n"))
        self.assertTrue(result.ok, result.errors)
        self.assertEqual(result.exam["made_by"], "Model A 2.0")
        self.assertEqual(result.exam["flavour"], "Extra theory, one tempting wrong answer")

    def test_empty_field_rejected(self):
        errors = converter.parse_exam(VALID, self.with_header("made_by:\n")).errors
        self.assertIn("Header: made_by is empty (fill it in or leave the line out)", errors)

    def test_too_long_field_rejected(self):
        errors = converter.parse_exam(VALID, self.with_header("flavour: %s\n" % ("x" * 161))).errors
        self.assertIn("Header: flavour is 161 characters, max 160", errors)


class HyphenatedNamesTest(unittest.TestCase):
    """Hyphens and case in exam_maker/exam_name are ignored; the header alone decides the ID."""
    NAME = "questions-and-answers-sample-cloud-data-1.md"

    def setUp(self):
        self.text = read(SAMPLES, self.NAME)

    def test_hyphenated_exam_name_imports(self):
        result = converter.parse_exam(self.NAME, self.text)
        self.assertTrue(result.ok, result.errors)
        e = result.exam
        self.assertEqual((e["id"], e["exam_maker"], e["exam_name"]), ("sample-clouddata-1", "sample", "clouddata"))
        self.assertEqual(len(e["domains"]), 3)

    def test_filename_is_ignored(self):
        for name in ("questions-and-answers-sample-ml-data-7.md", "Download (3).md", ""):
            result = converter.parse_exam(name, self.text)
            self.assertTrue(result.ok, result.errors)
            self.assertEqual(result.exam["id"], "sample-clouddata-1")
        self.assertEqual(converter.parse_exam("", self.text).exam["source_file"], "pasted text")

    def test_other_characters_rejected(self):
        text = self.text.replace("exam_name: cloud-data", "exam_name: cloud data")
        errors = converter.parse_exam(self.NAME, text).errors
        self.assertTrue(any("exam_name may only use letters, digits and hyphens" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
