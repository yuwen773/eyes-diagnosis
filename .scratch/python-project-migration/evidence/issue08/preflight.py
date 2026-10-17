"""Read-only prerequisite/history audit. Run before deleting tracked Java assets."""
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    assert git("branch", "--show-current").decode().strip() == "worktree-py-rewrite"
    head = git("rev-parse", "HEAD").decode().strip()
    evidence = ROOT / ".scratch/python-project-migration/evidence/issue07"
    digests = json.loads((evidence / "source-sha256.json").read_text())
    checked = []
    for name, expected in digests.items():
        committed = git("show", f"{head}:{name}")
        assert sha(committed) == expected, name
        # Respect existing Git newline conversion, without rewriting evidence.
        assert git("hash-object", "--path=" + name, name).strip() == git("rev-parse", head + ":" + name).strip(), name
        checked.append(name)
    suites = {}
    for name in ("full-windows/web.xml", "admission-final.xml", "rehearsal-final.xml"):
        tree = ET.parse(evidence / name)
        suite = tree.getroot().find("testsuite")
        assert suite is not None and int(suite.attrib["failures"]) == int(suite.attrib["errors"]) == 0
        suites[name] = suite.attrib
    frozen = ROOT / "deploy/python-migrations"
    manifest = json.loads((frozen / "manifest.json").read_text())
    sql = []
    for entry in manifest["files"]:
        if not entry.get("source"):
            continue
        data = (frozen / entry["asset"]).read_bytes()
        assert sha(data) == entry["sha256"] and len(data) == entry["bytes"]
        original = git("show", manifest["baselineCommit"] + ":" + entry["source"])
        assert sha(original) == entry["sourceBlobSha256"]
        current = (ROOT / entry["source"]).read_bytes()
        assert sha(current) in {entry["sha256"], entry["sourceBlobSha256"]}
        sql.append({"asset": entry["asset"], "source": entry["source"], "sha256": sha(data),
                    "sourceBlobSha256": sha(original), "bytes": len(data)})
    deletion = git("ls-files", "src", "pom.xml", "deploy/workflow-migrations/pom.xml",
                   "deploy/real-services/Issue19Probe.java").decode().splitlines()
    for name in deletion:
        assert git("hash-object", "--path=" + name, name).strip() == git("rev-parse", head + ":" + name).strip(), name
    plan = {"tag": "archive/java-before-python-retirement-2026-10-17", "commit": head,
            "removeTrackedFiles": deletion,
            "archiveExecutableTest": "algorithm/web/tests/test_cutover_rehearsal.py",
            "preserve": ["deploy/python-migrations", "deploy/workflow-migrations/sql", ".scratch", "target",
                         "algorithm/.tools", ".runtime", "untracked and pre-existing changes"],
            "sql": sql}
    (OUT / "deletion-plan.json").write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    (OUT / "preexisting-status.txt").write_bytes(git("status", "--porcelain=v1", "-uall"))
    (OUT / "preexisting.patch").write_bytes(git("diff", "--binary"))
    report = {"status": "PASS", "commit": head, "issue07DigestsChecked": len(checked),
              "suites": suites, "sqlAssetsChecked": len(sql), "plannedTrackedDeletions": len(deletion),
              "productionDatabase": "NOT_ACCESSED", "historyTag": "TO_CREATE_BEFORE_DELETION"}
    (OUT / "preflight.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
