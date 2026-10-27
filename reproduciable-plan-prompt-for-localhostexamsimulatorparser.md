# Localhost Exam Simulator — Implementation Plan

**Plan version:** 1.2 (frozen) · **Date:** 2026-10-27

> This document is self-contained: any agent, model or developer can build the whole project from it with no other context. It is **frozen** so it can be handed to other instances to produce variants. Do not edit it in place. To change the design, copy it, bump the version (minor = additions, major = breaking format changes) and add a Changelog line. A build that deviates from this plan records the differences in its own `IMPLEMENTATION-NOTES.md`.
>
> **Two non-negotiables for every build:** (1) domain classification end to end (section 6), and (2) the strict git workflow (section 13): one small commit per module, in order, tests green before each commit.

---

## 1. Context

The owner is preparing for certification exams (first target: Google Cloud Associate Data Practitioner, "GCP ADP"). The goal is a local web app that simulates the real exam: multiple-choice questions with 4 options, bookmarks, a review list and a timer. It adds personal extras on top: a note per question, attempt history, retakes, and a score breakdown by exam domain.

Exams are **not** written by hand. The owner asks any AI chat for an exam ("give me an extra-hard ADP exam…") and attaches `prompt-for-exam.md`, which forces a strict markdown output format. The owner drags the resulting file into the web app, which validates it, converts it to JSON and adds it to a library of saved exams.

## 2. Environment and constraints

- Machine: 2015 Intel Mac (x86_64), macOS 12.7.6. Python 3.11 at `/usr/local/bin/python3`. Code must also run on Python 3.9+.
- **Zero dependencies.** Python standard library only: no pip installs, no Homebrew. The frontend is plain HTML/CSS/JavaScript (ES modules): no frameworks, no build step, no CDN, no web fonts, no images. It must work offline and stay light on memory.
- The server binds to `127.0.0.1` only. The default port is `8000`.
- Run with `python3 server.py`, then open `http://localhost:8000`.
- The project folder is `localhost-exam-simulator`.

## 3. Architecture

There are four layers, and only the server touches the disk.

```
 Any AI chat                Browser (localhost:8000)                 server.py (stdlib)               Disk
 ───────────                ────────────────────────                 ──────────────────               ────
 request + prompt  ──►  questions-and-answers-gcp-adp-1.md
                              │ drag into drop zone
                              ▼
                        POST /api/upload  ───────────────────►  name check → parse → validate ──► exams/raw/<file>.md
                              ▲                                        │  (all or nothing)        exams/<id>.json
                              └──── 400 / 409 / 422 + errors ◄─────────┘
                        Library  ◄──── GET /api/exams ◄──────────── reads exams/ + data/attempts/ + settings
                        Exam → Results ── POST attempt (on submit only) ──────────────────────► data/attempts/<id>.json
                        Settings ◄──► GET/PUT /api/settings, DELETE, parse-issue flag ───────► data/settings.json
 Coding agent  ── manage.py (list-flagged / reconvert / unflag) ──────────────────────────────► exams/, data/
```

- The browser cannot write to disk, so every persistent change goes through the server.
- Scoring, domain scores, overtime and the green-tally rule are all computed **on the server**, in one place (`store.py`).
- An in-progress attempt lives only in the open tab. It is saved once, on submit.

## 4. Repository layout

```
localhost-exam-simulator/
├── reproduciable-plan-prompt-for-localhostexamsimulatorparser.md   # this plan (frozen)
├── prompt-for-exam.md        # format spec given to any AI (section 7, frozen with this plan)
├── fix-parse-agent.md        # instructions for a coding agent fixing a flagged parse issue (section 10b)
├── server.py                 # HTTP server: static files + JSON API
├── converter.py              # parse + validate exam markdown (pure functions; also a CLI)
├── store.py                  # storage: exams, attempts, settings, scoring, domain scores, green rule, flags
├── manage.py                 # maintenance CLI: list-flagged, reconvert, unflag
├── README.md
├── .gitignore                # exams/, data/, __pycache__/, .DS_Store, *.avif
├── web/
│   ├── index.html
│   ├── style.css             # theme × style tokens + components
│   └── js/
│       ├── app.js            # router, boot, applies settings
│       ├── api.js            # fetch wrappers
│       ├── util.js           # escaping, formatting, mini text renderer, DOM helpers
│       ├── library.js        # library: search, tableau/list, drop zone, prompt block, exam detail
│       ├── exam.js           # exam screen, timer, pause, notes, review panel, submit
│       ├── results.js        # results with domain breakdown
│       └── settings.js       # settings panel, manage exams
├── exams/                    # runtime, git-ignored
│   ├── raw/                  # original uploaded .md files, unchanged
│   └── <id>.json
├── data/                     # runtime, git-ignored
│   ├── attempts/<id>.json
│   └── settings.json
├── samples/
│   ├── questions-and-answers-sample-demo-1.md   # valid, 6 questions, 3 domains
│   └── broken/…                                 # one file per validation error
└── tests/
    ├── test_converter.py
    └── test_rules.py
```

## 5. Exam markdown format (the contract)

### 5.1 Filename
`questions-and-answers-<maker>-<exam>-<number>.md`
- Regex: `^questions-and-answers-([a-z0-9]+)-([a-z0-9]+)-([1-9][0-9]*)\.md$`
- `<maker>` and `<exam>` are lowercase letters and digits only, with no hyphens. `<number>` is a positive integer.
- **Exam ID** = `<maker>-<exam>-<number>`, e.g. `gcp-adp-1`.

### 5.2 Structure (sections in this order)
```markdown
---
exam_maker: gcp
exam_name: adp
exam_number: 1
title: GCP Associate Data Practitioner – Practice 1
duration_minutes: 120
domain_count: 3
---

# Domains

- D1: Data Preparation and Ingestion
- D2: Data Analysis and Presentation
- D3: Data Management

# Questions

## Q1
Question text, may span several lines.
Code goes in fenced code blocks.

- A) choice
- B) choice
- C) choice
- D) choice

# Answers

## Q1
Answer: C
Domain: D1
Explanation: Why C is correct and why A, B and D are wrong. May span lines.
```

### 5.3 Parsing rules
- **Header:** the block between the first two `---` lines at the very top. Parse simple `key: value` lines (no YAML library) and strip surrounding quotes from values.
- **Section headings:** a line that is exactly `# Domains`, `# Questions` or `# Answers` (whitespace trimmed, case-insensitive). Headings inside fenced code blocks are ignored.
- **Domain lines:** `^\s*[-*]?\s*(D[1-9][0-9]*)\s*[:.)-]\s*(.+)$` (the `D` is case-insensitive).
- **Question and answer headings:** `## Q<n>`. Also accept `## Q<n>.` and `## Question <n>`. Ignored inside code fences.
- **Choice lines (lenient):** `^\s*(?:[-*]\s+)?\(?([A-D])[\).:]\s+(.+)$`. A following line that is not a new choice or heading is appended to the previous choice.
- **Question text:** everything between the `## Q<n>` heading and the first choice line, trimmed.
- **Answer blocks:** the labels `Answer:`, `Domain:` and `Explanation:` may be bold (`**Answer:**`) and are case-insensitive. `Answer` is one letter A–D. `Domain` is a domain ID such as `D2`. The explanation runs from `Explanation:` to the end of the block.

### 5.4 Validation (collect ALL errors, then reject)
1. The filename matches 5.1.
2. The header has all 6 fields. `exam_number`, `duration_minutes` and `domain_count` are positive integers, and `title` is not empty.
3. The header values match the filename (`exam_maker`, `exam_name`, `exam_number`).
4. There is exactly one `# Domains`, one `# Questions` and one `# Answers` section, in that order.
5. Domains are numbered D1…Dk with no gaps or duplicates, every name is non-empty, and k equals `domain_count`.
6. Questions are numbered Q1…QN with no gaps or duplicates, and N ≥ 1.
7. Each question has non-empty text and exactly 4 choices, labelled A, B, C, D in order, none of them empty.
8. The answers cover exactly the same numbers as the questions (report missing and extra numbers).
9. Each answer is exactly one letter A–D.
10. Each answer has a `Domain:` that exists in the Domains section.
11. Each explanation is non-empty.

Error messages are short and point at the location, for example: `Q17: found 3 choices, need 4 (A–D)`, `Answers: missing Q23`, `Q9: answer "E" is not A–D`, `Q4: domain "D7" is not in # Domains`, `Header: exam_number is 2 but filename says 1`, `Domains: listed 4 but domain_count is 5`.

The CLI `python3 converter.py <file.md>` prints `OK: <id>, N questions, k domains, M min`, or the list of errors with exit code 1. It never writes files.

## 6. Domain classification (required, end to end)

Every exam is split into domains, the topic areas of the official exam guide. Each question belongs to exactly one domain.

| Layer | What it does with domains |
|---|---|
| **Prompt** (section 7) | The AI states `domain_count` in the header, lists each domain as `- D<k>: <name>` under `# Domains`, and tags every answer with `Domain: D<k>`. It uses the official exam-guide domains and spreads questions across them roughly by official weighting. |
| **Converter** | Parses `# Domains`. It validates that the count matches `domain_count`, that the IDs are sequential, and that every answer's domain exists (5.4 items 2, 4, 5 and 10). It stores `domains` on the exam and `domain` on each question. |
| **Server** (`store.py`) | On submit, computes `domain_scores` (`{D<k>: {correct, total}}`) alongside the overall score. Unanswered questions count as wrong. |
| **Exam screen** | Domains are **hidden** during the exam, because they come from the answers section. |
| **Results** | A domain breakdown table (10.4), plus a domain tag on each question in the review. |
| **Library detail** | Shows the domain count. |

## 7. `prompt-for-exam.md` (create with exactly this content; frozen)

~~~~markdown
# prompt-for-exam.md

This file defines the exact output format for a practice exam that will be loaded into my local exam simulator. Follow my message for the content, topics and difficulty, and follow this file only for the structure.

## Output
- Produce ONE markdown file named:
  questions-and-answers-<maker>-<exam>-<number>.md
  all lowercase, words joined with hyphens. Example: questions-and-answers-gcp-adp-1.md
- Start with the filename on its own line, then the whole file inside a single code block. Write nothing after the code block.
- Output the complete exam as one file, however long it gets: one header, one `# Domains` section, one `# Questions` section, one `# Answers` section.

## Structure (in this order)
1. A header between two `---` lines with exactly these fields:
   exam_maker, exam_name, exam_number, title, duration_minutes, domain_count
   - duration_minutes = the official exam duration, unless my message says otherwise.
   - domain_count = how many domains you list in `# Domains`.
2. A `# Domains` section: one line per exam domain, `- D1: <name>`, `- D2: <name>`, …
   Use the official exam guide's domains when the exam has them.
3. A `# Questions` section. Each question:
   - a heading `## Q<n>`
   - the question text (may span lines; put code or commands in fenced code blocks)
   - exactly four choices, each on its own line: `- A) `, `- B) `, `- C) `, `- D) `
4. A `# Answers` section. Each answer:
   - a heading `## Q<n>` matching its question
   - `Answer: <letter>`
   - `Domain: <domain id>` (e.g. `Domain: D2`)
   - `Explanation: ` why the answer is correct and why each other choice is wrong

## Rules
- Number questions Q1, Q2, Q3 … with no gaps or repeats.
- Every question has exactly one answer entry, and every answer entry has a question.
- Exactly one correct choice per question.
- Every answer names exactly one domain from `# Domains`.
- Spread questions across the domains roughly in line with the official exam weighting, unless my message says otherwise.
- Never put answers, domains, hints or explanations in the Questions section.
- Don't label choices as "correct", and don't use "all of the above" or "none of the above".

## Template
---
exam_maker: <maker>
exam_name: <exam>
exam_number: <n>
title: <Human-readable title>
duration_minutes: <minutes>
domain_count: <k>
---

# Domains

- D1: <domain name>
- D2: <domain name>

# Questions

## Q1
<question text>

- A) <choice>
- B) <choice>
- C) <choice>
- D) <choice>

# Answers

## Q1
Answer: <letter>
Domain: <domain id>
Explanation: <why it is right, and why each other choice is wrong>
~~~~

## 8. Data files (JSON, UTF-8, `schema_version: 1`)

**`exams/<id>.json`**: the converted exam.
```json
{ "schema_version": 1, "id": "gcp-adp-1", "exam_maker": "gcp", "exam_name": "adp", "exam_number": 1,
  "title": "GCP Associate Data Practitioner – Practice 1", "duration_minutes": 120,
  "domains": [ {"id": "D1", "name": "Data Preparation and Ingestion"}, {"id": "D2", "name": "…"} ],
  "source_file": "questions-and-answers-gcp-adp-1.md", "imported_at": "2026-10-27T15:43:00Z",
  "questions": [ { "number": 1, "text": "…",
                   "choices": [ {"label": "A", "text": "…"}, {"label": "B", "text": "…"},
                                {"label": "C", "text": "…"}, {"label": "D", "text": "…"} ],
                   "answer": "C", "domain": "D1", "explanation": "…" } ] }
```

**`data/attempts/<id>.json`**: every submitted attempt, in chronological order.
```json
{ "schema_version": 1, "exam_id": "gcp-adp-1",
  "attempts": [ { "number": 1, "started_at": "…", "submitted_at": "…",
                  "duration_minutes": 120, "elapsed_seconds": 6760,
                  "paused": false, "overtime": false,
                  "answers": {"1": "C", "2": null}, "bookmarks": [12], "notes": {"12": "…"},
                  "correct": 39, "total": 50, "score_percent": 78.0,
                  "domain_scores": {"D1": {"correct": 14, "total": 18}, "D2": {"correct": 15, "total": 20}},
                  "revised": false } ] }
```
- `duration_minutes` is the time limit in effect for that attempt, so a later time change never alters old results.
- `elapsed_seconds` is active exam time, not counting time spent paused.
- `overtime` = `elapsed_seconds > duration_minutes * 60`, computed by the server.
- `correct`, `total`, `score_percent` (1 decimal) and `domain_scores` are computed by the server from `answers`.

**`data/settings.json`**: created with defaults if it is missing.
```json
{ "schema_version": 1, "theme": "light", "style": "classic", "pass_mark_percent": 70,
  "duration_overrides": {}, "parse_issues": {} }
```
- `duration_overrides` maps exam ID → minutes. The effective duration is the override if there is one, otherwise the exam's `duration_minutes`.
- `parse_issues` maps exam ID → the ISO time it was flagged. If an ID is absent, the exam is not flagged.
- Deleting an exam also removes its override and its flag.
- Exam files are never edited by the app. The only exception is `manage.py reconvert` (section 10b).

All writes are atomic: write to a temp file in the same folder, then `os.replace` it into place.

## 9. Server API (`server.py`, `http.server.ThreadingHTTPServer`)

| Method & path | Body | Result |
|---|---|---|
| `GET /`, `/style.css`, `/js/*` | — | static files from `web/` only (block path traversal) |
| `GET /prompt-for-exam.md` | — | the prompt file as `text/plain; charset=utf-8` |
| `POST /api/upload?filename=<name>` | raw markdown (≤ 10 MB) | `201 {id,title,question_count,domain_count,duration_minutes}` · `400 {errors}` for a bad filename · `409 {error}` if the ID exists · `422 {errors}` if validation fails. Nothing is written unless the result is 201. |
| `GET /api/exams` | — | a list of `id, maker, exam, number, title, question_count, domain_count, duration_minutes` (effective), `default_duration_minutes, attempt_count, attempts_brief [{number, score_percent, paused, overtime}], green_attempt` (number or null), `parse_issue` (bool) |
| `GET /api/exams/<id>` | — | the full exam JSON with the effective duration |
| `DELETE /api/exams/<id>` | — | deletes `exams/<id>.json`, its raw `.md`, `data/attempts/<id>.json`, and its override and flag → `204` |
| `GET /api/exams/<id>/attempts` | — | `{attempts, green_attempt}` |
| `POST /api/exams/<id>/attempts` | `{started_at, submitted_at, duration_minutes, elapsed_seconds, paused, answers, bookmarks, notes}` | the server adds `number`, `overtime`, the score fields, `domain_scores` and `revised:false` → `201` with the attempt |
| `PATCH /api/exams/<id>/attempts/<n>` | `{revised: bool}` | `200` with the attempt |
| `PUT /api/exams/<id>/parse-issue` | `{flagged: bool}` | `200 {id, flagged, flagged_at}` |
| `GET /api/settings` / `PUT /api/settings` | settings object | validated: theme ∈ light/dark, style ∈ classic/modern, pass mark 1–100, overrides 1–600. `parse_issues` is ignored on PUT. |

- Duplicate check (409): `exams/<id>.json` **or** `exams/raw/<filename>` already exists. Never overwrite.
- Validate every `<id>` in a URL against `^[a-z0-9]+-[a-z0-9]+-[1-9][0-9]*$` before touching the filesystem.
- Errors come back as `{"error": "…"}` or `{"errors": ["…"]}`. Log one line per request to stdout.

## 10. Rules

**Green tally (the owner's exact rule).** Each exam has at most one green attempt. An attempt is green only if all three of these hold:
1. Its `score_percent` is the highest of all attempts on that exam.
2. Its `score_percent` is at or above `pass_mark_percent`, read from settings each time the rule is evaluated.
3. It has `paused == false` and `overtime == false`.

If the top score fails rule 2 or 3, nothing is green until a later attempt beats it cleanly. If several attempts tie for the top score, the most recent one that satisfies rules 2 and 3 is green.

**Timer.** The timer counts down from the effective duration in green. At 0 it turns red and keeps counting overtime as `−H:MM:SS`. It never submits automatically. Pausing stops the clock.

**Pause.** Pausing hides the question and shows an overlay reading "⚠ Warning: real exams do not have a pause mechanism.", with a Resume button. Pausing even once marks the attempt `paused: true`. Results only say "Taken continuously" or "Paused during exam", never how many times or for how long.

**Closing the tab.** There is no autosave and no resume. While an attempt is in progress, a `beforeunload` handler makes the browser ask "Leave site?". Leaving discards the attempt.

## 10b. Parse-issue flag and agent fix flow

**Why.** An AI-generated file can pass validation and still parse wrongly, for example a choice that swallows the next line or a mangled code block. Instead of building repair UI, the owner flags the exam and later hands the fix to a coding agent.

**Owner side (UI).** In Settings → Manage exams, each row has a **Parse issue** toggle next to Delete, off by default. Turning it on saves the flag and shows 🔧 on that row and on the exam's library card, with the tooltip "Parse issue flagged, waiting for a fix". Turning it off removes both. A flagged exam can still be taken.

**Agent side.** The owner opens any coding agent in the repo and says *"Fix the flagged parse issues. Follow fix-parse-agent.md."* That file tells the agent to:
1. Run `python3 manage.py list-flagged`.
2. Compare `exams/raw/<file>.md` with `exams/<id>.json` to find what parsed wrongly. If it is unclear, ask the owner what looks wrong.
3. Fix the **parser** in `converter.py` in a general way. Never hand-edit the exam JSON or the raw `.md`; the raw file is the source of truth.
4. Add a minimal regression sample to `samples/` and a test to `tests/test_converter.py`.
5. Run `python3 -m unittest discover tests`. Every test must pass.
6. Run `python3 manage.py reconvert <id>`. It replaces the JSON only if the new parse is valid, and it keeps the attempts.
7. Summarise the change for the owner, then run `python3 manage.py unflag <id>`, or leave the flag set if the owner wants to check the exam first.
8. Commit following section 13: one commit for the parser fix and its test, with a message like `Fix parser: <what>`.
9. Leave `prompt-for-exam.md` unchanged unless the owner asks for it.

**`manage.py`** is a standard-library CLI built on `converter.py` and `store.py`. It works whether or not the server is running.
- `list-flagged`: shows each flagged ID with its flag time, raw path, JSON path and question count.
- `reconvert <id>`: parses the raw file. If the result is invalid, it prints the errors and changes nothing. If it is valid, it atomically replaces `exams/<id>.json`, keeps `imported_at`, adds `reconverted_at`, and prints how many questions changed in text, choices, answer or domain.
- `unflag <id>`: clears the flag.

## 11. Web app (`web/`, hash-routed single page, ES modules)

Routes: `#/` is the library, `#/take/<id>` the exam, `#/results/<id>/<n>` the results. The `<html>` element carries `data-theme` and `data-style` attributes taken from settings.

### 11.1 Library (start page)
- **Top bar:** app name, search input, Tableau/List toggle, Settings button.
- **Search (grep-like):** a case-insensitive substring match on ID and title. A query wrapped in slashes, such as `/gcp-.*-1/`, is treated as a regex; an invalid regex shows no matches instead of crashing. Results filter as you type.
- **Drop zone:** drag a `.md` file onto it, or click it to pick one. It shows either "Added <title> (N questions, k domains, M min)" or the full error list from the server. The library refreshes after a successful upload.
- **Prompt block:** a collapsible `<details>`. Its header shows `prompt-for-exam.md`, a one-line description and a **Copy** button. Copy works while the block is collapsed, so clicking it must not toggle the block. The body shows the full file, fetched from `/prompt-for-exam.md`. Copy uses `navigator.clipboard.writeText`; if that fails, the block opens and the text is selected instead.
- **Card:** tally marks on top, a label (`GCP · ADP`, maker · exam in uppercase), the title, a meta line (`gcp-adp-1 · 50 q · 120 min`), and 🔧 in the corner when a parse issue is flagged.
- **Tally marks:** one stroke per submitted attempt, in chronological order, grouped in fives (4 vertical strokes plus a diagonal fifth) and drawn as inline SVG. The green attempt's stroke is green and the others are neutral. A card with no attempts says "not taken yet".
- **Tableau view (default, inspired by spider solitaire):** each maker+exam group is a column, with the columns side by side like a solitaire tableau. Cards in a column are sorted by exam number and cascade downwards, overlapping so each card shows only its top strip (tally, label, title). The last card in a column is shown in full. Clicking any strip selects that exam. The tableau surface is flat grey in Classic style and a subtle felt green in Modern style. While searching, columns show only the matching cards, and empty columns are hidden.
- **List view:** every exam as a full card in a grid.
- **Exam detail** (for the selected exam): title, question count, domain count and effective time, plus an attempts table with the columns `# | Date | Score | Completed in | Continuous | Revised`. Times over the limit show in red, and the green attempt is highlighted. Clicking a row opens that attempt's results. The button reads **Start** when there are no attempts and **Retake** otherwise. Every attempt starts fresh, with no answers, bookmarks or notes carried over.

### 11.2 Exam screen
- **Top bar:** exam title, timer, Pause, Review and Submit buttons.
- **Question:** "Question 12 of 50", the question text, and 4 choices as radio-style options. Click a choice to select it, or click another to change.
- **Side column:** a bookmark toggle (☆/★), with a **note** textarea for the question directly under it. The note is kept in memory as you type.
- **Navigation:** Previous and Next buttons. On the keyboard, ←/→ move between questions and A–D or 1–4 select an answer; these keys are ignored while typing in the note.
- **Text rendering:** escape all HTML. Support paragraphs and line breaks, fenced code blocks (`<pre><code>`) and inline `code`, without a markdown library.
- **Submit:** an in-page confirm (never `window.confirm`) showing how many questions are unanswered and bookmarked. On confirm, POST the attempt, remove the `beforeunload` guard and go to the results page.

### 11.3 Review panel
- A centred overlay about 60% of the screen wide (close to full width on narrow screens), over the dimmed exam.
- Filter chips: All · Bookmarked · Unanswered · With notes.
- Columns: `#`, Question (the first sentence on one line, with an ellipsis), ★, **Note**, and Status (answered or unanswered).
- **Note column:** questions without a note show `—`. Otherwise the cell is a clickable chip with the note's first 3 words, plus `…` if the note is longer. Clicking the chip opens a small read-only popover next to it with the full note.
- Clicking a row jumps to that question and closes the panel.
- **Layered dismissal:** while a popover is open, the first click anywhere outside it closes only the popover; clicking another note chip switches the popover directly. With no popover open, clicking outside the panel (the dimmed area) closes the review panel. `Esc` closes whichever layer is on top.
- The first sentence is the text up to the first `. `, `? `, `! ` or line break, capped at about 120 characters.

### 11.4 Results
- **Header:** the score % (large), `correct / total`, the completed time (red if overtime), "Taken continuously" or "Paused during exam", and a **Revised** switch. The switch PATCHes the attempt and appears as a marker in the history table.
- **Domain breakdown:** one row per domain, in the exam's order: `D1 · name | correct / total | %`, with a horizontal bar. A domain below the pass mark shows its % and bar in red; the rest show in green. A domain with no questions shows "no questions".
- **Every question in order:** the text, all 4 choices with the correct one and your choice clearly marked (correct or incorrect), the domain tag, the explanation, your note if you wrote one, and the bookmark star.
- **Buttons:** Back to library and Retake.

### 11.5 Settings (overlay panel opened from the library)
- **Theme:** Light / Dark. **Style:** Classic / Modern. That gives four combinations. Changes apply instantly and are saved with PUT.
  - *Classic* imitates a test-centre client: Arial/Helvetica, flat grey bars, square corners, one muted blue, no shadows and no animations.
  - *Modern* uses the same layout with the system UI font, about 8px corner radius, a softer palette, a subtle accent, roughly 120ms transitions and light shadows on overlays.
  - Layout, sizes and positions are identical across all four; only the tokens change. Implement this with CSS custom properties: one token set per theme plus a style layer, keyed on `[data-theme]` and `[data-style]`.
- **Pass mark:** a number from 1 to 100, default 70. The green rule and the domain bars use it.
- **Manage exams:** a table with the columns `exam | time (min) | attempts | Parse issue | Delete`.
  - **Time:** saving the exam's default value removes the override. The label reads "default" or "changed · default N". A change only affects new attempts.
  - **Parse issue:** an on/off toggle that shows 🔧 when on (section 10b).
  - **Delete:** opens an inline confirm row reading "Delete <id>, its original .md and N attempts? This can't be undone.", with **Delete for good** and Cancel buttons.

### 11.6 General UI rules
- Every user-supplied string is inserted as text (`textContent`) or escaped first. Raw content never goes into `innerHTML`.
- There are no `alert`, `confirm` or `prompt` dialogs. Every confirmation happens in the page.
- Keyboard focus is always visible. The layout works at laptop widths and degrades acceptably in narrow windows.

## 12. Verification

1. **Unit tests:** `python3 -m unittest discover tests`
   - The valid sample parses into the expected structure, domains included.
   - Each file in `samples/broken/` produces its specific error, and a file with several problems reports all of them.
   - Green rule: the highest clean score at or above the pass mark is green. Nothing is green when the top score is paused, overtime, or below the pass mark. On a tie, the most recent clean attempt wins. No attempts means nothing is green. Changing the pass mark re-evaluates the result.
   - Scoring, domain scores and overtime are computed correctly.
2. **API smoke test** (with the server running, using `curl --data-binary @file`):
   - Uploading the sample returns 201, and uploading it again returns 409.
   - A broken sample returns 422 with the errors, and a bad filename returns 400. Nothing is written for any failure.
   - The exam list includes the sample.
   - POSTing an attempt returns domain scores. PATCHing `revised` and toggling the parse-issue flag both work.
   - DELETE removes every file for the exam, along with its override and flag.
3. **Parse-fix flow:**
   - Flag the sample, and check that `manage.py list-flagged` shows it.
   - `reconvert` replaces the JSON and keeps the attempts.
   - `reconvert` against an invalid raw file changes nothing.
   - `unflag` clears the flag.
4. **Browser walkthrough:**
   - Drop the sample into the library. Copy the prompt both with the block collapsed and with it open.
   - Take the exam: answer questions, bookmark some, write notes, and use the keyboard shortcuts.
   - In the review panel, check the filters, the note popover, layered dismissal and `Esc`, and jump to a question.
   - Pause and resume. Set the exam's time to 1 minute in Settings, then check that the timer turns red and counts overtime.
   - Submit. The results page shows the domain breakdown, notes, explanations, the paused flag and the overtime in red. Turn Revised on and check that it is still on after a reload.
   - Retake the exam and check that it starts empty. Build up attempts that exercise the green rule and check the tally marks.
   - Search with plain text and with a `/regex/`. Switch between tableau and list views.
   - Check all four theme × style combinations. Delete an exam, and toggle its parse issue.
   - Try to close the tab mid-exam: the browser asks "Leave site?", and leaving records no attempt.
   - Restart the server and check that everything persists.

## 13. Git workflow (strict, required)

The history is meant to be replayed and individual modules redesigned later, so commit discipline is part of the spec.

- **One module per commit, in the order below.** Never batch two steps into one commit, and never leave unrelated changes in the working tree when committing.
- **Tests stay green.** From step 4 onward, run `python3 -m unittest discover tests` before every commit. Never commit failing tests.
- **Every commit runs.** The app at each commit must start and work up to that step's features. Later steps add to it and never require reworking earlier steps.
- **History is append-only.** No amending, rebasing, squashing or force-pushing. A mistake is fixed with a new commit whose message starts with `Fix`.
- **Messages:** short, imperative and descriptive, as listed below. No AI attribution trailers (such as `Co-Authored-By`) and no generated-by footers.
- **Branch:** `main`.
- **Later changes** (bug fixes, parser fixes from section 10b, redesigns) follow the same rules: one concern per commit.

Commit sequence:
1. `Add reproducible plan v1.2`: this file and `.gitignore`.
2. `Add exam format prompt for AI generators`: `prompt-for-exam.md`.
3. `Add markdown exam converter with validation`: `converter.py`.
4. `Add converter samples and tests`: `samples/` and `tests/test_converter.py`.
5. `Add storage layer with scoring and green tally rule`: `store.py` and `tests/test_rules.py`.
6. `Add local HTTP server and JSON API`: `server.py`.
7. `Add maintenance CLI and parse-fix agent guide`: `manage.py` and `fix-parse-agent.md`.
8. `Add web app shell and theme tokens`: `web/index.html`, `web/style.css`, and `web/js/app.js`, `api.js` and `util.js`.
9. `Add exam library view`: `web/js/library.js`.
10. `Add exam screen with timer, notes and review panel`: `web/js/exam.js`.
11. `Add results view with domain breakdown`: `web/js/results.js`.
12. `Add settings panel`: `web/js/settings.js`.
13. `Add README`.

## 14. Out of scope (v1)

Notes export · autosave or resume of in-progress attempts · multi-select questions · editing exam content in the app · user accounts or remote access · merging multi-part exam files · domain weights or targets.

## Changelog

- **1.2 (2026-10-27):** Domain classification end to end (`domain_count` and `# Domains` in the format, `Domain:` on each answer, per-domain scores, a domain breakdown on the results page). The library's default view is now a spider-solitaire tableau. The web app is split into one module per file. A strict git workflow is required. The plan is frozen for reuse.
- **1.1 (2026-10-27):** Parse-issue flag (a 🔧 toggle in Manage exams and on cards), `fix-parse-agent.md`, and `manage.py` with `list-flagged`, `reconvert` and `unflag`.
- **1.0 (2026-10-27):** First complete plan: the markdown format and prompt spec, drag-and-drop import with duplicate rejection, the library (search, stacks, tally marks, green rule), attempts and retakes, the exam screen with bookmarks and notes, the review panel with note popovers, the timer with overtime and the pause warning, results with a Revised switch, and settings (theme × style, pass mark, manage exams).
