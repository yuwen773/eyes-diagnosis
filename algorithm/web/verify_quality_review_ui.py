"""Chromium + real local HTTP/Worker, synthetic Java/model and SQLite only.

Run against web.tests.quality_review_ui_server, never a real deployment.
"""

import argparse
import json
import time
from pathlib import Path
from uuid import uuid4

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes

API = "http://127.0.0.1:18804/api"
FRONTEND = "http://127.0.0.1:15174"


def wait_for_status(client, workflow_id, status):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        view = client.get(f"{API}/diagnosis/workflows/{workflow_id}").json()["data"]
        if view["status"] == status:
            return view
        time.sleep(.1)
    raise AssertionError(f"Workflow did not reach {status}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    checks = []
    page_errors = []
    with httpx.Client(cookies={"SESSION": "alice"}) as owner, httpx.Client(
            cookies={"SESSION": "doctor"}) as doctor, sync_playwright() as playwright:
        workflow_ids = []
        for _ in range(3):
            response = owner.post(f"{API}/diagnosis/workflows", data={"idempotencyKey": uuid4().hex,
                "question": "质量复核浏览器工程测试"}, files={"file": ("fundus.png", picture_bytes(), "image/png")})
            assert response.status_code == 202
            workflow_id = response.json()["data"]["workflowId"]
            wait_for_status(owner, workflow_id, "WAITING_HUMAN_REVIEW")
            workflow_ids.append(workflow_id)
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1360, "height": 1000})
        context.add_cookies([{"name": "SESSION", "value": "doctor", "url": "http://127.0.0.1"}])
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(FRONTEND + "/doctor/reviews")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(args.output_dir / "issue04-initial-page.png"), full_page=True)
        expect(page.get_by_role("heading", name="医生质量复核")).to_be_visible()
        tasks = doctor.get(f"{API}/reviews/tasks").json()["data"]
        indexed = {task["workflowId"]: task for task in tasks}
        for workflow_id, decision, label, terminal, filename in [
            (workflow_ids[0], "APPROVE_CONTINUE", "允许复用原推理包继续", "FAILED", "approved"),
            (workflow_ids[1], "REJECT_RESUBMIT", "要求用户重新上传图片", "REJECTED", "rejected"),
        ]:
            task = indexed[workflow_id]
            page.locator(f'button[data-task-id="{task["reviewTaskId"]}"]').click()
            expect(page.get_by_role("heading", name="图像质量复核")).to_be_visible()
            expect(page.get_by_alt_text("待复核的眼底图片")).to_be_visible()
            page.reload()
            page.wait_for_load_state("networkidle")
            expect(page.get_by_role("heading", name="图像质量复核")).to_be_visible()
            page.get_by_role("button", name="领取质量复核").click()
            expect(page.get_by_role("button", name="提交质量决定")).to_be_disabled()
            page.get_by_label(label, exact=False).check()
            page.screenshot(path=str(args.output_dir / f"issue04-{filename}-doctor.png"), full_page=True)
            page.get_by_role("button", name="提交质量决定").click()
            expect(page.get_by_text("质量决定已提交。", exact=False)).to_be_visible()
            view = wait_for_status(owner, workflow_id, terminal)
            assert view["qualityReview"]["decisionCode"] == decision
            patient = browser.new_context(viewport={"width": 1200, "height": 1000})
            patient.add_cookies([{"name": "SESSION", "value": "alice", "url": "http://127.0.0.1"}])
            patient_page = patient.new_page()
            patient_page.on("pageerror", lambda error: page_errors.append(str(error)))
            patient_page.goto(FRONTEND + f"/diagnosis?workflow={workflow_id}")
            patient_page.wait_for_load_state("networkidle")
            expect(patient_page.get_by_text("医生质量复核：", exact=False)).to_be_visible()
            expect(patient_page.get_by_text("正式诊断记录尚未保存", exact=False)).to_be_visible()
            patient_page.reload()
            patient_page.wait_for_load_state("networkidle")
            patient_page.screenshot(path=str(args.output_dir / f"issue04-{filename}-patient.png"), full_page=True)
            patient_page.goto(FRONTEND + "/doctor/reviews")
            expect(patient_page).to_have_url(FRONTEND + "/noAuth")
            patient.close()
            checks.append({"decision": decision, "patientStatus": terminal,
                           "refreshRestored": True, "userDeniedReviewPage": True})
        # A second window claims the task after this page rendered version 0.
        task = indexed[workflow_ids[2]]
        page.locator(f'button[data-task-id="{task["reviewTaskId"]}"]').click()
        expect(page.get_by_role("button", name="领取质量复核")).to_be_visible()
        response = doctor.post(f'{API}/reviews/tasks/{task["reviewTaskId"]}/claim', json={
            "expectedTaskVersion": task["taskVersion"], "expectedWorkflowVersion": task["workflowVersion"]})
        assert response.status_code == 200
        page.get_by_role("button", name="领取质量复核").click()
        expect(page.get_by_role("alert")).to_contain_text("版本已变化")
        page.screenshot(path=str(args.output_dir / "issue04-version-conflict.png"), full_page=True)
        page.get_by_role("button", name="刷新复核任务").click()
        expect(page.get_by_role("button", name="提交质量决定")).to_be_visible()
        checks.append({"staleClaimRejected": True, "refreshRecoversClaimedTask": True})
        context.close()
        anonymous = browser.new_page()
        anonymous.goto(FRONTEND + "/doctor/reviews")
        expect(anonymous).to_have_url(FRONTEND + "/user/login?redirect=/doctor/reviews")
        checks.append({"anonymousRedirectedToLogin": True})
        browser.close()
    assert not page_errors, page_errors
    (args.output_dir / "issue04-ui-results.json").write_bytes((json.dumps({
        "dependencies": "SQLite + Java transport double + controlled inference; real HTTP/Vue/Worker/Chromium",
        "checks": checks, "pageErrors": page_errors}, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({"checks": checks, "pageErrors": page_errors}, ensure_ascii=False))


if __name__ == "__main__":
    main()
