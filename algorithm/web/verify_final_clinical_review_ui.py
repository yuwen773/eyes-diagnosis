"""Actual upload/doctor/patient pages and HTTP routes with controlled dependencies."""

import argparse
import json
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes

SESSION_COOKIE_NAME = "EYE_SESSION"

API = "http://127.0.0.1:15381"
FRONTEND = "http://127.0.0.1:15382"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir
    output.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    matrices = [
        ("valid", "CONFIRM_AI_ASSESSMENT", "确认 AI 评估", "COMPLETED", "PUBLISHED"),
        ("valid", "CORRECT_AI_ASSESSMENT", "纠正 AI 评估", "COMPLETED_LIMITED", "WITHHELD"),
        ("valid", "INCONCLUSIVE", "无法判断", "COMPLETED_LIMITED", "WITHHELD"),
        ("abstention", "CONFIRM_ABSTENTION", "确认安全拒绝", "COMPLETED_LIMITED", "NONE"),
        ("abstention", "PROVIDE_INDEPENDENT_REVIEW", "提供独立复核", "COMPLETED_LIMITED", "NONE"),
        ("abstention", "INCONCLUSIVE", "无法判断", "COMPLETED_LIMITED", "NONE"),
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        patient = browser.new_context(viewport={"width": 1360, "height": 1100})
        doctor = browser.new_context(viewport={"width": 1360, "height": 1100})
        patient.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice", "url": API}])
        doctor.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "doctor", "url": API}])
        page, review = patient.new_page(), doctor.new_page()
        for view in (page, review):
            view.on("pageerror", lambda error: errors.append(str(error)))
        for index, (mode, decision, label, status, publication) in enumerate(matrices):
            httpx.post(API + "/__fixture/mode/" + mode).raise_for_status()
            page.goto(FRONTEND + "/diagnosis")
            page.wait_for_load_state("networkidle")
            page.get_by_label("选择眼底图片").set_input_files({
                "name": "fundus.png", "mimeType": "image/png", "buffer": picture_bytes()})
            with page.expect_response(lambda response: response.url == API + "/api/diagnosis/workflows"
                                      and response.request.method == "POST") as created:
                page.get_by_role("button", name="创建分析任务", exact=True).click()
            task = created.value.json()["data"]["workflowId"]
            expect(page.get_by_role("heading", name="等待医生复核", exact=True)).to_be_visible()
            before = httpx.get(API + "/__fixture/proof").json()
            listed = httpx.get(API + "/api/reviews/tasks", cookies={SESSION_COOKIE_NAME: "doctor"}).json()["data"]
            item = next(row for row in listed if row["workflowId"] == task)
            task_url = API + "/api/reviews/tasks/" + item["reviewTaskId"]
            review.goto(FRONTEND + "/doctor/reviews?task=" + item["reviewTaskId"])
            review.wait_for_load_state("networkidle")
            expect(review.get_by_role("heading", name="最终临床复核", exact=True)).to_be_visible()
            review.get_by_role("button", name="领取最终临床复核", exact=True).click()
            expect(review.get_by_role("button", name="提交最终临床决定", exact=True)).to_be_visible()
            review.reload()
            expect(review.get_by_role("button", name="提交最终临床决定", exact=True)).to_be_visible()
            allowed = ["CONFIRM_AI_ASSESSMENT", "CORRECT_AI_ASSESSMENT", "INCONCLUSIVE"] if mode == "valid" else ["CONFIRM_ABSTENTION", "PROVIDE_INDEPENDENT_REVIEW", "INCONCLUSIVE"]
            assert review.locator('input[name="clinical-decision"]').evaluate_all("els => els.map(el => el.value)") == allowed
            detail = httpx.get(task_url, cookies={SESSION_COOKIE_NAME: "doctor"}).json()["data"]
            payload = {"expectedTaskVersion": detail["taskVersion"], "expectedWorkflowVersion": detail["workflowVersion"],
                "expectedExplanationSnapshotId": detail["explanation"]["snapshotId"],
                "expectedExplanationRevision": detail["explanation"]["revision"]}
            if index == 0:
                # Real conflicting route response must clear the stale form.
                review.route("**/api/reviews/tasks/*/submit", lambda route: route.continue_(post_data=json.dumps({
                    **payload, "decisionCode": decision, "reasonCode": "AI_ASSESSMENT_CONFIRMED", "expectedTaskVersion": "0"})))
                review.get_by_label(label, exact=True).check()
                review.get_by_role("button", name="提交最终临床决定", exact=True).click()
                expect(review.get_by_role("alert")).to_contain_text("版本已变化")
                expect(review.locator('input[name="clinical-decision"]')).to_have_count(0)
                review.screenshot(path=str(output / "issue10-conflict.png"), full_page=True)
                review.unroute("**/api/reviews/tasks/*/submit")
                review.get_by_role("button", name="刷新复核任务", exact=True).click()
                expect(review.get_by_role("button", name="提交最终临床决定", exact=True)).to_be_visible()
            review.get_by_label(label, exact=True).check()
            if index == 1:
                review.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
                review.screenshot(path=str(output / "issue10-doctor-dark.png"), full_page=True)
                review.set_viewport_size({"width": 390, "height": 844})
                assert review.locator('.clinical-detail').evaluate("el => el.scrollWidth <= el.clientWidth")
                review.screenshot(path=str(output / "issue10-doctor-mobile.png"), full_page=True)
                review.set_viewport_size({"width": 1360, "height": 1100})
                review.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
            with review.expect_response(lambda response: response.url == task_url + "/submit") as submitted:
                review.get_by_role("button", name="提交最终临床决定", exact=True).click()
            assert submitted.value.status == 200
            submitted_body = submitted.value.request.post_data_json
            receipt = submitted.value.json()
            expect(review.get_by_text("此决定不能覆盖", exact=False)).to_be_visible()
            assert httpx.post(task_url + "/submit", json=submitted_body, cookies={SESSION_COOKIE_NAME: "doctor"}).json() == receipt
            page.reload()
            expect(page.get_by_role("heading", name="处理完成" if status == "COMPLETED" else "处理完成，结果受限", exact=True)).to_be_visible()
            expect(page.get_by_text("医生最终临床复核：", exact=False)).to_contain_text(label)
            expect(page.get_by_text("正式诊断记录尚未保存", exact=False)).to_be_visible()
            expect(page.get_by_role("heading", name="模型评估", exact=True)).to_have_count(1 if publication == "PUBLISHED" else 0)
            current = httpx.get(API + "/api/diagnosis/workflows/" + task, cookies={SESSION_COOKIE_NAME: "alice"}).json()["data"]
            assert current["status"] == status and current["explanation"]["publicationStatus"] == publication
            expected_events = ["FINAL_REVIEW_CLAIMED", "FINAL_REVIEW_SUBMITTED"] + (
                ["EXPLANATION_PUBLISHED" if publication == "PUBLISHED" else "EXPLANATION_WITHHELD"] if mode == "valid" else [])
            assert [event["eventType"] for event in current["finalReview"]["audit"]] == expected_events
            page.get_by_text("复核与发布审计", exact=True).click()
            expect(page.get_by_text("医生提交最终决定 ·", exact=False)).to_be_visible()
            after = httpx.get(API + "/__fixture/proof").json()
            assert before["envelopes"] == after["envelopes"]
            assert before["inferenceCalls"] == after["inferenceCalls"]
            assert before["explanationCalls"] == after["explanationCalls"]
            events = [event["type"] for event in after["doctorEvents"] if event["workflow"] == task]
            assert events == ["FINAL_REVIEW_CLAIMED", "FINAL_REVIEW_SUBMITTED"]
            page.screenshot(path=str(output / f"issue10-patient-{index}.png"), full_page=True)
            review.reload()
            expect(review.get_by_text("此决定不能覆盖", exact=False)).to_be_visible()
            expect(review.get_by_text("解释版本", exact=True).locator(".." )).to_contain_text(publication)
            review.get_by_text("复核与发布审计", exact=True).click()
            expect(review.get_by_text("医生提交最终决定 ·", exact=False)).to_be_visible()
            review.screenshot(path=str(output / f"issue10-doctor-{index}.png"), full_page=True)
            results.append({"mode": mode, "decision": decision, "status": status, "publication": publication, "replayOnce": True, "envelopeUnchanged": True})
        browser.close()
    assert not errors, errors
    report = {"boundary": "Actual Vue/Chromium/FastAPI HTTP/LangGraph/SQL persistence; controlled SQLite, Java, Chroma, embeddings and models",
              "matrix": results, "conflict": True, "reload": True, "pageErrors": errors}
    (output / "ui-results.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
