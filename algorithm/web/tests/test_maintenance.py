"""Ticket 07: public maintenance CLI and real Nginx admission boundary."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
import sys
from threading import Thread

import httpx
import pytest

from web.verify_real_services import free_port, stop_child, wait_http


def command(directory, route, policy, ports):
    return [sys.executable, "-m", "web.maintenance", "--output", str(directory / "nginx.conf"),
            "--route", route, "--policy", policy, "--listen-port", str(ports[0]),
            "--legacy-port", str(ports[1]), "--python-port", str(ports[2]),
            "--release", "5733cf33823257e8be2aa1ad2c3fd13e7b5754f0", "--artifact-sha256", "a" * 64,
            "--reason", "isolated acceptance"]


def test_first_python_write_boundary_permanently_rejects_legacy_rollback(tmp_path):
    ports = (28081, 28082, 28080)
    for route, policy in [("legacy", "readonly"), ("python", "readonly"),
                          ("legacy", "readonly"), ("python", "active"), ("python", "readonly")]:
        result = subprocess.run(command(tmp_path, route, policy, ports), capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    before = {name: (tmp_path / name).read_bytes() for name in ("nginx.conf", "maintenance.json")}
    result = subprocess.run(command(tmp_path, "legacy", "readonly", ports), capture_output=True, text=True)
    assert result.returncode != 0
    assert "forward repair" in result.stderr
    assert all((tmp_path / name).read_bytes() == value for name, value in before.items())
    ledger = json.loads(before["maintenance.json"])
    assert ledger["pythonWritesOpened"] is True
    assert len(ledger["transitions"]) == 5


def test_invalid_ports_and_concurrent_generation_preserve_installed_configuration(tmp_path):
    ports = (28081, 28082, 28080)
    assert subprocess.run(command(tmp_path, "python", "readonly", ports), capture_output=True).returncode == 0
    before = {name: (tmp_path / name).read_bytes() for name in ("nginx.conf", "maintenance.json")}
    result = subprocess.run(command(tmp_path, "python", "active", (28081, 28081, 28080)), capture_output=True)
    assert result.returncode != 0
    for reserved in ("maintenance.json", "maintenance.lock"):
        args = command(tmp_path, "python", "active", ports)
        args[args.index("--output") + 1] = str(tmp_path / reserved)
        assert subprocess.run(args, capture_output=True).returncode != 0
        assert all((tmp_path / name).read_bytes() == value for name, value in before.items())
    (tmp_path / "maintenance.lock").touch()
    result = subprocess.run(command(tmp_path, "python", "active", ports), capture_output=True)
    assert result.returncode != 0 and b"locked" in result.stderr
    assert (tmp_path / "maintenance.lock").exists()
    assert all((tmp_path / name).read_bytes() == value for name, value in before.items())


@pytest.fixture
def gateway(tmp_path):
    nginx = os.getenv("CUTOVER_NGINX")
    if not nginx:
        pytest.skip("CUTOVER_NGINX required for real Nginx admission checks")
    servers = []
    children = []
    for role in ("legacy", "python"):
        class Handler(BaseHTTPRequestHandler):
            backend = role

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(f"{self.backend} {self.path}".encode())

            do_POST = do_PUT = do_PATCH = do_DELETE = do_GET

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
    ports = (free_port(), servers[0].server_port, servers[1].server_port)

    def start(route, policy):
        result = subprocess.run(command(tmp_path, route, policy, ports), capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        args = [nginx, "-p", tmp_path.as_posix() + "/", "-c", (tmp_path / "nginx.conf").as_posix()]
        subprocess.run([*args, "-t"], check=True, capture_output=True)
        child = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        children.append(child)
        wait_http(child, f"http://127.0.0.1:{ports[0]}/health")
        return httpx.Client(base_url=f"http://127.0.0.1:{ports[0]}", trust_env=False)

    yield start
    for child in children:
        stop_child(child)
    for server in servers:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize("route", ["legacy", "python"])
def test_maintenance_blocks_business_and_workflow_writes_but_allows_login_and_reads(gateway, route):
    with gateway(route, "readonly") as client:
        assert client.post("/api/user/login").text.startswith(route)
        assert client.get("/api/news/get/1").text.startswith(route)
        assert client.post("/api/diagnosis/list/page/my", json={}).status_code == 200
        for method, path in [("POST", "/api/news/add"), ("POST", "/api/user/register"),
                             ("POST", "/api/diagnosis/upload"), ("POST", "/api/knowledge/upload"),
                             ("POST", "/api/agent/chat/stream"), ("POST", "/api/diagnosis/workflows"),
                             ("POST", "/api/reviews/tasks/r/submit"),
                             ("POST", "/api/diagnosis/workflows/w/save-confirmation/approve"),
                             ("PATCH", "/api/knowledge/1/governance"), ("DELETE", "/api/user/1"),
                             ("POST", "/api/user/login/extra"), ("POST", "/api/news/list/page/vo/extra")]:
            response = client.request(method, path)
            assert response.status_code == 503, (method, path, response.text)
            assert response.headers["Retry-After"] == "60"


def test_active_python_routes_all_business_and_identity_to_python(gateway):
    with gateway("python", "active") as client:
        for path in ("/api/user/login", "/api/news/add", "/api/diagnosis/workflows"):
            assert client.post(path).text.startswith("python")
