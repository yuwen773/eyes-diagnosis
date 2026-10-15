"""Exercise the deployment CLI through real Nginx HTTP, with labelled backends."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
from threading import Thread

import httpx
import pytest

from web.verify_real_services import free_port, stop_child, wait_http


@pytest.fixture
def proxy(tmp_path):
    nginx = os.getenv("CUTOVER_NGINX")
    if not nginx:
        pytest.skip("CUTOVER_NGINX required for real proxy tests")
    servers = []
    for role in ("java", "python"):
        class Handler(BaseHTTPRequestHandler):
            backend = role

            def do_GET(self):
                self.send_response(200)
                self.send_header("X-Seen-Host", self.headers.get("Host", ""))
                self.end_headers()
                self.wfile.write(f"{self.backend} {self.path} {self.headers.get('Cookie', '')}".encode())

            do_POST = do_GET

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
    port = free_port()
    children = []

    def start(*flags):
        config = tmp_path / "nginx.conf"
        result = subprocess.run([sys.executable, "-m", "web.cutover", "--output", str(config),
            "--listen-port", str(port), "--java-port", str(servers[0].server_port),
            "--python-port", str(servers[1].server_port), "--frontend", str(tmp_path), *flags],
            capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        command = [nginx, "-p", tmp_path.as_posix() + "/", "-c", config.as_posix()]
        subprocess.run([*command, "-t"], check=True, capture_output=True)
        child = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        children.append(child)
        wait_http(child, f"http://127.0.0.1:{port}/health")
        return httpx.Client(base_url=f"http://127.0.0.1:{port}", headers={"Cookie": "SESSION=synthetic"})

    yield start
    for child in children:
        stop_child(child)
    for server in servers:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize("business,agent,policy", [
    ("java", "java", "pause"), ("python", "java", "pause"),
    ("python", "python", "active"), ("java", "python", "drain"),
])
def test_independent_routes_retain_python_state_and_cookie(proxy, business, agent, policy):
    with proxy("--business", business, "--agent", agent, "--workflows", policy) as client:
        assert client.post("/api/user/login").text.startswith("java ")
        assert client.get("/api/user/get/login").text.endswith("SESSION=synthetic")
        assert client.get("/api/user/get/login").headers["X-Seen-Host"] == client.base_url.netloc.decode()
        assert client.post("/api/news/list/page/vo").text.startswith(business + " ")
        stream = client.post("/api/agent/chat/stream")
        if agent == "python" and policy != "active":
            assert stream.status_code == 503
        else:
            assert stream.text.startswith(agent + " ")
        for path in ("/api/diagnosis/workflows/w1", "/api/reviews/tasks/r1"):
            assert client.get(path).text.startswith("python ")
            assert client.post(path).status_code == (503 if policy == "pause" else 200)
        recovery = client.get("/api/python-recovery/history/s1")
        assert recovery.text == "python /api/agent/history/s1 SESSION=synthetic"
        assert client.post("/api/python-recovery/chat/stream").status_code == 503
        assert client.post("/api/python-recovery/supplements/s1/reply").status_code == (503 if policy == "pause" else 200)
        assert client.post("/api/diagnosis/workflows").status_code == (200 if policy == "active" else 503)


def test_port_loop_is_rejected_without_writing_configuration(tmp_path):
    config = tmp_path / "nginx.conf"
    result = subprocess.run([sys.executable, "-m", "web.cutover", "--output", str(config),
        "--listen-port", "8081", "--java-port", "8081"], capture_output=True, text=True)
    assert result.returncode != 0
    assert not config.exists()
