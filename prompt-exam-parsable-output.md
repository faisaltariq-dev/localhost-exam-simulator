# prompt-exam-parsable-output.md

This file defines the exact output format for a practice exam that will be loaded into my local exam simulator. Follow my message for the content, topics and difficulty, and follow this file only for the structure.

## Output
- Produce ONE markdown file named:
  questions-and-answers-<maker>-<exam>-<number>.md
  all lowercase, words joined with hyphens. Example: questions-and-answers-gcp-adp-1.md
- Start with the filename on its own line, then the whole file inside a single code block. Write nothing after the code block.
- Output the complete exam as one file, however long it gets: one header, one `# Domains` section, one `# Questions` section, one `# Answers` section.

## Structure (in this order)
1. A header between two `---` lines with exactly these fields:
   exam_maker, exam_name, exam_number, title, duration_minutes, domain_count, made_by, flavour
   - duration_minutes = the official exam duration, unless my message says otherwise.
   - domain_count = how many domains you list in `# Domains`.
   - made_by = your own model name and version, as precisely as you know it (at most 60 characters).
   - flavour = one plain-language line on what this exam is like, restating what my message asked for: difficulty, focus and style, e.g. "Extra hard, theory-heavy, always one tempting wrong answer" (at most 160 characters).
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
made_by: <your model name and version>
flavour: <one line on what this exam is like>
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
