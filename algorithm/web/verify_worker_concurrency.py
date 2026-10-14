"""Opt-in isolated MySQL/Flyway acceptance for issue 16.

Set WORKER_TEST_MYSQL_ADMIN_URL using local credentials, then run with the web
baseline Python. Creates a new test schema; never drops or migrates business DBs.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    target = make_url(os.environ["WORKER_TEST_MYSQL_ADMIN_URL"])
    if target.get_backend_name() != "mysql" or target.host not in {"127.0.0.1", "localhost"}:
        raise ValueError("Acceptance requires a local MySQL server")
    root = Path(__file__).resolve().parents[2]
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    schema = "eye_worker_issue16_" + uuid4().hex
    admin = create_engine(target.set(database=None), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as db:
            version = db.exec_driver_sql("SELECT VERSION()").scalar_one()
            db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            db.exec_driver_sql(f"USE `{schema}`")
            # V19 evolves this pre-Flyway table. Use only its original CREATE,
            # never schema.sql's USE diagnosis, ALTER or DROP statements.
            ddl = (root / "src/main/resources/db/schema.sql").read_text(encoding="utf-8")
            table = re.search(r"CREATE TABLE IF NOT EXISTS t_knowledge_document\s*\(.*?;", ddl, re.S)
            assert table is not None
            db.exec_driver_sql(table.group())
    finally:
        admin.dispose()
    env = os.environ.copy()
    java = Path(r"C:\Users\yuwen\.jdks\corretto-21.0.7")
    env["JAVA_HOME"] = str(java)
    env["PATH"] = str(java / "bin") + os.pathsep + env.get("PATH", "")
    env.update(FLYWAY_URL=f"jdbc:mysql://{target.host}:{target.port or 3306}/{schema}?serverTimezone=Asia/Shanghai",
               FLYWAY_USER=target.username or "", FLYWAY_PASSWORD=target.password or "")
    results = {"at": datetime.now(timezone.utc).isoformat(), "schema": schema, "mysqlVersion": version,
               "scope": "Real MySQL and Worker processes; synthetic Java identity/model/retrieval; no clinical acceptance",
               "commands": {}}
    commands = [("flyway-migrate", ["mvn.cmd", "-B", "-f", "deploy/workflow-migrations/pom.xml", "flyway:migrate"], root),
                ("flyway-validate", ["mvn.cmd", "-B", "-f", "deploy/workflow-migrations/pom.xml", "flyway:validate"], root)]
    env["WORKER_TEST_MYSQL_URL"] = target.set(database=schema).render_as_string(hide_password=False)
    commands.append(("mysql-tests", [sys.executable, "-m", "pytest", "web/tests/test_worker_concurrency.py", "-q"], root / "algorithm"))
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
