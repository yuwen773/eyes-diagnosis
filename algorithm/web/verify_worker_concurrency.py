"""Opt-in isolated MySQL/Flyway acceptance for issues 16 and 17.

Set WORKER_TEST_MYSQL_ADMIN_URL using local credentials, then run with the web
baseline Python. Creates a new test schema; never drops or migrates business DBs.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
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
            db.exec_driver_sql(f"USE `{schema}`")
            # V19 evolves this pre-Flyway table. Use only its original CREATE,
            # never schema.sql's USE diagnosis, ALTER or DROP statements.
            ddl = (root / "src/main/resources/db/schema.sql").read_text(encoding="utf-8")
            for name in ["t_knowledge_document", *(["t_user"] if human_wait else [])]:
                table = re.search(rf"CREATE TABLE IF NOT EXISTS {name}\s*\(.*?;", ddl, re.S)
                assert table is not None
                db.exec_driver_sql(table.group())
    finally:
        admin.dispose()
    env = os.environ.copy()
    if os.name == "nt":
        java = Path(r"C:\Users\yuwen\.jdks\corretto-21.0.7")
        env["JAVA_HOME"] = str(java)
        env["PATH"] = str(java / "bin") + os.pathsep + env.get("PATH", "")
    maven = shutil.which("mvn", path=env.get("PATH"))
    if not maven:
        raise RuntimeError("Maven is required")
    env.update(FLYWAY_URL=f"jdbc:mysql://{target.host}:{target.port or 3306}/{schema}?serverTimezone=Asia/Shanghai",
               FLYWAY_USER=target.username or "", FLYWAY_PASSWORD=target.password or "")
    results = {"at": datetime.now(timezone.utc).isoformat(), "schema": schema, "mysqlVersion": version,
               "suite": args.suite,
               "scope": "Real MySQL and child processes; synthetic Java identity/model/retrieval/explanation; no clinical acceptance",
               "commands": {}}
    if human_wait:
        sources = {str(file.relative_to(root)).replace("\\", "/"): hashlib.sha256(file.read_bytes()).hexdigest()
                   for file in (root / "algorithm/web").rglob("*.py")}
        (output / "source-sha256.json").write_text(json.dumps(sources, indent=2), encoding="utf-8")
    commands = [("flyway-migrate", [maven, "-B", "-f", "deploy/workflow-migrations/pom.xml", "flyway:migrate"], root),
                ("flyway-validate", [maven, "-B", "-f", "deploy/workflow-migrations/pom.xml", "flyway:validate"], root)]
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
