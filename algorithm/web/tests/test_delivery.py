"""Installed release boundary: imports and migration assets without a checkout."""

import os
import asyncio
from pathlib import Path
import subprocess
import sys
import threading
import zipfile
from contextlib import contextmanager
from types import SimpleNamespace
import httpx
import pytest

from fastapi.testclient import TestClient
from web.app import create_app
from web.config import WebConfig


ROOT = Path(__file__).resolve().parents[3]


def test_liveness_does_not_misreport_unavailable_infrastructure_as_ready():
    client = TestClient(create_app(WebConfig(mysql_port=1, redis_port=1)))
    assert client.get("/health").json() == {"status": "up"}
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


def test_readiness_uses_the_app_configuration_even_when_environment_differs(monkeypatch):
    from web import delivery

    monkeypatch.setenv("MYSQL_PORT", "3312")
    monkeypatch.setenv("REDIS_PORT", "6382")

    @contextmanager
    def connection():
        yield SimpleNamespace(execute=lambda statement: None)

    def mysql(url, **kwargs):
        if url != "mysql+pymysql://eyeuser:@127.0.0.1:3311/diagnosis?charset=utf8mb4":
            raise ConnectionError("Wrong infrastructure")
        return SimpleNamespace(connect=connection, dispose=lambda: None)

    class RedisProbe:
        async def ping(self):
            return True

        async def aclose(self):
            pass

        @staticmethod
        def from_url(url, **kwargs):
            if url != "redis://127.0.0.1:6381/8":
                raise ConnectionError("Wrong infrastructure")
            return RedisProbe()

    monkeypatch.setattr(delivery, "create_engine", mysql)
    monkeypatch.setattr(delivery, "Redis", RedisProbe)
    client = TestClient(create_app(WebConfig(mysql_port=3311, redis_port=6381)))
    assert client.get("/ready").json() == {"status": "ready"}


@pytest.mark.asyncio
async def test_stalled_readiness_does_not_block_liveness(monkeypatch):
    from web import delivery
    started, release = threading.Event(), threading.Event()

    @contextmanager
    def connection():
        started.set()
        assert release.wait(5)
        yield SimpleNamespace(execute=lambda statement: None)

    monkeypatch.setattr(delivery, "create_engine", lambda *a, **k:
                        SimpleNamespace(connect=connection, dispose=lambda: None))
    app = create_app(WebConfig(redis_port=1))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        waiting = asyncio.create_task(client.get("/ready"))
        try:
            assert await asyncio.to_thread(started.wait, 2)
            assert not waiting.done()
            response = await asyncio.wait_for(client.get("/health"), timeout=1)
            assert response.json() == {"status": "up"}
        finally:
            release.set()
            await waiting


def test_wheel_is_installable_without_repository_or_jvm(tmp_path):
    built = subprocess.run(["uv", "build", "--wheel", "--out-dir", str(tmp_path / "dist")],
                           cwd=ROOT, capture_output=True, text=True, timeout=180)
    assert built.returncode == 0, built.stdout + built.stderr
    wheel, = (tmp_path / "dist").glob("*.whl")
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        assert any(name.endswith("python-migrations/manifest.json") for name in names)
        assert "eye_disease_model.py" in names
        assert not any(name.endswith((".java", ".jar", ".db", ".log", ".pth")) for name in names)
        assert not any("/tests/" in name or "/checkpoints/" in name for name in names)
    install = subprocess.run(["uv", "pip", "install", "--python", sys.executable,
                              "--no-deps", "--target", str(tmp_path / "installed"), str(wheel)],
                             capture_output=True, text=True, timeout=60)
    assert install.returncode == 0, install.stderr
    env = {**os.environ, "PYTHONPATH": str(tmp_path / "installed"), "JAVA_HOME": "unavailable"}
    code = "import importlib.util; assert importlib.util.find_spec('eye_disease_model'); " \
           "from web.app import create_app; from web.migrations.baseline import check_baseline; " \
           "assert create_app().openapi()['paths']; assert check_baseline()['status'] == 'BASELINE_OK'"
    run = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=env,
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stdout + run.stderr
