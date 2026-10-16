"""CI and local checks use the same installed Python and frozen assets."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(command, cwd=ROOT, env=None):
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("suite", choices=["web", "frontend", "infrastructure"])
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".scratch/python-project-migration/evidence/issue06/ci")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.suite == "web":
        run(["uv", "pip", "check", "--python", sys.executable])
        run([sys.executable, "-m", "web.migrations", "baseline-check"])
        run([sys.executable, "-m", "mypy", "--follow-imports=silent", "--ignore-missing-imports", "--check-untyped-defs",
             "algorithm/web/delivery.py", "algorithm/web/migrations/baseline.py",
             "algorithm/web/verify_real_services.py", "algorithm/web/verify_worker_concurrency.py",
             "scripts/verify.py", "scripts/smoke_compose.py"])
        run([sys.executable, "-m", "pytest", "algorithm/web/tests", "-q", "--junitxml=" + str(args.output_dir / "web.xml")])
    elif args.suite == "infrastructure":
        run([sys.executable, "-m", "web.verify_real_services", "--output-dir", str(args.output_dir / "services")])
        env = {**os.environ, "HANDOFF_TEST_MYSQL_ADMIN_URL": os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"]}
        run([sys.executable, "-m", "pytest", "algorithm/web/tests/test_database_handoff.py", "-q",
             "--junitxml=" + str(args.output_dir / "handoff.xml")], env=env)
    else:
        from web.app import create_app
        with tempfile.TemporaryDirectory(prefix="eye-openapi-") as directory:
            schema = Path(directory) / "openapi.json"
            schema.write_text(json.dumps(create_app().openapi()), encoding="utf-8")
            npm = shutil.which("npm")
            if not npm:
                raise RuntimeError("Node/npm is required")
            run([npm, "run", "openapi"], ROOT / "frontend", {**os.environ, "OPENAPI_SCHEMA_URL": str(schema)})
            run([npm, "run", "build"], ROOT / "frontend")
            run([npm, "run", "test", "--", "--run"], ROOT / "frontend")


if __name__ == "__main__":
    main()
