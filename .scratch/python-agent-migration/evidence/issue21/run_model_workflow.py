"""Real model HTTP/Worker smoke; SQLite and Java identity are explicit doubles.

Reuses the existing public HTTP fixture; never impersonates a real participant.
No evidence, LLM, COS, clinical or real-MySQL acceptance is claimed.
"""

import argparse
from datetime import datetime, timezone
import inspect
import json
from pathlib import Path
import sys
from typing import Any
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_model_smoke import EXPECTED_SHA256, SAMPLES
from web.config import WebConfig
from web.inference import InferenceEngine
from web.tests.test_workflow import workflow_api
from web.workflow.inference import WorkflowInference
from web.workflow.worker import Worker


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('{"status":"NOT_VERIFIED","finalAcceptance":"BLOCKED","reason":"run not completed"}\n', encoding="utf-8", newline="\n")
    root = Path(__file__).resolve().parents[4]
    runtime = root / ".scratch/baseline-runtime" / ("issue21-" + uuid4().hex)
    runtime.mkdir(parents=True)
    config = WebConfig(model_weights_path=str(args.weights.resolve()), model_weights_sha256=EXPECTED_SHA256)
    engine = InferenceEngine(config)
    engine.load()
    pipeline = WorkflowInference(config, engine=engine)
    fixture = inspect.unwrap(workflow_api)(runtime)
    client, sessions = next(fixture)
    result: dict[str, Any] = {"timestampUtc": datetime.now(timezone.utc).isoformat(), "status": "PASS",
              "finalAcceptance": "BLOCKED", "weightSha256": EXPECTED_SHA256,
              "scope": "real weights/images, original HTTP/Worker/graph; SQLite and Java identity doubles",
              "realUserActions": False, "realDoctorActions": False, "samples": []}
    try:
        for filename in SAMPLES:
            content = (args.images / filename).read_bytes()
            data = {"idempotencyKey": "issue21-" + Path(filename).stem, "question": "工单21真实图片工程验证"}
            files = {"file": (filename, content, "image/jpeg")}
            created = client.post("/api/diagnosis/workflows", data=data, files=files)
            assert created.status_code == 202, created.json()
            workflow_id = created.json()["data"]["workflowId"]
            repeated = client.post("/api/diagnosis/workflows", data=data, files=files)
            assert repeated.json()["data"]["workflowId"] == workflow_id
            for _ in range(24):
                if not Worker(sessions, inference=pipeline).run_once():
                    break
            else:
                raise RuntimeError("Worker did not reach a durable stop")
            url = f"/api/diagnosis/workflows/{workflow_id}"
            view = client.get(url).json()["data"]
            assert view["status"] == "WAITING_HUMAN_REVIEW"
            assert view["result"] is None
            assert not view["resultAvailability"]["patientVisible"]
            assert not Worker(sessions, inference=pipeline).run_once()
            assert client.get(url).json()["data"] == view
            client.cookies.set("SESSION", "bob")
            assert client.get(url).status_code == 403
            client.cookies.set("SESSION", "alice")
            result["samples"].append({"file": filename, "workflowId": workflow_id,
                                      "idempotentUpload": True, "crossUserStatus": 403,
                                      "newWorkerDoesNotConsumeWait": True, "view": view})
        assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
        result["formalDiagnosisCount"] = 0
    finally:
        fixture.close()
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "finalAcceptance": result["finalAcceptance"],
                      "workflows": len(result["samples"]), "formalDiagnosisCount": 0}, indent=2))


if __name__ == "__main__":
    main()
