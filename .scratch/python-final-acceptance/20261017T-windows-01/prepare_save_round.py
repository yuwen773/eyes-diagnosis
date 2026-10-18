"""Prepare real HTTP scenarios; never submit review or save decisions."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from uuid import uuid4

import httpx

RUN = Path(__file__).resolve().parent
manifest_path = RUN / "runtime/manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
attempt = RUN / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-save-preparation-" + uuid4().hex[:6])
attempt.mkdir()


def save(name, data):
    (attempt / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def data(response):
    response.raise_for_status()
    payload = response.json()
    assert payload["code"] == 0, (response.url.path, payload.get("code"))
    return payload["data"]


def login(client, role):
    account = manifest["accounts"][role]
    result = data(client.post("/api/user/login", json={"userAccount": account["account"],
                                                      "userPassword": manifest["fixturePassword"]}))
    assert result["id"] == account["id"]


with httpx.Client(base_url="http://127.0.0.1:8080", timeout=180, trust_env=False) as client:
    assert client.get("/ready").status_code == 200
    login(client, "admin")
    documents = data(client.post("/api/knowledge/admin/documents", json={"pageSize": 100}))["records"]
    selected = [row for row in documents if str(row["id"]) in {"2", "4", "8"}]
    save("reference-governance-readback.json", selected)
    if "--record-confirmed-review" in sys.argv:
        save("participant-review-confirmation.json", {
            "source": "User message in this conversation on 2026-10-17",
            "statement": "三份参考资料都已审核通过，继续准备后续保存验收，告诉我患者和医生接下来分别怎么操作。",
            "scope": "reference-review-proposal.md IDs 2,4,8; isolated acceptance schema only",
            "execution": "Administrator API records participant-confirmed review; not a human admin UI acceptance claim"})
        for filename, code in (("01-normal.md", "normal"), ("03-cataract.md", "cataract"), ("07-myopia.md", "myopia")):
            row = next(row for row in selected if row["fileName"] == filename)
            if row["reviewStatus"] == "APPROVED" and row["visibility"] == "CURATED_PUBLIC":
                continue
            assert row["reviewStatus"] == "PENDING" and row["visibility"] == "PRIVATE_USER"
            updated = data(client.patch("/api/knowledge/admin/documents/" + str(row["id"]), json={
                "visibility": "CURATED_PUBLIC", "reviewStatus": "APPROVED", "diseaseCodes": [code],
                "topicCodes": ["DISEASE_OVERVIEW"], "expectedVersion": row["governanceVersion"], "confirmed": True}))
            save("reference-" + str(row["id"]) + "-confirmed.json", updated)
        documents = data(client.post("/api/knowledge/admin/documents", json={"pageSize": 100}))["records"]
        selected = [row for row in documents if str(row["id"]) in {"2", "4", "8"}]
        save("reference-governance-after.json", selected)
    for filename, code in (("01-normal.md", "normal"), ("03-cataract.md", "cataract"), ("07-myopia.md", "myopia")):
        row = next(row for row in selected if row["fileName"] == filename)
        assert row["visibility"] == "CURATED_PUBLIC" and row["reviewStatus"] == "APPROVED", filename
        assert code in row["diseaseCodes"] and "DISEASE_OVERVIEW" in row["topicCodes"], filename
        assert row["status"] == 1
    client.cookies.clear()
    login(client, "patient")
    views = {name: data(client.get("/api/diagnosis/workflows/" + workflow_id))
             for name, workflow_id in manifest["workflows"].items()}
    save("original-workflows.json", views)
    if "--prepare" in sys.argv:
        # Reuse one untouched original wait; create only one new independent task.
        scenarios = manifest.setdefault("saveScenarios", {})
        if "approve" not in scenarios:
            assert views["13_left.jpg"]["status"] == "WAITING_HUMAN_REVIEW"
            scenarios["approve"] = {"workflowId": manifest["workflows"]["13_left.jpg"],
                                     "sessionId": manifest["chatSessions"]["13_left.jpg"],
                                     "fileName": "13_left.jpg", "title": "保存验收 B（批准）13_left.jpg"}
        if "refuse" not in scenarios:
            source = Path("D:/Work/code/eye-diagnosis/algorithm/datasets/DataSet/Training_Dataset/Training_Dataset/Training_Dataset/0_left.jpg")
            content = source.read_bytes()
            view = data(client.post("/api/diagnosis/workflows", data={
                "idempotencyKey": "acceptance-save-refuse-0left", "question": ""},
                files={"file": (source.name, content)}))
            scenarios["refuse"] = {"workflowId": view["workflowId"], "sessionId": uuid4().hex,
                                    "fileName": source.name, "title": "保存验收 A（拒绝）0_left.jpg",
                                    "sourceSha256": hashlib.sha256(content).hexdigest()}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for scenario in scenarios.values():
            response = client.post("/api/agent/chat/stream", json={"message": "查看原上传任务",
                "threadId": scenario["sessionId"], "diagnosis": {"workflowId": scenario["workflowId"]}})
            assert response.status_code == 200 and scenario["workflowId"] in response.text and "event: done" in response.text
            (attempt / (scenario["fileName"] + "-chat.sse")).write_text(response.text, encoding="utf-8")
            # Exact product title endpoint; no generated-title model call.
            data(client.put("/api/agent/sessions/" + scenario["sessionId"] + "/title", json={"title": scenario["title"]}))
        save("save-scenarios.json", scenarios)
    scenarios = manifest.get("saveScenarios", {})
    scenario_views = {name: data(client.get("/api/diagnosis/workflows/" + scenario["workflowId"]))
                      for name, scenario in scenarios.items()}
    save("scenario-workflows.json", scenario_views)
    save("formal-records.json", data(client.post("/api/diagnosis/list/page/my", json={})))
    client.cookies.clear()
    login(client, "doctor")
    tasks = data(client.get("/api/reviews/tasks"))
    selected_tasks = [task for task in tasks if task["workflowId"] in {s["workflowId"] for s in scenarios.values()}]
    save("scenario-review-tasks.json", selected_tasks)
print(json.dumps({"evidence": str(attempt), "references": "PASS", "prepared": "--prepare" in sys.argv,
                  "scenarioStates": {name: {key: value.get(key) for key in ("workflowId", "status", "workflowVersion", "stopReasonCode")}
                                     for name, value in scenario_views.items()},
                  "reviewTasks": selected_tasks}, ensure_ascii=False))
