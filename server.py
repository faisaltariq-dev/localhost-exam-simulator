"""Local exam simulator server: static files from web/ plus a small JSON API.

    python3 server.py [--port 8000]

Binds to 127.0.0.1 only. Standard library only.
"""
import argparse
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from store import Store, StoreError

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
PROMPT_PATH = os.path.join(ROOT, "prompt-for-exam.md")
MAX_BODY = 10 * 1024 * 1024
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
}

ID = r"([a-z0-9]+-[a-z0-9]+-[1-9][0-9]*)"
ROUTES = []


def route(method, pattern):
    def wrap(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn))
        return fn
    return wrap


class Handler(BaseHTTPRequestHandler):
    server_version = "ExamSimulator/1"
    store = None  # set in main()

    # -- plumbing

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, data=None):
        body = b"" if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def send_file(self, path):
        ext = os.path.splitext(path)[1]
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise StoreError(413, "File is larger than 10 MB")
        return self.rfile.read(length) if length else b""

    def read_json(self):
        try:
            return json.loads(self.read_body() or b"null")
        except ValueError:
            raise StoreError(400, "Body must be valid JSON")

    def dispatch(self, method):
        url = urlsplit(self.path)
        path = unquote(url.path)
        self.query = parse_qs(url.query)
        try:
            for m, pattern, fn in ROUTES:
                match = pattern.match(path)
                if m == method and match:
                    return fn(self, *match.groups())
            if method == "GET":
                return self.serve_static(path)
            raise StoreError(404, "Not found")
        except StoreError as e:
            body = {"errors": e.errors} if e.errors else {"error": e.message}
            body.update(e.extra)
            self.send_json(e.status, body)
        except Exception as e:  # keep the server alive and say what happened
            self.log_message("ERROR %r", e)
            self.send_json(500, {"error": "Server error: %s" % e})

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        full = os.path.realpath(os.path.join(WEB_DIR, path.lstrip("/")))
        if not full.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(full):
            raise StoreError(404, "Not found")
        self.send_file(full)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_PATCH(self):
        self.dispatch("PATCH")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # -- routes

    @route("GET", r"/prompt-for-exam\.md")
    def get_prompt(self):
        self.send_file(PROMPT_PATH)

    @route("POST", r"/api/upload")
    def upload(self):
        filename = (self.query.get("filename") or [""])[0]
        try:
            text = self.read_body().decode("utf-8")
        except UnicodeDecodeError:
            raise StoreError(400, errors=["The file must be UTF-8 text"])
        self.send_json(201, self.store.import_exam(filename, text))

    @route("GET", r"/api/exams")
    def list_exams(self):
        self.send_json(200, self.store.exam_summaries())

    @route("GET", r"/api/exams/" + ID)
    def get_exam(self, exam_id):
        self.send_json(200, self.store.exam_for_client(exam_id))

    @route("DELETE", r"/api/exams/" + ID)
    def delete_exam(self, exam_id):
        self.store.delete_exam(exam_id)
        self.send_json(204)

    @route("GET", r"/api/exams/" + ID + r"/attempts")
    def get_attempts(self, exam_id):
        self.send_json(200, self.store.attempts_for_client(exam_id))

    @route("POST", r"/api/exams/" + ID + r"/attempts")
    def post_attempt(self, exam_id):
        self.send_json(201, self.store.add_attempt(exam_id, self.read_json()))

    @route("PATCH", r"/api/exams/" + ID + r"/attempts/([1-9][0-9]*)")
    def patch_attempt(self, exam_id, number):
        body = self.read_json()
        if not isinstance(body, dict) or not isinstance(body.get("revised"), bool):
            raise StoreError(400, "Body must be {\"revised\": true|false}")
        self.send_json(200, self.store.set_revised(exam_id, int(number), body["revised"]))

    @route("GET", r"/api/repairs")
    def get_repairs(self):
        self.send_json(200, self.store.repairs_status())

    @route("POST", r"/api/repairs")
    def post_repairs(self):
        body = self.read_json()
        if not isinstance(body, dict) or not isinstance(body.get("text"), str):
            raise StoreError(400, "Body must be {\"text\": \"...\", \"reason\": \"...\"}")
        self.send_json(201, self.store.send_to_repairs(body["text"], str(body.get("reason") or "")))

    @route("POST", r"/api/repairs/([1-9][0-9]*)/approve")
    def approve_repair(self, number):
        self.send_json(200, self.store.approve_repair(int(number)))

    @route("POST", r"/api/repairs/([1-9][0-9]*)/reject")
    def reject_repair(self, number):
        body = self.read_json() or {}
        self.store.reject_repair(int(number), str(body.get("reason") or ""))
        self.send_json(200, {"ok": True})

    @route("POST", r"/api/repairs/([1-9][0-9]*)/note")
    def note_repair(self, number):
        body = self.read_json() or {}
        self.store.note_repair(int(number), str(body.get("text") or ""))
        self.send_json(200, {"ok": True})

    @route("GET", r"/api/settings")
    def get_settings(self):
        self.send_json(200, self.store.load_settings())

    @route("PUT", r"/api/settings")
    def put_settings(self):
        self.send_json(200, self.store.update_settings(self.read_json()))


def main():
    parser = argparse.ArgumentParser(description="Local exam simulator")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    Handler.store = Store(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("Exam simulator running at http://localhost:%d  (Ctrl+C to stop)" % args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
