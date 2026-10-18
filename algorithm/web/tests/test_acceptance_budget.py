"""The acceptance cap survives concurrency, failures, and reconstruction."""
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import threading

import pytest
import requests

spec = importlib.util.spec_from_file_location("acceptance_provider", Path(__file__).resolve().parents[3] /
                                            "scripts/acceptance_provider.py")
provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provider)


def test_shared_budget_is_atomic_and_never_refunds_failed_calls(tmp_path):
    path = tmp_path / "budget.sqlite3"
    budget = provider.Budget(path)

    def attempt(_):
        try:
            call = provider.Budget(path).reserve("llm", 1)
            budget.finish(call, 401)
            return True
        except provider.BudgetExceeded:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(attempt, range(64))) == 50
    restored = provider.Budget(path)
    assert restored.summary()["llm"] == {"used": 50, "limit": 50}
    restored.reserve("embedding", 499)
    with pytest.raises(provider.BudgetExceeded):
        restored.reserve("embedding", 2)
    assert provider.Budget(path).summary()["embedding"]["used"] == 499


def test_relay_rejects_extra_paths_and_oversized_batches_before_forwarding(tmp_path):
    budget = provider.Budget(tmp_path / "budget.sqlite3")
    with provider.relay(budget, "https://upstream.invalid/v1", "controlled-key") as url:
        headers = {"Authorization": "Bearer controlled-key"}
        assert requests.post(url + "/models", headers=headers, json={}).status_code == 404
        assert requests.post(url + "/embeddings", headers=headers,
                             json={"input": ["text"] * 501}).status_code == 429
        assert requests.post(url + "/embeddings", json={"input": ["text"]}).status_code == 401
    assert budget.summary()["embedding"]["used"] == 0


def test_relay_preserves_real_http_bytes_and_counts_denied_requests(tmp_path):
    seen = []
    reply = b'data: {"choices":[{"delta":{"content":"unchanged"}}]}\n\ndata: [DONE]\n\n'

    class Upstream(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            payload = self.rfile.read(int(self.headers["Content-Length"]))
            seen.append((self.path, payload, self.headers["Authorization"]))
            self.send_response(200 if len(seen) == 1 else 401)
            self.send_header("Content-Type", "text/event-stream" if len(seen) == 1 else "application/json")
            self.send_header("x-request-id", "controlled-request")
            self.end_headers()
            self.wfile.write(reply if len(seen) == 1 else b'{"error":{"code":"denied"}}')

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    budget = provider.Budget(tmp_path / "budget.sqlite3")
    body = json.dumps({"stream": True, "messages": [{"role": "user", "content": "probe"}]}).encode()
    try:
        with provider.relay(budget, f"http://127.0.0.1:{upstream.server_port}/v1", "test-key") as url:
            headers = {"Authorization": "Bearer test-key"}
            assert requests.post(url + "/chat/completions", headers=headers, data=body).content == reply
            assert requests.post(url + "/chat/completions", headers=headers, data=body).status_code == 401
        assert all(item == ("/v1/chat/completions", body, "Bearer test-key") for item in seen)
        assert provider.Budget(budget.path).summary()["llm"]["used"] == 2
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join()
