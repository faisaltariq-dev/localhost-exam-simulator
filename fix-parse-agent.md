# fix-parse-agent.md

You are fixing an exam that the owner flagged with 🔧 "parse issue" in the exam simulator. The exam imported without validation errors, but something in it displays wrongly (for example a choice that swallowed the next line, or a broken code block). Fix the **parser** so this file and files like it parse correctly.

## Steps

1. List the flagged exams:
   ```
   python3 manage.py list-flagged
   ```
2. For each flagged exam, compare the raw file (`exams/raw/<file>.md`) with the converted JSON (`exams/<id>.json`) and find what was parsed wrongly. If it isn't obvious, ask the owner what looks wrong in the app.
3. Fix the parser in `converter.py` in a general way, so it handles this pattern in any file.
   - Never hand-edit `exams/<id>.json`.
   - Never edit the raw `.md`. It is the source of truth.
   - Leave `prompt-for-exam.md` unchanged unless the owner asks for it. The parser adapts to the files, not the other way round.
4. Add a minimal regression sample to `samples/` that reproduces the problem, and a test for it in `tests/test_converter.py`.
5. Run the tests. All of them must pass:
   ```
   python3 -m unittest discover tests
   ```
6. Re-convert the exam from its raw file. This replaces the JSON only if the new parse is valid, and it keeps all attempts:
   ```
   python3 manage.py reconvert <id>
   ```
7. Tell the owner, briefly, what was wrong, what you changed, and how many questions differ (`reconvert` prints this). Then clear the flag:
   ```
   python3 manage.py unflag <id>
   ```
   If the owner wants to check the exam in the app first, leave the flag on.
8. Commit following the project's git rules: one commit for the parser fix and its test, with a message such as `Fix parser: choices spanning several lines`. Don't amend or rewrite history. Don't add AI attribution trailers.

The server doesn't need a restart. It reads the files on every request.
