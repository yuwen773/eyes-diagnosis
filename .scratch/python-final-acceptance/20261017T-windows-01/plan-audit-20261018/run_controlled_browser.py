"""Enable the four optional controlled browser refresh scenarios on Windows."""
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from acceptance_runtime import Owned, processes, save

OUT = Path(__file__).resolve().parent
PROOF = OUT / "controlled-browser-waits"


def main():
    PROOF.mkdir(exist_ok=False)
    temp = ROOT / ".scratch" / ("sw18-" + uuid4().hex[:8])
    assert temp.resolve().is_relative_to((ROOT / ".scratch").resolve()) and not temp.exists()
    cases = json.loads((OUT / "inventory.json").read_text(encoding="utf-8"))
    selected = [row["nodeid"] for row in cases if "test_frozen_wait_upgrade_real_login_and_process_restart[" in row["nodeid"]]
    env = {key: value for key, value in os.environ.items() if not key.upper().endswith("_PROXY")}
    for key in ("DASHSCOPE_API_KEY", "COS_SECRET_ID", "COS_SECRET_KEY", "JAVA_HOME", "WAIT_RECOVERY_BROWSER"):
        env.pop(key, None)
    env.update(PYTHONPATH=str(ROOT / "algorithm"), PYTHONUTF8="1", PYTHONUNBUFFERED="1",
        NO_PROXY="127.0.0.1,localhost", HANDOFF_TEST_MYSQL_ADMIN_URL=env["REAL_SERVICES_MYSQL_ADMIN_URL"],
        WAIT_RECOVERY_REDIS_SERVER="D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe",
        HUMAN_WAIT_EVIDENCE_DIR=str(PROOF / "cases"), WAIT_RECOVERY_BROWSER="1")
    owned = Owned(PROOF, [env["REAL_SERVICES_MYSQL_ADMIN_URL"]])
    tracked = {}
    done = threading.Event()
    try:
        child = owned.start("recovery", [sys.executable, "-m", "pytest", *selected, "-vv", "--tb=short",
            "--basetemp=" + str(temp), "--junitxml=" + str(PROOF / "recovery.xml")], env, cwd=ROOT)

        def watch():
            while not done.is_set():
                current = processes()
                ids = {child.pid} | set(tracked)
                while True:
                    expanded = ids | {pid for pid, row in current.items() if row["ParentProcessId"] in ids}
                    if expanded == ids:
                        break
                    ids = expanded
                for pid in ids:
                    if pid in current and pid not in tracked:
                        tracked[pid] = current[pid]
                done.wait(.5)

        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            code = child.wait(timeout=1800)
        finally:
            done.set()
            watcher.join(timeout=15)
            assert not watcher.is_alive()
    finally:
        owned.close()
    current = processes()
    survivors = [pid for pid, row in tracked.items()
                 if pid in current and row["CreationDate"] == current[pid]["CreationDate"]]
    save(PROOF / "process-audit.json", {"status": "PASS" if not survivors else "FAIL",
        "registered": list(tracked.values()), "survivingRecordedProcesses": survivors})
    assert not survivors
    source = ROOT / "algorithm/web/tests/test_python_wait_recovery.py"
    save(PROOF / "result.json", {"exitCode": code, "selectedCases": len(selected),
        "tempPath": str(temp.relative_to(ROOT)), "cleanup": "PASS",
        "testSourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "scope": "Short temp path only; real local MySQL/Redis; synthetic model and decisions; headless browser option enabled; synthetic data and decisions only"})
    print(json.dumps({"exitCode": code, "selectedCases": len(selected), "cleanup": "PASS"}), flush=True)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
