"""Replay the 43 environment-gated skips with real local MySQL 8 / Nginx / Redis.

New evidence directory; prior attempts are retained untouched. Never approves a
human decision and never writes a formal diagnosis record.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from uuid import uuid4

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
PRIOR_RUN = ROOT / ".scratch/python-final-acceptance/20261017T-windows-01"
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]

import acceptance_runtime
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from acceptance_runtime import Owned, save
from acceptance_observe import observe


def processes():
    """Same process inventory as acceptance_runtime, tolerating non-UTF8 command lines.

    Some unrelated local processes carry GBK bytes in their command line; the
    product helper decodes strictly and aborts. Evidence-only workaround.
    """
    command = ("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,"
               "ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress")
    result = subprocess.run(["pwsh.exe", "-NoLogo", "-NoProfile", "-Command", command],
                            capture_output=True, check=True)
    text = result.stdout.decode("utf-8", errors="replace")
    return {int(row["ProcessId"]): row for row in json.loads(text)}


acceptance_runtime.processes = processes

NGINX = "D:/Work/Backend/nginx-1.28.0/nginx-1.28.0/nginx.exe"
REDIS = "D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe"


def main():
    evidence = OUT / "skipped-replay"
    if evidence.exists():
        raise SystemExit("Existing replay evidence retained; use a new attempt directory")
    evidence.mkdir()
    inventory = json.loads((PRIOR_RUN / "skipped-tests-windows-20261018/inventory.json").read_text(encoding="utf-8"))
    raw = os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"]
    target = make_url(raw)
    if target.drivername != "mysql+pymysql" or target.host not in {"127.0.0.1", "localhost"} or target.database:
        raise SystemExit("Local unscoped MySQL admin URL required")
    for path in (NGINX, REDIS):
        if not Path(path).is_file():
            raise SystemExit("Missing local infrastructure: " + path)
    save(evidence / "inventory.json", inventory)
    save(evidence / "source-sha256.json", {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in (ROOT / "algorithm/web").rglob("*.py")})
    save(evidence / "business-before.json", observe(PRIOR_RUN))
    env = {k: v for k, v in os.environ.items() if not k.upper().endswith("_PROXY")}
    for key in ("DASHSCOPE_API_KEY", "COS_SECRET_ID", "COS_SECRET_KEY", "JAVA_HOME", "WAIT_RECOVERY_BROWSER"):
        env.pop(key, None)
    env.update(PYTHONPATH=str(ROOT / "algorithm"), PYTHONUNBUFFERED="1", PYTHONUTF8="1",
               NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost",
               HANDOFF_TEST_MYSQL_ADMIN_URL=raw, WAIT_RECOVERY_REDIS_SERVER=REDIS, CUTOVER_NGINX=NGINX,
               HUMAN_WAIT_EVIDENCE_DIR=str(evidence / "recovery-cases"))
    admin = create_engine(target, isolation_level="AUTOCOMMIT")

    def schemas():
        with admin.connect() as db:
            return {r[0] for r in db.exec_driver_sql("SHOW DATABASES") if r[0].startswith(
                ("eye_pyhandoff_", "eye_human_wait_issue17_", "eye_evidence_test_", "eye_worker_issue16_"))}

    before_schemas = schemas()
    owned = Owned(evidence, [raw, target.password])
    results = {}
    try:
        for prefix, variable in (("eye_evidence_test_", "EVIDENCE_MYSQL_TEST_URL"),
                                 ("eye_worker_issue16_", "WORKER_TEST_MYSQL_URL")):
            schema = prefix + uuid4().hex
            with admin.connect() as db:
                db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            url = target.set(database=schema).render_as_string(hide_password=False)
            env[variable] = url
            migrated = subprocess.run([sys.executable, "-m", "web.migrations", "upgrade"],
                                      cwd=ROOT / "algorithm", env={**env, "MIGRATION_MYSQL_URL": url},
                                      capture_output=True)
            (evidence / f"migration-{prefix.strip('_')}.log").write_bytes(migrated.stdout + migrated.stderr)
            if migrated.returncode:
                raise RuntimeError("Fresh isolated migration failed for " + variable)
            if variable == "EVIDENCE_MYSQL_TEST_URL":
                from web.tests.session_fixtures import seed_users
                engine = create_engine(url)
                seed_users(engine)
                engine.dispose()
        for phase, selected in (
                ("nginx", [r["nodeid"] for r in inventory if "CUTOVER_NGINX" in r["reason"]]),
                ("mysql", [r["nodeid"] for r in inventory if "CUTOVER_NGINX" not in r["reason"]])):
            xml = evidence / f"{phase}.xml"
            # Short basetemp inside the worktree; the frozen ZIP path-length limit applies here too.
            basetemp = ROOT / ".scratch" / ("sw18-" + uuid4().hex[:8])
            child = owned.start(phase, [sys.executable, "-m", "pytest", *selected, "-q", "--tb=short",
                                        "--basetemp=" + str(basetemp), "--junitxml=" + str(xml)], env, cwd=ROOT)
            tracked, stopped = {}, threading.Event()

            def monitor():
                while not stopped.is_set():
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
                    stopped.wait(.5)

            watcher = threading.Thread(target=monitor, daemon=True)
            watcher.start()
            try:
                code = child.wait(timeout=2400)
            finally:
                stopped.set()
                watcher.join(timeout=15)
                if watcher.is_alive():
                    raise RuntimeError("Process monitor did not stop")
                owned.stop(child)
                current, orphans = processes(), []
                for pid, original in tracked.items():
                    live = current.get(pid)
                    if live is None:
                        continue
                    if any(live[k] != original[k] for k in
                           ("CreationDate", "ExecutablePath", "CommandLine", "Name")):
                        raise RuntimeError("Recorded process identity changed")
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                                   check=True, capture_output=True, timeout=20)
                    orphans.append(pid)
                    current = processes()
                remaining = processes()
                assert not any(pid in remaining and remaining[pid]["CreationDate"] == row["CreationDate"]
                               for pid, row in tracked.items())
                save(evidence / f"{phase}-process-audit.json",
                     {"status": "PASS", "registered": list(tracked.values()),
                      "orphanPidsStopped": orphans, "survivingRecordedProcesses": []})
            results[phase] = {"exitCode": code, "selectedCases": len(selected), "xml": xml.name}
            save(evidence / "batch-results.json", results)
            print(json.dumps({"phase": phase, **results[phase]}), flush=True)
    finally:
        owned.close()
        save(evidence / "schemas.json", {"createdAndRetained": sorted(schemas() - before_schemas),
                                         "scope": "Fresh isolated schemas only; no production upgrade or cutover"})
        admin.dispose()
        save(evidence / "business-after.json", observe(PRIOR_RUN))
    print("Replay batches completed; inspect XML for per-case results", flush=True)


if __name__ == "__main__":
    main()
