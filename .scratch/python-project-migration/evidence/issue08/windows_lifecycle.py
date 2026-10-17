"""Fresh Python install and public Windows lifecycle in an owned source copy."""
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

root = Path.cwd()
output = root / ".scratch/python-project-migration/evidence/issue08"
source = root / ".scratch/baseline-runtime" / ("ticket08-windows-" + uuid4().hex) / "source"
source.mkdir(parents=True)
paths = subprocess.check_output(["git", "ls-files", "-z", "pyproject.toml", "MANIFEST.in", ".python-version",
    "algorithm/web", "algorithm/eye_diagnosis", "algorithm/mcp_server", "algorithm/eye_disease_model.py",
    "algorithm/requirements-web.lock", "deploy/python-migrations", "scripts"])
subprocess.run(["git", "checkout-index", "--stdin", "-z", "--prefix=" + source.as_posix() + "/"], input=paths, check=True)
assert not (source / "src").exists() and not (source / "pom.xml").exists()
env = {**os.environ, "TICKET08_WINDOWS_SOURCE": str(source),
       "TICKET08_WINDOWS_REPORT": str(output / "windows-lifecycle.json")}
subprocess.run(["pwsh.exe", "-NoLogo", "-NoProfile", "-File", str(source / "scripts/dev.ps1"), "install"], env=env, check=True)
helper = output / "windows_stock_smoke.py"
subprocess.run([str(source / ".venv/Scripts/python.exe"), str(helper)], env=env, cwd=source, check=True)
report = json.loads((output / "windows-lifecycle.json").read_text(encoding="utf-8"))
report.update(source=str(source), noJavaSource=True, originalRuntimeUntouched=True)
(output / "windows-lifecycle.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
