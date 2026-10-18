"""No secret values printed; compare pre-existing tracked diffs and scan artifacts."""
import json
from pathlib import Path
import subprocess
import sys

RUN = Path(__file__).resolve().parent
ROOT = RUN.parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from accept_python_migration import credentials

private = credentials()
values = {key: private[key].encode() for key in ("DASHSCOPE_API_KEY", "COS_SECRET_ID", "COS_SECRET_KEY")}
findings = []
count = 0
for path in RUN.rglob("*"):
    if not path.is_file() or path.name == "run.lock" or "runtime" in path.relative_to(RUN).parts:
        continue
    count += 1
    raw = path.read_bytes()
    for key, value in values.items():
        if value in raw:
            findings.append({"path": str(path.relative_to(RUN)), "field": key})

def sections(raw):
    return {part.splitlines()[0]: part for part in raw.split(b"diff --git ")[1:]}

before = sections((RUN / "preexisting.patch").read_bytes())
now = sections(subprocess.check_output(["git", "diff", "--binary"], cwd=ROOT))
changed = [key.decode(errors="replace") for key, value in before.items() if now.get(key) != value]
result = {"secretScan": "PASS" if not findings else "FAIL", "filesScanned": count,
          "findings": findings, "preexistingTrackedDiffs": "PASS" if not changed else "FAIL",
          "changedPreexistingDiffs": changed,
          "privateRuntime": "Excluded from public artifacts and Git; retained on this machine"}
(RUN / "evidence-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
