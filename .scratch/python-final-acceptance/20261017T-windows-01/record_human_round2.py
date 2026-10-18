"""Bind participant-provided screenshots to read-only authoritative evidence."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

RUN = Path(__file__).resolve().parent
observation = RUN / "20261017T112918-observation.json"
data = json.loads(observation.read_text(encoding="utf-8"))["tables"]
workflow_id = "dad94b0f755f421f84cbb708f56bb898"
workflow = next(row for row in data["t_diagnosis_workflow"] if row["workflowId"] == workflow_id)
review = next(row for row in data["t_human_review_task"] if row["workflowId"] == workflow_id
              and row["reviewType"] == "IMAGE_QUALITY_GATE")
bundle = next(row for row in data["t_inference_envelope"] if row["workflowId"] == workflow_id)
assert workflow["status"] == "COMPLETED_LIMITED" and workflow["stopReasonCode"] == "EVIDENCE_INSUFFICIENT"
assert review["status"] == "SUBMITTED" and review["decisionCode"] == "APPROVE_CONTINUE"
assert review["submittedDoctorId"] != workflow["ownerUserId"]
assert review["inferenceEnvelopeId"] == bundle["inferenceEnvelopeId"]
assert not any(row["workflowId"] == workflow_id for row in data["t_saved_workflow_diagnosis"])
evidence = RUN / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-human-round2")
evidence.mkdir()
sources = {
    "doctor.png": Path("C:/Users/yuwen/AppData/Local/Temp/codex-clipboard-18486a09-ece3-4bdd-a25e-bb124c221373.png"),
    "patient-after-refresh.png": Path("C:/Users/yuwen/AppData/Local/Temp/codex-clipboard-9207aa92-0293-4b8b-a2bf-f99eee3066a9.png"),
}
screenshots = []
for name, source in sources.items():
    shutil.copy2(source, evidence / name)
    screenshots.append({"file": name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                        "source": "participant attachment; original bytes preserved"})
result = {"workflowId": workflow_id, "sample": "1_left.jpg", "observation": observation.name,
          "qualityReview": {"status": "PASS", "task": review},
          "patientTaskReadback": {"status": "PASS", "workflowStatus": workflow["status"],
                                  "reason": workflow["stopReasonCode"]},
          "manualRefresh": {"status": "PASS", "basis": "Participant explicitly confirmed F5 and reopening the same conversation before screenshot"},
          "noImplicitSave": {"status": "PASS", "formalRecordsForThisWorkflow": 0},
          "inferenceEnvelopeId": bundle["inferenceEnvelopeId"], "screenshots": screenshots,
          "limitations": ["Quality approval is not final clinical review or save authorization",
                          "Full acceptance remains blocked; explanation and approve/refuse-save scenarios incomplete"]}
(evidence / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"evidence": str(evidence), "workflowId": workflow_id,
                  "verified": ["quality submission", "same task after actual refresh", "no implicit save"]}, ensure_ascii=False))
