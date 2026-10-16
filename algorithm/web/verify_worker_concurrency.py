"""Opt-in isolated MySQL acceptance with Python migrations.

Set WORKER_TEST_MYSQL_ADMIN_URL using local credentials, then run with the web
baseline Python. Creates a new test schema; never drops or migrates business DBs.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--suite", choices=["worker-concurrency", "human-wait-restart"], default="worker-concurrency")
    args = parser.parse_args()
    target = make_url(os.environ["WORKER_TEST_MYSQL_ADMIN_URL"])
    if target.get_backend_name() != "mysql" or target.host not in {"127.0.0.1", "localhost"}:
        raise ValueError("Acceptance requires a local MySQL server")
    root = Path(__file__).resolve().parents[2]
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    human_wait = args.suite == "human-wait-restart"
    schema = ("eye_human_wait_issue17_" if human_wait else "eye_worker_issue16_") + uuid4().hex
    admin = create_engine(target.set(database=None), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as db:
            version: str = db.exec_driver_sql("SELECT VERSION()").scalar_one()
            db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    finally:
        admin.dispose()
    env = os.environ.copy()
    env.pop("JAVA_HOME", None)
    env["MIGRATION_MYSQL_URL"] = target.set(database=schema).render_as_string(hide_password=False)
    results = {"at": datetime.now(timezone.utc).isoformat(), "schema": schema, "mysqlVersion": version,
               "suite": args.suite,
               "scope": "Real MySQL and child processes; controlled identity/model/retrieval/explanation; no clinical acceptance",
               "commands": {}}
    if human_wait:
        sources = {str(file.relative_to(root)).replace("\\", "/"): hashlib.sha256(file.read_bytes()).hexdigest()
                   for file in (root / "algorithm/web").rglob("*.py")}
        (output / "source-sha256.json").write_text(json.dumps(sources, indent=2), encoding="utf-8")
    commands = [("python-upgrade", [sys.executable, "-m", "web.migrations", "upgrade"], root / "algorithm"),
                ("python-inspect", [sys.executable, "-m", "web.migrations", "inspect"], root / "algorithm")]
    env["WORKER_TEST_MYSQL_URL"] = target.set(database=schema).render_as_string(hide_password=False)
    if human_wait:
        env["HUMAN_WAIT_TEST_MYSQL_URL"] = env.pop("WORKER_TEST_MYSQL_URL")
        env["HUMAN_WAIT_EVIDENCE_DIR"] = str(output / "cases")
    test_file = "test_human_wait_restart.py" if human_wait else "test_worker_concurrency.py"
    commands.append(("mysql-tests", [sys.executable, "-m", "pytest", f"web/tests/{test_file}", "-q"], root / "algorithm"))
    for name, command, cwd in commands:
        run = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
        (output / f"{name}.log").write_text(run.stdout + run.stderr, encoding="utf-8")
        results["commands"][name] = {"exitCode": run.returncode}
        (output / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"{name}: {'passed' if run.returncode == 0 else 'failed'}", flush=True)
        if run.returncode:
            raise SystemExit(run.returncode)
    print(f"Evidence: {output}", flush=True)


if __name__ == "__main__":
    main()
