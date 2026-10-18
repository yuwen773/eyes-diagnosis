"""Local transparent provider relay with a durable, shared acceptance budget."""
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4

import requests


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    # SQLite here is a local call journal only; application data remains MySQL.
    def __init__(self, path: Path):
        self.path = path
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, kind TEXT, units INTEGER, "
                       "started TEXT, status INTEGER, request_id TEXT, usage TEXT)")
            if "error" not in {row[1] for row in db.execute("PRAGMA table_info(calls)")}:
                db.execute("ALTER TABLE calls ADD COLUMN error TEXT")

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def reserve(self, kind, units):
        if kind not in {"llm", "embedding"} or units < 1:
            raise ValueError("Invalid budget reservation")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            used = db.execute("SELECT COALESCE(SUM(units),0) FROM calls WHERE kind=?", (kind,)).fetchone()[0]
            if used + units > {"llm": 50, "embedding": 500}[kind]:
                raise BudgetExceeded(kind)
            call_id = uuid4().hex
            db.execute("INSERT INTO calls(id,kind,units,started) VALUES (?,?,?,?)",
                       (call_id, kind, units, datetime.now(timezone.utc).isoformat()))
        return call_id

    def finish(self, call_id, status, request_id=None, usage=None, error=None):
        with self.connect() as db:
            db.execute("UPDATE calls SET status=?,request_id=?,usage=?,error=? WHERE id=?",
                       (status, request_id, json.dumps(usage) if usage else None,
                        json.dumps(error) if error else None, call_id))

    def summary(self):
        with self.connect() as db:
            return {kind: {"used": db.execute("SELECT COALESCE(SUM(units),0) FROM calls WHERE kind=?",
                                             (kind,)).fetchone()[0], "limit": limit}
                    for kind, limit in (("llm", 50), ("embedding", 500))}


@contextmanager
def relay(budget: Budget, upstream: str, api_key: str, port=0):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *args):
            pass

        def do_POST(self):
            paths = {"/v1/chat/completions": "llm", "/v1/embeddings": "embedding"}
            if self.path not in paths:
                self.send_error(404)
                return
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + api_key):
                self.send_error(401)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 20 * 1024 * 1024:
                self.send_error(400)
                return
            payload = self.rfile.read(length)
            try:
                parsed = json.loads(payload)
                kind = paths[self.path]
                texts = parsed.get("input")
                if kind == "embedding" and not (isinstance(texts, str) or
                        isinstance(texts, list) and texts and all(isinstance(t, str) for t in texts)):
                    raise ValueError("Only text embeddings are allowed")
                units = len(texts) if kind == "embedding" and isinstance(texts, list) else 1
                call_id = budget.reserve(kind, units)
            except BudgetExceeded:
                self.send_error(429, "Acceptance budget exhausted")
                return
            except (ValueError, TypeError, AttributeError):
                self.send_error(400)
                return
            status, request_id, usage, error = 0, None, None, None
            sent_headers = False
            try:
                with requests.Session() as session:
                    session.trust_env = False
                    with session.post(upstream.rstrip("/") + self.path.removeprefix("/v1"),
                                      data=payload, headers={"Authorization": "Bearer " + api_key,
                                      "Content-Type": "application/json", "Accept-Encoding": "identity"},
                                      stream=True, timeout=(15, 180), allow_redirects=False) as response:
                        status = response.status_code
                        request_id = response.headers.get("x-request-id") or response.headers.get("request-id")
                        self.send_response(status)
                        self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                        self.end_headers()
                        sent_headers = True
                        captured = bytearray()
                        for chunk in response.iter_content(chunk_size=1 if parsed.get("stream") else 65536):
                            if len(captured) < 1024 * 1024:
                                captured.extend(chunk)
                            self.wfile.write(chunk)
                            self.wfile.flush()
                        # Retain only request ID/usage; never persist response text.
                        for line in (bytes(captured).splitlines() if parsed.get("stream") else [bytes(captured)]):
                            try:
                                item = json.loads(line.removeprefix(b"data: "))
                                if isinstance(item, dict):
                                    usage = item.get("usage") or usage
                                    request_id = request_id or item.get("request_id") or item.get("id")
                                    if status >= 400 and isinstance(item.get("error"), dict):
                                        error = {key: str(item["error"].get(key, ""))[:1000].replace(api_key, "[REDACTED]")
                                                 for key in ("code", "type", "message")}
                            except ValueError:
                                pass
            except (requests.RequestException, OSError):
                if not sent_headers:
                    self.send_error(502, "Provider transport unavailable")
            finally:
                budget.finish(call_id, status, request_id, usage, error)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    # Closing the relay must wait for in-flight calls, preserving final counts.
    server.daemon_threads = False
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
