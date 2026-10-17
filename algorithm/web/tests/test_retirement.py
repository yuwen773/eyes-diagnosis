"""Final delivery scan at the command-line seam, including negative fixtures."""
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCANNER = ROOT / "scripts/verify_retirement.py"


@pytest.mark.parametrize("name,content", [
    ("src/main/java/Example.java", "class Example {}"),
    ("pom.xml", "<project/>"),
    (".github/workflows/build.yml", "steps:\n  - uses: actions/setup-java@v4\n"),
    ("scripts/start.ps1", "& java.exe -jar app.jar\n"),
    ("algorithm/requirements-web.lock", "tika==3.1.0\n"),
    ("algorithm/web/example.py", "Path('src/main/resources/schema.sql').read_text()\n"),
    ("deploy/python/Dockerfile", "RUN apt-get install -y openjdk-21-jre\n"),
    ("README.md", "```sh\nmvn package\n```\n"),
    ("frontend/package.json", '{"scripts":{"start":"java -jar backend.jar"}}'),
    ("algorithm/web/example.py", "import os\nos.getenv('JAVA_BASE_URL')\n"),
])
def test_delivery_scan_rejects_jvm_and_removed_source_dependencies(tmp_path, name, content):
    target = tmp_path / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    result = subprocess.run([sys.executable, str(SCANNER), "--root", str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode == 1, result.stdout + result.stderr
    assert name in result.stdout


def test_delivery_scan_accepts_python_and_separately_marked_history(tmp_path):
    for name, content in [("scripts/start.ps1", "& python -m web.delivery\n"),
                          ("docs/history/java/README.md", "mvn package\n"),
                          ("algorithm/web/compatibility.py", '# Former Java wire format\nVALUE = "java-compatible"\n')]:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    result = subprocess.run([sys.executable, str(SCANNER), "--root", str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
