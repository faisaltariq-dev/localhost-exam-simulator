"""Parse and validate exam markdown files written to the prompt-for-exam.md format.

Pure functions only: nothing here touches the filesystem except the CLI at the bottom,
which reads one file and prints the result.

    python3 converter.py questions-and-answers-gcp-adp-1.md
"""
import os
import re
import sys

SCHEMA_VERSION = 1

FILENAME_RE = re.compile(r"^questions-and-answers-([a-z0-9]+)-([a-z0-9]+)-([1-9][0-9]*)\.md$")
EXAM_ID_RE = re.compile(r"^[a-z0-9]+-[a-z0-9]+-[1-9][0-9]*$")
HEADER_FIELDS = ("exam_maker", "exam_name", "exam_number", "title", "duration_minutes", "domain_count")
SECTION_ORDER = ("domains", "questions", "answers")

SECTION_RE = re.compile(r"^#\s+(domains|questions|answers)\s*$", re.I)
ITEM_RE = re.compile(r"^##\s+(?:q\s*|question\s+)(\d+)\.?\s*$", re.I)
DOMAIN_RE = re.compile(r"^\s*[-*]?\s*(d[1-9][0-9]*)\s*[:.)\-]\s*(.+)$", re.I)
CHOICE_RE = re.compile(r"^\s*(?:[-*]\s+)?\(?([A-D])[\).:]\s+(.+)$")
LABEL_RE = re.compile(r"^\s*\*{0,2}(answer|domain|explanation)\*{0,2}\s*:\s*\*{0,2}\s*(.*)$", re.I)
ANSWER_VALUE_RE = re.compile(r"^\(?([A-Da-d])(?:[\).:\s]|$)")
DOMAIN_VALUE_RE = re.compile(r"^(d[1-9][0-9]*)\b", re.I)
FENCE_RE = re.compile(r"^\s*(```|~~~)")


class ParseResult:
    """exam is a dict when errors is empty, otherwise None."""

    def __init__(self, exam, errors):
        self.exam = exam
        self.errors = errors

    @property
    def ok(self):
        return not self.errors


def parse_filename(filename):
    """Return (maker, exam_name, number) or None."""
    m = FILENAME_RE.match(filename)
    if not m:
        return None
    return m.group(1), m.group(2), int(m.group(3))


def exam_id_from_filename(filename):
    parts = parse_filename(filename)
    return None if parts is None else "%s-%s-%d" % parts


def _normalise(text):
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    # Tolerate a pasted AI reply: a leading filename line and/or a wrapping code fence.
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and FILENAME_RE.match(lines[0].strip().strip("`*")):
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and FENCE_RE.match(lines[0]) and lines[-1].strip() in ("```", "~~~"):
        lines = lines[1:-1]
    return lines


def _positive_int(value):
    try:
        n = int(str(value).strip())
    except ValueError:
        return None
    return n if n > 0 else None


def _parse_header(lines, errors):
    """Return (header dict, index of first body line)."""
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != "---":
        errors.append("Header: missing (the file must start with a --- block)")
        return {}, i
    header = {}
    j = i + 1
    while j < len(lines) and lines[j].strip() != "---":
        line = lines[j].strip()
        if line:
            if ":" not in line:
                errors.append('Header: can\'t read line "%s"' % line)
            else:
                key, value = line.split(":", 1)
                header[key.strip().lower()] = value.strip().strip("\"'")
        j += 1
    if j >= len(lines):
        errors.append("Header: the closing --- line is missing")
    return header, j + 1


def _split_sections(lines, start, errors):
    """Return {name: [(line_no, text), ...]} and the order the sections appeared in."""
    sections, order = {}, []
    current, in_fence = None, False
    for idx in range(start, len(lines)):
        line = lines[idx]
        if FENCE_RE.match(line):
            in_fence = not in_fence
        elif not in_fence:
            m = SECTION_RE.match(line.strip())
            if m:
                current = m.group(1).lower()
                order.append(current)
                sections.setdefault(current, [])
                continue
        if current is None:
            if line.strip():
                errors.append('Line %d: unexpected text before "# Domains": "%s"' % (idx + 1, line.strip()[:60]))
            continue
        sections[current].append((idx + 1, line))
    return sections, order


def _split_items(section_lines, section_label, errors):
    """Split a section into {number: [lines]} on '## Q<n>' headings (outside code fences)."""
    items, order = {}, []
    current, in_fence = None, False
    for line_no, line in section_lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
        elif not in_fence:
            m = ITEM_RE.match(line.strip())
            if m:
                current = int(m.group(1))
                order.append(current)
                if current in items:
                    errors.append("%s: Q%d appears more than once" % (section_label, current))
                items[current] = []
                continue
        if current is None:
            if line.strip():
                errors.append('%s: unexpected text before the first "## Q" heading (line %d)' % (section_label, line_no))
            continue
        items[current].append(line)
    return items, order


def _check_numbering(numbers, label, prefix, errors):
    """Report gaps in 1..max. Duplicates are reported while splitting."""
    if not numbers:
        return
    present = set(numbers)
    for n in range(1, max(present) + 1):
        if n not in present:
            errors.append("%s: missing %s%d" % (label, prefix, n))


def _clean_block(lines):
    while lines and not lines[0].strip():
        lines = lines[1:]
    while lines and not lines[-1].strip():
        lines = lines[:-1]
    return "\n".join(l.rstrip() for l in lines)


def _parse_domains(section_lines, errors):
    domains, seen = [], set()
    for line_no, line in section_lines:
        if not line.strip():
            continue
        m = DOMAIN_RE.match(line)
        if not m:
            errors.append('Domains: can\'t read line %d "%s" (expected "- D1: name")' % (line_no, line.strip()[:60]))
            continue
        did, name = m.group(1).upper(), m.group(2).strip()
        if did in seen:
            errors.append("Domains: %s appears more than once" % did)
            continue
        seen.add(did)
        if not name:
            errors.append("Domains: %s has no name" % did)
        domains.append({"id": did, "name": name})
    _check_numbering([int(d["id"][1:]) for d in domains], "Domains", "D", errors)
    domains.sort(key=lambda d: int(d["id"][1:]))
    return domains


def _parse_question(number, lines, errors):
    text_lines, choices = [], []
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
        m = None if in_fence or FENCE_RE.match(line) else CHOICE_RE.match(line)
        if m:
            choices.append([m.group(1), [m.group(2).strip()]])
        elif choices:
            if line.strip():
                choices[-1][1].append(line.strip())
        else:
            text_lines.append(line)
    text = _clean_block(text_lines)
    if not text:
        errors.append("Q%d: question text is empty" % number)
    labels = [c[0] for c in choices]
    if len(choices) != 4:
        errors.append("Q%d: found %d choices, need 4 (A–D)" % (number, len(choices)))
    elif labels != ["A", "B", "C", "D"]:
        errors.append("Q%d: choices must be labelled A, B, C, D in order (found %s)" % (number, ", ".join(labels)))
    out = []
    for label, parts in choices:
        ctext = "\n".join(parts).strip()
        if not ctext:
            errors.append("Q%d: choice %s is empty" % (number, label))
        out.append({"label": label, "text": ctext})
    return {"number": number, "text": text, "choices": out}


def _parse_answer(number, lines, domain_ids, errors):
    answer = domain = None
    explanation = None
    for line in lines:
        m = LABEL_RE.match(line) if explanation is None else None
        if m:
            label, value = m.group(1).lower(), m.group(2).strip()
            if label == "answer":
                am = ANSWER_VALUE_RE.match(value)
                if am:
                    answer = am.group(1).upper()
                else:
                    errors.append('Q%d: answer "%s" is not A–D' % (number, value))
                    answer = ""
            elif label == "domain":
                dm = DOMAIN_VALUE_RE.match(value)
                domain = dm.group(1).upper() if dm else value
            else:
                explanation = [value]
        elif explanation is not None:
            explanation.append(line)
    if answer is None:
        errors.append('Q%d: "Answer:" line is missing' % number)
    if domain is None:
        errors.append('Q%d: "Domain:" line is missing' % number)
    elif domain not in domain_ids:
        errors.append('Q%d: domain "%s" is not in # Domains' % (number, domain))
    text = _clean_block(explanation or [])
    if not text:
        errors.append("Q%d: explanation is empty" % number)
    return {"answer": answer or "", "domain": domain or "", "explanation": text}


def parse_exam(filename, text):
    """Parse and validate one exam file. Always returns a ParseResult with every error found."""
    errors = []
    parts = parse_filename(filename)
    if parts is None:
        errors.append('Filename: "%s" must look like questions-and-answers-<maker>-<exam>-<number>.md '
                      "(lowercase letters/digits, no extra hyphens)" % filename)

    lines = _normalise(text)
    header, body_start = _parse_header(lines, errors)

    for field in HEADER_FIELDS:
        if field not in header or header[field] == "":
            errors.append("Header: %s is missing" % field)
    exam_number = _positive_int(header.get("exam_number", ""))
    duration = _positive_int(header.get("duration_minutes", ""))
    domain_count = _positive_int(header.get("domain_count", ""))
    for field, value in (("exam_number", exam_number), ("duration_minutes", duration), ("domain_count", domain_count)):
        if header.get(field) and value is None:
            errors.append('Header: %s must be a positive whole number (got "%s")' % (field, header[field]))
    maker = header.get("exam_maker", "").lower()
    name = header.get("exam_name", "").lower()
    if parts is not None:
        if maker and maker != parts[0]:
            errors.append('Header: exam_maker is "%s" but filename says "%s"' % (maker, parts[0]))
        if name and name != parts[1]:
            errors.append('Header: exam_name is "%s" but filename says "%s"' % (name, parts[1]))
        if exam_number is not None and exam_number != parts[2]:
            errors.append("Header: exam_number is %d but filename says %d" % (exam_number, parts[2]))

    sections, order = _split_sections(lines, body_start, errors)
    for sec in SECTION_ORDER:
        count = order.count(sec)
        if count == 0:
            errors.append('Sections: "# %s" is missing' % sec.capitalize())
        elif count > 1:
            errors.append('Sections: "# %s" appears %d times, need exactly one' % (sec.capitalize(), count))
    if len(order) == 3 and set(order) == set(SECTION_ORDER) and tuple(order) != SECTION_ORDER:
        errors.append("Sections: order must be # Domains, # Questions, # Answers")

    domains = _parse_domains(sections.get("domains", []), errors)
    if "domains" in sections and not domains:
        errors.append("Domains: no domains listed")
    if domain_count is not None and domains and len(domains) != domain_count:
        errors.append("Domains: listed %d but domain_count is %d" % (len(domains), domain_count))
    domain_ids = {d["id"] for d in domains}

    q_items, q_order = _split_items(sections.get("questions", []), "Questions", errors)
    a_items, a_order = _split_items(sections.get("answers", []), "Answers", errors)
    if "questions" in sections and not q_items:
        errors.append("Questions: no questions found")
    _check_numbering(q_order, "Questions", "Q", errors)
    for n in sorted(set(q_items) - set(a_items)):
        errors.append("Answers: missing Q%d" % n)
    for n in sorted(set(a_items) - set(q_items)):
        errors.append("Answers: Q%d has no matching question" % n)

    questions = []
    for n in sorted(q_items):
        q = _parse_question(n, q_items[n], errors)
        if n in a_items:
            q.update(_parse_answer(n, a_items[n], domain_ids, errors))
        questions.append(q)
    for n in sorted(set(a_items) - set(q_items)):
        _parse_answer(n, a_items[n], domain_ids, errors)

    if errors:
        return ParseResult(None, errors)
    exam = {
        "schema_version": SCHEMA_VERSION,
        "id": "%s-%s-%d" % parts,
        "exam_maker": parts[0],
        "exam_name": parts[1],
        "exam_number": parts[2],
        "title": header["title"],
        "duration_minutes": duration,
        "domains": domains,
        "source_file": filename,
        "questions": [
            {"number": q["number"], "text": q["text"], "choices": q["choices"],
             "answer": q["answer"], "domain": q["domain"], "explanation": q["explanation"]}
            for q in questions
        ],
    }
    return ParseResult(exam, [])


def main(argv):
    if len(argv) != 2:
        print("usage: python3 converter.py <questions-and-answers-...md>")
        return 2
    path = argv[1]
    with open(path, encoding="utf-8") as f:
        result = parse_exam(os.path.basename(path), f.read())
    if result.ok:
        e = result.exam
        print("OK: %s, %d questions, %d domains, %d min" % (
            e["id"], len(e["questions"]), len(e["domains"]), e["duration_minutes"]))
        return 0
    print("%d problem(s) found:" % len(result.errors))
    for err in result.errors:
        print("  - " + err)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
