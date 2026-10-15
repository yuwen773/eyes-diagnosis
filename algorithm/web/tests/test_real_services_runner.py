"""Issue 19 acceptance CLI: unavailable services never become a green result."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("url", [None, "sqlite:///pretend.db", "mysql+pymysql://root:private-test-password@remote/diagnosis"])
def test_missing_or_unsafe_infrastructure_is_reported_as_blocked(tmp_path, url):
    env = {k: v for k, v in os.environ.items() if not k.startswith("REAL_SERVICES_")}
    env.pop("DASHSCOPE_API_KEY", None)
    if url:
        env["REAL_SERVICES_MYSQL_ADMIN_URL"] = url
    result = subprocess.run([sys.executable, "-m", "web.verify_real_services",
        "--output-dir", str(tmp_path)], cwd=Path(__file__).resolve().parents[2],
        env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2, result.stdout + result.stderr
    report = json.loads((tmp_path / "results.json").read_text(encoding="utf-8"))
    assert report["status"] == "BLOCKED"
    assert report["gates"]["realEmbedding"]["status"] == "BLOCKED"
    assert report["gates"]["infrastructure"]["status"] == "BLOCKED"
    assert report["gates"]["realClassifier"]["status"] == "NOT_VERIFIED"
    assert report["checks"] == []
    assert "Traceback" not in result.stderr
    assert "private-test-password" not in result.stdout + result.stderr
