"""Run from algorithm/: python -m web.migrations baseline-check|inspect|upgrade."""

import argparse
import json
import os
from pathlib import Path

from web.migrations.baseline import ASSETS, check_baseline


def main() -> int:
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("command", choices=["baseline-check", "inspect", "upgrade"])
    parser.add_argument("--assets", type=Path, default=ASSETS)
    args = parser.parse_args()
    try:
        report = check_baseline(args.assets)
    except (OSError, ValueError, KeyError, TypeError):
        report = {"status": "BASELINE_INVALID", "differences": []}
    if report["status"] == "BASELINE_OK" and args.command != "baseline-check":
        from web.migrations.runner import MigrationBlocked, connect, inspect_database, upgrade

        try:
            with connect(os.environ.get("MIGRATION_MYSQL_URL", "")) as db:
                report = (upgrade if args.command == "upgrade" else inspect_database)(db, args.assets)
        except MigrationBlocked as error:
            report = {"status": error.code, "differences": error.differences}
        except Exception:
            # Driver messages may contain credentials, SQL values or row data.
            report = {"status": "CONNECTION_FAILED", "differences": []}
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return 0 if report["status"] in {"BASELINE_OK", "READY", "APPLIED", "UNCHANGED"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
