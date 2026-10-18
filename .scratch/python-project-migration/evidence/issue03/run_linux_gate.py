import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[4]
work = Path.home() / ".cache/eye-doc-issue03"
binary = work / "no-jvm-bin"
binary.mkdir(exist_ok=True)
for name in ("sh", "dirname", "basename", "readlink", "uname", "grep", "sed", "ls", "pwd", "cat"):
    link = binary / name
    if not link.exists():
        link.symlink_to(shutil.which(name))
env = os.environ.copy()
env.pop("JAVA_HOME", None)
env.update(PATH=str(binary) + os.pathsep + str(Path(sys.executable).parent),
    DOC_TOOL_HOME=str(work / "libreoffice-verified"), PYTHONPATH=str(root / "algorithm"))
assert shutil.which("java", path=env["PATH"]) is None
with (Path(__file__).parent / "samples-linux.log").open("wb") as log:
    result = subprocess.run([sys.executable, "-m", "pytest", "web/tests/test_no_jvm_doc.py", "-q"],
        cwd=root / "algorithm", env=env, stdout=log, stderr=log, timeout=240)
(Path(__file__).parent / "linux-gate.json").write_text(json.dumps({
    "javaOnPath": False, "javaHome": False, "python": sys.version, "exitCode": result.returncode,
    "tool": json.loads((work / "libreoffice-verified/eye-doc-tool.json").read_text())}, indent=2) + "\n")
raise SystemExit(result.returncode)
