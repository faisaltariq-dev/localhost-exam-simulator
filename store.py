"""File storage for exams, attempts and settings, plus the scoring and green-tally rules.

Everything that decides a number the user sees (score, domain scores, overtime, green
attempt) lives here so the server, the CLI and the tests share one implementation.
"""
import datetime
import json
import os
import threading
import uuid

import converter

SCHEMA_VERSION = 1
MAX_NOTE_CHARS = 20000
DEFAULT_SETTINGS = {
    "schema_version": SCHEMA_VERSION,
    "theme": "light",
    "style": "classic",
    "pass_mark_percent": 70,
    "duration_overrides": {},
}


class StoreError(Exception):
    """An error the HTTP layer can return as-is: status code plus a message or an error list."""

    def __init__(self, status, message=None, errors=None):
        super().__init__(message or "; ".join(errors or []))
        self.status = status
        self.message = message
        self.errors = errors


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json_atomic(path, data):
    tmp = "%s.tmp-%s" % (path, uuid.uuid4().hex[:8])
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


# ---- pure rules -------------------------------------------------------------------------

def score_attempt(exam, answers):
    """Return (correct, total, score_percent, domain_scores). Unanswered counts as wrong."""
    domain_scores = {d["id"]: {"correct": 0, "total": 0} for d in exam.get("domains", [])}
    correct = 0
    for q in exam["questions"]:
        hit = answers.get(str(q["number"])) == q["answer"]
        correct += hit
        ds = domain_scores.setdefault(q["domain"], {"correct": 0, "total": 0})
        ds["total"] += 1
        ds["correct"] += hit
    total = len(exam["questions"])
    percent = round(100.0 * correct / total, 1) if total else 0.0
    return correct, total, percent, domain_scores


def is_overtime(elapsed_seconds, duration_minutes):
    return elapsed_seconds > duration_minutes * 60


def green_attempt(attempts, pass_mark_percent):
    """The owner's rule: the top score, at or above the pass mark, not paused, not overtime.

    If the top score fails any condition nothing is green. Ties go to the most recent
    qualifying attempt. Returns the attempt number or None.
    """
    if not attempts:
        return None
    top = max(a["score_percent"] for a in attempts)
    qualifying = [a for a in attempts
                  if a["score_percent"] == top and a["score_percent"] >= pass_mark_percent
                  and not a["paused"] and not a["overtime"]]
    return qualifying[-1]["number"] if qualifying else None


def effective_duration(exam, settings):
    return settings.get("duration_overrides", {}).get(exam["id"], exam["duration_minutes"])


# ---- storage ----------------------------------------------------------------------------

class Store:
    def __init__(self, root):
        self.root = root
        self.exams_dir = os.path.join(root, "exams")
        self.raw_dir = os.path.join(self.exams_dir, "raw")
        self.data_dir = os.path.join(root, "data")
        self.attempts_dir = os.path.join(self.data_dir, "attempts")
        self.settings_path = os.path.join(self.data_dir, "settings.json")
        for d in (self.raw_dir, self.attempts_dir):
            os.makedirs(d, exist_ok=True)
        self._lock = threading.RLock()

    # -- paths

    @staticmethod
    def check_id(exam_id):
        if not converter.EXAM_ID_RE.match(exam_id or ""):
            raise StoreError(404, "Unknown exam: %s" % exam_id)

    def exam_path(self, exam_id):
        self.check_id(exam_id)
        return os.path.join(self.exams_dir, exam_id + ".json")

    def attempts_path(self, exam_id):
        self.check_id(exam_id)
        return os.path.join(self.attempts_dir, exam_id + ".json")

    # -- settings

    def load_settings(self):
        stored = read_json(self.settings_path, {}) or {}
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        settings.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
        if not os.path.exists(self.settings_path):
            write_json_atomic(self.settings_path, settings)
        return settings

    def update_settings(self, data):
        """Apply user-editable settings."""
        if not isinstance(data, dict):
            raise StoreError(400, "Settings must be a JSON object")
        errors = []
        with self._lock:
            settings = self.load_settings()
            if "theme" in data:
                if data["theme"] in ("light", "dark"):
                    settings["theme"] = data["theme"]
                else:
                    errors.append("theme must be light or dark")
            if "style" in data:
                if data["style"] in ("classic", "modern"):
                    settings["style"] = data["style"]
                else:
                    errors.append("style must be classic or modern")
            if "pass_mark_percent" in data:
                pm = data["pass_mark_percent"]
                if isinstance(pm, int) and not isinstance(pm, bool) and 1 <= pm <= 100:
                    settings["pass_mark_percent"] = pm
                else:
                    errors.append("pass_mark_percent must be a whole number from 1 to 100")
            if "duration_overrides" in data:
                overrides = data["duration_overrides"]
                clean = {}
                if not isinstance(overrides, dict):
                    errors.append("duration_overrides must be an object")
                else:
                    for exam_id, minutes in overrides.items():
                        if not converter.EXAM_ID_RE.match(exam_id):
                            errors.append("duration_overrides: bad exam id %s" % exam_id)
                        elif not (isinstance(minutes, int) and not isinstance(minutes, bool) and 1 <= minutes <= 600):
                            errors.append("duration_overrides: %s must be 1–600 minutes" % exam_id)
                        else:
                            exam = read_json(self.exam_path(exam_id))
                            if exam and exam["duration_minutes"] != minutes:
                                clean[exam_id] = minutes
                settings["duration_overrides"] = clean
            if errors:
                raise StoreError(400, errors=errors)
            write_json_atomic(self.settings_path, settings)
            return settings

    # -- exams

    def exam_ids(self):
        ids = []
        for name in os.listdir(self.exams_dir):
            if name.endswith(".json") and converter.EXAM_ID_RE.match(name[:-5]):
                ids.append(name[:-5])
        return sorted(ids, key=lambda i: (i.rsplit("-", 1)[0], int(i.rsplit("-", 1)[1])))

    def load_exam(self, exam_id):
        exam = read_json(self.exam_path(exam_id))
        if exam is None:
            raise StoreError(404, "Unknown exam: %s" % exam_id)
        return exam

    def exam_for_client(self, exam_id):
        exam = self.load_exam(exam_id)
        settings = self.load_settings()
        exam = dict(exam)
        exam["default_duration_minutes"] = exam["duration_minutes"]
        exam["duration_minutes"] = effective_duration(exam, settings)
        return exam

    def import_exam(self, filename, text):
        """Validate and save an uploaded exam. All or nothing; never overwrites."""
        filename = os.path.basename(filename or "")
        with self._lock:
            # The ID comes from the header (hyphens and case ignored); the filename is only recorded.
            result = converter.parse_exam(filename, text)
            if not result.ok:
                raise StoreError(422, errors=result.errors)
            exam = result.exam
            exam_id = exam["id"]
            raw_path = os.path.join(self.raw_dir, exam_id + ".md")
            if os.path.exists(self.exam_path(exam_id)) or os.path.exists(raw_path):
                raise StoreError(409, "%s already exists. Set exam_number: %d in its header, "
                                      "or delete the old one in Settings." % (exam_id, exam["exam_number"] + 1))
            exam["raw_file"] = exam_id + ".md"
            exam["imported_at"] = now_iso()
            with open(raw_path, "x", encoding="utf-8", newline="") as f:
                f.write(text)
            try:
                write_json_atomic(self.exam_path(exam_id), exam)
            except Exception:
                os.remove(raw_path)
                raise
        return {"id": exam_id, "title": exam["title"], "question_count": len(exam["questions"]),
                "domain_count": len(exam["domains"]), "duration_minutes": exam["duration_minutes"]}

    def raw_path_for(self, exam):
        # Exams imported before raw files were named by ID still use their original filename.
        return os.path.join(self.raw_dir, exam.get("raw_file") or exam["source_file"])

    def delete_exam(self, exam_id):
        with self._lock:
            exam = self.load_exam(exam_id)
            for path in (self.raw_path_for(exam), self.attempts_path(exam_id), self.exam_path(exam_id)):
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass
            settings = self.load_settings()
            settings["duration_overrides"].pop(exam_id, None)
            write_json_atomic(self.settings_path, settings)

    def exam_summaries(self):
        settings = self.load_settings()
        out = []
        for exam_id in self.exam_ids():
            exam = read_json(self.exam_path(exam_id))
            if not exam:
                continue
            attempts = self.load_attempts(exam_id)
            out.append({
                "id": exam_id,
                "maker": exam["exam_maker"],
                "exam": exam["exam_name"],
                "number": exam["exam_number"],
                "title": exam["title"],
                "question_count": len(exam["questions"]),
                "domain_count": len(exam.get("domains", [])),
                "duration_minutes": effective_duration(exam, settings),
                "default_duration_minutes": exam["duration_minutes"],
                "attempt_count": len(attempts),
                "attempts_brief": [{"number": a["number"], "score_percent": a["score_percent"],
                                    "paused": a["paused"], "overtime": a["overtime"]} for a in attempts],
                "green_attempt": green_attempt(attempts, settings["pass_mark_percent"]),
            })
        return out

    # -- attempts

    def load_attempts(self, exam_id):
        doc = read_json(self.attempts_path(exam_id), None)
        return doc["attempts"] if doc else []

    def attempts_for_client(self, exam_id):
        self.load_exam(exam_id)
        attempts = self.load_attempts(exam_id)
        return {"attempts": attempts,
                "green_attempt": green_attempt(attempts, self.load_settings()["pass_mark_percent"])}

    def _save_attempts(self, exam_id, attempts):
        write_json_atomic(self.attempts_path(exam_id),
                          {"schema_version": SCHEMA_VERSION, "exam_id": exam_id, "attempts": attempts})

    def add_attempt(self, exam_id, payload):
        if not isinstance(payload, dict):
            raise StoreError(400, "Attempt must be a JSON object")
        with self._lock:
            exam = self.load_exam(exam_id)
            numbers = {q["number"] for q in exam["questions"]}
            errors = []

            def whole(name, minimum):
                v = payload.get(name)
                if isinstance(v, int) and not isinstance(v, bool) and v >= minimum:
                    return v
                errors.append("%s must be a whole number ≥ %d" % (name, minimum))
                return minimum

            duration = whole("duration_minutes", 1)
            elapsed = whole("elapsed_seconds", 0)
            answers = {}
            for key, value in (payload.get("answers") or {}).items():
                if str(key).isdigit() and int(key) in numbers:
                    answers[str(int(key))] = value if value in ("A", "B", "C", "D") else None
            for n in numbers:
                answers.setdefault(str(n), None)
            bookmarks = sorted({int(b) for b in (payload.get("bookmarks") or [])
                                if str(b).isdigit() and int(b) in numbers})
            notes = {}
            for key, value in (payload.get("notes") or {}).items():
                if str(key).isdigit() and int(key) in numbers and isinstance(value, str) and value.strip():
                    notes[str(int(key))] = value[:MAX_NOTE_CHARS]
            if errors:
                raise StoreError(400, errors=errors)

            correct, total, percent, domain_scores = score_attempt(exam, answers)
            attempts = self.load_attempts(exam_id)
            attempt = {
                "number": (attempts[-1]["number"] + 1) if attempts else 1,
                "started_at": str(payload.get("started_at") or "")[:40],
                "submitted_at": str(payload.get("submitted_at") or now_iso())[:40],
                "duration_minutes": duration,
                "elapsed_seconds": elapsed,
                "paused": bool(payload.get("paused")),
                "overtime": is_overtime(elapsed, duration),
                "answers": dict(sorted(answers.items(), key=lambda kv: int(kv[0]))),
                "bookmarks": bookmarks,
                "notes": notes,
                "correct": correct,
                "total": total,
                "score_percent": percent,
                "domain_scores": domain_scores,
                "revised": False,
            }
            attempts.append(attempt)
            self._save_attempts(exam_id, attempts)
            return attempt

    def set_revised(self, exam_id, number, revised):
        with self._lock:
            self.load_exam(exam_id)
            attempts = self.load_attempts(exam_id)
            for a in attempts:
                if a["number"] == number:
                    a["revised"] = bool(revised)
                    self._save_attempts(exam_id, attempts)
                    return a
            raise StoreError(404, "Attempt %d not found" % number)
