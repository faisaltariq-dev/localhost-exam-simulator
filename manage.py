"""Maintenance CLI for the parse-issue flow (see fix-parse-agent.md).

    python3 manage.py list-flagged
    python3 manage.py reconvert <exam-id>
    python3 manage.py unflag <exam-id>

Works whether or not the server is running.
"""
import os
import sys

import converter
from store import Store, StoreError

ROOT = os.path.dirname(os.path.abspath(__file__))


def list_flagged(store):
    flags = store.load_settings()["parse_issues"]
    if not flags:
        print("No exams are flagged.")
        return 0
    for exam_id, flagged_at in sorted(flags.items()):
        try:
            exam = store.load_exam(exam_id)
        except StoreError:
            print("%s  (flagged %s)  exam file is missing" % (exam_id, flagged_at))
            continue
        print("%s  flagged %s  %d questions" % (exam_id, flagged_at, len(exam["questions"])))
        print("    raw:  %s" % os.path.relpath(store.raw_path_for(exam), ROOT))
        print("    json: %s" % os.path.relpath(store.exam_path(exam_id), ROOT))
    return 0


def _changed(old, new):
    """Count questions whose text, choices, answer or domain differ."""
    old_q = {q["number"]: q for q in old["questions"]}
    count = 0
    for q in new["questions"]:
        o = old_q.get(q["number"])
        if o is None or any(o.get(k) != q.get(k) for k in ("text", "choices", "answer", "domain")):
            count += 1
    return count + len(set(old_q) - {q["number"] for q in new["questions"]})


def reconvert(store, exam_id):
    exam = store.load_exam(exam_id)
    raw = store.raw_path_for(exam)
    with open(raw, encoding="utf-8") as f:
        result = converter.parse_exam(exam["source_file"], f.read())
    if not result.ok:
        print("The raw file does not parse cleanly. Nothing was changed.")
        for err in result.errors:
            print("  - " + err)
        return 1
    old, new = store.replace_exam(exam_id, result.exam)
    print("Reconverted %s: %d questions, %d domains." % (exam_id, len(new["questions"]), len(new["domains"])))
    print("%d question(s) changed text, choices, answer or domain. Attempts were kept." % _changed(old, new))
    return 0


def unflag(store, exam_id):
    store.set_parse_issue(exam_id, False)
    print("Cleared the parse-issue flag on %s." % exam_id)
    return 0


def main(argv):
    commands = {"list-flagged": 0, "reconvert": 1, "unflag": 1}
    if len(argv) < 2 or argv[1] not in commands or len(argv) != 2 + commands[argv[1]]:
        print(__doc__.strip())
        return 2
    store = Store(ROOT)
    try:
        if argv[1] == "list-flagged":
            return list_flagged(store)
        if argv[1] == "reconvert":
            return reconvert(store, argv[2])
        return unflag(store, argv[2])
    except StoreError as e:
        print(e.message or "\n".join(e.errors))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
