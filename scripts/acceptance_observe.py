"""Read-only MySQL evidence while real participants operate the original UI."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


TABLES = ("t_diagnosis_workflow", "t_inference_envelope", "t_human_review_task",
          "t_diagnosis_save_confirmation", "t_saved_workflow_diagnosis",
          "t_diagnosis_workflow_event", "t_explanation_snapshot", "t_diagnosis")


def observe(run):
    manifest = json.loads((run / "runtime/manifest.json").read_text(encoding="utf-8"))
    import re
    if not re.fullmatch(r"eye_final_[0-9a-f]{32}", manifest["schema"]):
        raise ValueError("Unregistered schema")
    target = make_url(os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"])
    if target.drivername != "mysql+pymysql" or target.host not in {"127.0.0.1", "localhost"} or target.database:
        raise ValueError("Local unscoped admin URL required")
    engine = create_engine(target.set(database=manifest["schema"]))
    try:
        with engine.connect() as db:
            result = {table: [dict(row) for row in db.execute(text("SELECT * FROM " + table)).mappings()]
                      for table in TABLES}
    finally:
        engine.dispose()
    result = json.loads(json.dumps(result, default=str))
    fingerprints = {table: hashlib.sha256(json.dumps(sorted(rows, key=lambda row: json.dumps(row, sort_keys=True)),
                                                   sort_keys=True).encode()).hexdigest()
                    for table, rows in result.items()}
    return {"timestampUtc": datetime.now(timezone.utc).isoformat(), "schema": manifest["schema"],
            "tables": result, "sha256": fingerprints}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    import re
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.run_id):
        raise SystemExit("Safe run ID required")
    run = Path(__file__).resolve().parents[1] / ".scratch/python-final-acceptance" / args.run_id
    result = observe(run)
    output = run / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-observation.json")
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"evidence": str(output), "workflowStates": [
        {key: row[key] for key in ("workflowId", "status", "workflowVersion", "stopReasonCode") if key in row}
        for row in result["tables"]["t_diagnosis_workflow"]],
        "reviewDecisions": len([row for row in result["tables"]["t_human_review_task"] if row.get("decisionCode")]),
        "formalRecords": len(result["tables"]["t_saved_workflow_diagnosis"])}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
