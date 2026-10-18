"""Local restart acceptance must reach the owned API despite ambient proxies."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from urllib.parse import urlsplit

import httpx

from web.tests.test_human_wait_restart import (
    restart_case,
    test_doctor_wait_claim_and_submitted_decision_survive_process_restart as exercise_review_restart,
)


def test_doctor_restart_replay_ignores_ambient_proxy(restart_case, monkeypatch):
    seen = []
    submissions = []

    class Proxy(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def forward(self):
            target = urlsplit(self.path)
            assert target.hostname == "127.0.0.1"
            seen.append(target.path)
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if target.path.endswith("/submit"):
                submissions.append(target.path)
                if len(submissions) == 3:
                    # Match the full-suite symptom after the worker advances:
                    # a successful status from a proxy with no JSON receipt.
                    self.send_response(200)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
            with httpx.Client(trust_env=False, timeout=20) as client:
                response = client.request(self.command, self.path, content=body,
                    headers={key: value for key, value in self.headers.items()
                             if key.lower() not in {"host", "connection", "proxy-connection"}})
            self.send_response(response.status_code)
            self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(response.content)))
            self.end_headers()
            self.wfile.write(response.content)

        do_GET = forward
        do_POST = forward

    proxy = ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
    thread = threading.Thread(target=proxy.serve_forever, daemon=True)
    thread.start()
    try:
        address = f"http://127.0.0.1:{proxy.server_port}"
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            monkeypatch.setenv(key, address)
        monkeypatch.setenv("NO_PROXY", "")
        monkeypatch.setenv("no_proxy", "")
        exercise_review_restart(restart_case, "quality")
        assert seen == [], "Local acceptance requests must go directly to the owned API"
    finally:
        proxy.shutdown()
        proxy.server_close()
        thread.join()
