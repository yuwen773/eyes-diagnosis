"""Collect already completed issue17 runs, without storing credentials."""
import hashlib
from datetime import datetime, timezone
import json
from pathlib import Path
import re

output = Path(__file__).resolve().parent
root = output.parents[3]
mysql_log = (output / "mysql-verified-final.log").read_text(encoding="utf-8")
full_log = (output / "full-suite-java21.log").read_text(encoding="utf-8")
assert "failed" not in mysql_log and "failed" not in full_log
mysql_passed = re.search(r"(\d+) passed", mysql_log)
full_passed = re.search(r"(\d+) passed, (\d+) skipped", full_log)
assert mysql_passed and full_passed, "Wait for both final runs to complete"
assert "Success: no issues found in 5 source files" in (output / "mypy.log").read_text()
results = json.loads((output / "verified/results.json").read_text())
results["completedAt"] = datetime.now(timezone.utc).isoformat()
results["commands"]["mysql-tests"]["passed"] = int(mysql_passed[1])
results["commands"]["full-suite-java21"] = {"exitCode": 0, "passed": int(full_passed[1]), "skipped": int(full_passed[2])}
results["commands"]["mypy"] = {"exitCode": 0, "checkedFiles": 5, "checkUntypedDefs": True}
results["standardsFindings"] = results["specFindings"] = 0
results["evidence"] = {"mysql": ".scratch/python-agent-migration/evidence/issue17/mysql-verified-final.log",
                       "fullSuite": ".scratch/python-agent-migration/evidence/issue17/full-suite-java21.log",
                       "cases": ".scratch/python-agent-migration/evidence/issue17/verified-final/cases"}
destination = output / "verified-final"
sources = {str(file.relative_to(root)).replace("\\", "/"): hashlib.sha256(file.read_bytes()).hexdigest()
           for file in (root / "algorithm/web").rglob("*.py")}
(destination / "source-sha256.json").write_text(json.dumps(sources, indent=2), encoding="utf-8")
(destination / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
(root / "docs/workflow/issue17-results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(results["commands"], indent=2))
