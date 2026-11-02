import os
import sys
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import server  # noqa: E402


class PromptRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.Handler.log_message = lambda *a: None
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def fetch(self, name):
        with urlopen(self.base + "/" + name) as res:
            with open(os.path.join(ROOT, name), "rb") as f:
                self.assertEqual(res.read(), f.read())

    def test_parsable_prompt_served(self):
        self.fetch("prompt-exam-parsable-output.md")

    def test_revise_prompt_served(self):
        self.fetch("prompt-exam-revise.md")


if __name__ == "__main__":
    unittest.main()
