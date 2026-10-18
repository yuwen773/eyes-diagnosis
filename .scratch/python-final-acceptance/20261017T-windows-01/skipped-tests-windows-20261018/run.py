"""Replay only the 43 skipped node IDs with installed Windows infrastructure."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from acceptance_runtime import Owned, processes, save
from acceptance_observe import observe

OUT = Path(__file__).resolve().parent
RUN = OUT.parent


def main():
    if (OUT / "processes.json").exists():
        raise RuntimeError("Existing replay evidence retained; use a new attempt directory")
    raw = os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"]
    target = make_url(raw)
    if target.drivername != "mysql+pymysql" or target.host not in {"127.0.0.1", "localhost"} or target.database:
        raise ValueError("Local unscoped MySQL admin URL required")
    inventory = json.loads((OUT / "inventory.json").read_text(encoding="utf-8"))
    save(OUT / "business-before.json", observe(RUN))
    save(OUT / "source-sha256.json", {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in (ROOT / "algorithm/web").rglob("*.py")})
    env = {k: v for k, v in os.environ.items() if not k.upper().endswith("_PROXY")}
    for key in ("DASHSCOPE_API_KEY", "COS_SECRET_ID", "COS_SECRET_KEY", "JAVA_HOME", "WAIT_RECOVERY_BROWSER"):
        env.pop(key, None)
    env.update(PYTHONPATH=str(ROOT / "algorithm"), PYTHONUNBUFFERED="1", PYTHONUTF8="1",
        NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost",
        HANDOFF_TEST_MYSQL_ADMIN_URL=raw,
        WAIT_RECOVERY_REDIS_SERVER="D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe",
        CUTOVER_NGINX="D:/Work/Backend/nginx-1.28.0/nginx-1.28.0/nginx.exe",
        HUMAN_WAIT_EVIDENCE_DIR=str(OUT / "recovery-cases"))
    admin = create_engine(target, isolation_level="AUTOCOMMIT")

    def schemas():
        with admin.connect() as db:
            return {r[0] for r in db.exec_driver_sql("SHOW DATABASES") if r[0].startswith(
                ("eye_pyhandoff_", "eye_human_wait_issue17_", "eye_evidence_test_", "eye_worker_issue16_"))}

    before_schemas = schemas()
    owned = Owned(OUT, [raw, target.password])
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
                cwd=ROOT / "algorithm", env={**env, "MIGRATION_MYSQL_URL": url}, capture_output=True)
            if migrated.returncode:
                raise RuntimeError("Fresh isolated migration failed")
            if variable == "EVIDENCE_MYSQL_TEST_URL":
                from web.tests.session_fixtures import seed_users
                engine = create_engine(url)
                seed_users(engine)
                engine.dispose()
        for phase, selected in (
            ("nginx", [r["nodeid"] for r in inventory if "CUTOVER_NGINX" in r["reason"]]),
            ("mysql", [r["nodeid"] for r in inventory if "CUTOVER_NGINX" not in r["reason"]])):
            xml = OUT / f"{phase}.xml"
            child = owned.start(phase, [sys.executable, "-m", "pytest", *selected, "-q", "--tb=short",
                "--basetemp=" + str(OUT / (phase + "-temp")), "--junitxml=" + str(xml)], env, cwd=ROOT)
            # Capture actual descendants while parents still exist, including venv launchers.
            tracked = {}
            stopped = threading.Event()

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
                current = processes()
                orphans = []
                for pid, original in tracked.items():
                    live = current.get(pid)
                    if live is None:
                        continue
                    if any(live[k] != original[k] for k in ("CreationDate", "ExecutablePath", "CommandLine", "Name")):
                        raise RuntimeError("Recorded process identity changed")
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                        check=True, capture_output=True, timeout=20)
                    orphans.append(pid)
                    current = processes()
                remaining = processes()
                assert not any(pid in remaining and remaining[pid]["CreationDate"] == row["CreationDate"]
                               for pid, row in tracked.items())
                save(OUT / f"{phase}-process-audit.json", {"status": "PASS", "registered": list(tracked.values()),
                     "orphanPidsStopped": orphans, "survivingRecordedProcesses": []})
            results[phase] = {"exitCode": code, "selectedCases": len(selected), "xml": xml.name}
            save(OUT / "batch-results.json", results)
            print(json.dumps({"phase": phase, **results[phase]}), flush=True)
    finally:
        owned.close()
        save(OUT / "schemas.json", {"createdAndRetained": sorted(schemas() - before_schemas),
             "scope": "Fresh isolated schemas only; no production upgrade or cutover"})
        admin.dispose()
        save(OUT / "business-after.json", observe(RUN))
    print("Replay batches completed; inspect XML for per-case results", flush=True)


if __name__ == "__main__":
    main()
