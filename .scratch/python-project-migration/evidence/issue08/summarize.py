"""Record supported Windows gates and explicitly deferred Linux acceptance."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8-sig"))


def suite(name):
    node = ET.parse(OUT / name).getroot().find("testsuite")
    result = {key: int(node.attrib[key]) for key in ("tests", "errors", "failures", "skipped")}
    result.update(passed=result["tests"] - result["skipped"] - result["errors"] - result["failures"],
                  seconds=float(node.attrib["time"]), evidence=name)
    assert result["errors"] == result["failures"] == 0, name
    return result


def main():
    plan, preflight = read("deletion-plan.json"), read("preflight.json")
    tag = subprocess.check_output(["git", "rev-parse", plan["tag"] + "^{commit}"], cwd=ROOT).decode().strip()
    assert tag == preflight["commit"]
    for name in plan["removeTrackedFiles"]:
        assert not (ROOT / name).exists(), name
    for item in plan["sql"]:
        assert hashlib.sha256((ROOT / "deploy/python-migrations" / item["asset"]).read_bytes()).hexdigest() == item["sha256"]
    name = "windows-infrastructure-accepted"
    services = read(name + "/services/results.json")
    assert services["status"] == "PASS_WITH_LIMITATIONS"
    assert all(services["gates"][key]["status"] == "PASS" for key in ("infrastructure", "orchestration", "mysqlSemantics"))
    infrastructure = {"windows": {"services": services, "handoff": suite(name + "/handoff.xml")},
                      "linux": {"status": "NOT_COMPLETED", "reason": "Docker stopped at explicit user request",
                                "lastAttempt": "linux-infrastructure-final/services/results.json"}}
    runtime = Path(services["runtime"]).resolve()
    assert runtime.is_relative_to((ROOT / ".scratch/baseline-runtime").resolve())
    for kind in ("worker-concurrency", "human-wait-restart"):
        destination = OUT / name / kind
        destination.mkdir(exist_ok=True)
        for filename in ("results.json", "mysql-tests.log"):
            (destination / filename).write_bytes((runtime / kind / filename).read_bytes())
        result = read(name + "/" + kind + "/results.json")
        assert all(value["exitCode"] == 0 for value in result["commands"].values())
        log = (destination / "mysql-tests.log").read_text(encoding="utf-8")
        passed = re.search(r"(\d+) passed", log)
        assert passed and not re.search(r"\d+ (?:failed|skipped)", log)
        infrastructure["windows"][kind] = {"passed": int(passed[1]), "result": result,
                                            "evidence": name + "/" + kind + "/mysql-tests.log"}
    assert read("compose/results.json")["status"] == read("windows-lifecycle.json")["status"] == "PASS"
    assert read("post-delete-final-scan.json")["status"] == "PASS"
    report = {"ticket": "08-retire-java-final-verification", "status": "PARTIAL",
              "ticketStatus": "in-progress", "date": "2026-10-17", "timezone": "Asia/Shanghai",
              "baselineCommit": tag, "branch": "worktree-py-rewrite", "acceptanceCriteriaCompleted": 3,
              "scope": "Post-retirement engineering and isolated synthetic-data infrastructure; no production cutover",
              "historyTag": plan["tag"], "historyTagPushed": False,
              "issue07DigestsChecked": preflight["issue07DigestsChecked"], "frozenSQLAssetsChecked": len(plan["sql"]),
              "removedTrackedFiles": len(plan["removeTrackedFiles"]),
              "windowsFullWeb": suite("windows-full-final/web.xml"),
              "windowsFinalScannerAfterCollectionUpdate": suite("scanner-final.xml"),
              "linuxFullWeb": {"status": "NOT_COMPLETED", "evidence": "linux-full/web.xml",
                               "firstAttemptInterruptedAfterFailures": True, "failures": 3,
                               "passed": 293, "skipped": 27, "userRequestedDockerStopped": True},
              "frozenWaitUpgradeAndLegacyRebuild": suite("waits.xml"),
              "linuxAlgorithms": suite("linux-algorithms.xml"),
              "infrastructure": infrastructure,
              "frontend": {"status": "PASS", "passed": 49, "files": 13, "evidence": "frontend.log"},
              "windowsLifecycle": read("windows-lifecycle.json"), "compose": read("compose/results.json"),
              "windowsNoJVM": read("windows-no-jvm.json"), "linuxNoJVM": read("linux-no-jvm.json"),
              "linuxClock": read("linux-clock.json"),
              "images": read("images.json"), "review": {"standardsRemaining": 0, "specRemaining": 0},
              "historicalAttempts": ["windows-full/web.xml", "windows-infrastructure/services/results.json",
                                     "windows-infrastructure-final/services/results.json", "linux-infrastructure/services/results.json",
                                     "linux-full/web.xml", "linux-diagnosis.xml", "post-delete-scan.json"],
              "acceptanceBoundaries": {"hostedCI": "NOT_RUN_NO_PUSH", "productionDatabaseOrCutover": "NOT_RUN",
                  "linuxFirstCutoverRehearsal": "NOT_RUN; ticket07 Windows evidence retained",
                  "realEmbedding": "NOT_VERIFIED; historical HTTP401 unchanged", "realLLM": "NOT_VERIFIED",
                  "realClassifier": "NOT_VERIFIED; CPU constructor is an engineering check", "realCOS": "NOT_VERIFIED",
                  "clinical": "NOT_VERIFIED", "oldEvidence": "RETAINED", "originalRuntimeAndOtherEdits": "PRESERVED",
                  "dockerSettingsOrDataReset": False, "dockerState": "STOPPED_AT_USER_REQUEST", "push": False}}
    (OUT / "verification-summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("status", "windowsFullWeb", "linuxFullWeb", "linuxAlgorithms")}, indent=2))


if __name__ == "__main__":
    main()
