"""Patient upload/result/consent via Vue + HTTP + worker + headless Chromium."""

import argparse
import json
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes
from web.tests.test_save_confirmation import decision, requested

SESSION_COOKIE_NAME = "EYE_SESSION"

API = "http://127.0.0.1:15281"
FRONTEND = "http://127.0.0.1:15282"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    def count():
        return httpx.get(API + "/__fixture/count").json()["formalRecords"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1360, "height": 1100})
        context.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice", "url": API}])
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        def upload():
            page.goto(FRONTEND + "/diagnosis")
            page.wait_for_load_state("networkidle")
            page.get_by_label("选择眼底图片").set_input_files({
                "name": "fundus.png", "mimeType": "image/png", "buffer": picture_bytes()})
            with page.expect_response(lambda response: response.url == API + "/api/diagnosis/workflows"
                    and response.request.method == "POST") as created:
                page.get_by_role("button", name="创建分析任务", exact=True).click()
            return created.value.json()["data"]["workflowId"]
        task = upload()
        save = page.get_by_role("region", name="正式诊断保存", exact=True)
        expect(save.get_by_role("button", name="查看拟保存内容")).to_be_visible()
        assert count() == 0
        save.get_by_role("button", name="查看拟保存内容").click()
        expect(save.get_by_role("heading", name="拟保存内容", exact=True)).to_be_visible()
        assert count() == 0
        image = save.get_by_alt_text("拟保存的本次眼底图片")
        expect(image).to_be_visible()
        assert image.evaluate("el => el.complete && el.naturalWidth > 0")
        page.screenshot(path=str(output / "issue11-preview.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert save.evaluate("el => el.scrollWidth <= el.clientWidth")
        page.screenshot(path=str(output / "issue11-mobile.png"), full_page=True)
        page.set_viewport_size({"width": 1360, "height": 1100})
        page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
        page.screenshot(path=str(output / "issue11-dark.png"), full_page=True)
        page.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
        page.reload()
        expect(save.get_by_role("heading", name="等待您确认保存", exact=True)).to_be_visible()
        row = httpx.get(API + f"/api/diagnosis/workflows/{task}/save-confirmation", cookies={SESSION_COOKIE_NAME: "alice"}).json()["data"]
        approve_url = API + f'/api/diagnosis/workflows/{task}/save-confirmations/{row["confirmationId"]}/approve'
        assert httpx.post(approve_url, json=decision(row), cookies={SESSION_COOKIE_NAME: "bob"}).status_code == 403
        save.get_by_role("button", name="拒绝保存", exact=True).click()
        expect(save.get_by_role("heading", name="您已拒绝保存，未建立正式记录", exact=True)).to_be_visible()
        assert count() == 0
        page.reload()
        expect(save.get_by_role("heading", name="您已拒绝保存，未建立正式记录", exact=True)).to_be_visible()
        page.screenshot(path=str(output / "issue11-rejected.png"), full_page=True)
        save.get_by_role("button", name="查看拟保存内容").click()
        expect(save.get_by_role("heading", name="等待您确认保存", exact=True)).to_be_visible()
        row = httpx.get(API + f"/api/diagnosis/workflows/{task}/save-confirmation", cookies={SESSION_COOKIE_NAME: "alice"}).json()["data"]
        httpx.post(API + "/__fixture/expire/" + row["confirmationId"]).raise_for_status()
        save.get_by_role("button", name="批准并保存正式诊断", exact=True).click()
        expect(save.get_by_role("alert")).to_contain_text("过期")
        assert count() == 0
        save.get_by_role("button", name="刷新保存状态", exact=True).click()
        expect(save.get_by_role("heading", name="确认已过期，未建立正式记录", exact=True)).to_be_visible()
        page.screenshot(path=str(output / "issue11-expired.png"), full_page=True)
        save.get_by_role("button", name="查看拟保存内容").click()
        expect(save.get_by_role("heading", name="等待您确认保存", exact=True)).to_be_visible()
        row = httpx.get(API + f"/api/diagnosis/workflows/{task}/save-confirmation", cookies={SESSION_COOKIE_NAME: "alice"}).json()["data"]
        save.get_by_role("button", name="批准并保存正式诊断", exact=True).click()
        expect(save.get_by_role("heading", name="正式诊断记录已保存", exact=True)).to_be_visible()
        assert count() == 1
        page.reload()
        expect(save.get_by_role("heading", name="正式诊断记录已保存", exact=True)).to_be_visible()
        assert save.get_by_role("button", name="批准并保存正式诊断", exact=True).count() == 0
        page.screenshot(path=str(output / "issue11-approved.png"), full_page=True)
        approve_url = API + f'/api/diagnosis/workflows/{task}/save-confirmations/{row["confirmationId"]}/approve'
        assert httpx.post(approve_url, json=decision(row), cookies={SESSION_COOKIE_NAME: "alice"}).status_code == 200
        assert count() == 1
        httpx.post(API + "/__fixture/clinical/true").raise_for_status()
        clinical_task = upload()
        expect(page.get_by_role("heading", name="等待医生复核", exact=True)).to_be_visible()
        expect(save.get_by_text("当前结果不能保存", exact=False)).to_be_visible()
        assert save.get_by_role("button", name="查看拟保存内容").count() == 0
        view = httpx.get(API + f"/api/diagnosis/workflows/{clinical_task}", cookies={SESSION_COOKIE_NAME: "alice"}).json()["data"]
        blocked = httpx.post(API + f"/api/diagnosis/workflows/{clinical_task}/save-confirmation",
            json=requested(view, "blocked"), cookies={SESSION_COOKIE_NAME: "alice"})
        assert blocked.status_code == 409 and count() == 1
        page.screenshot(path=str(output / "issue11-clinical-blocked.png"), full_page=True)
        browser.close()
    assert not errors, errors
    result = {"boundary": "SQLite + controlled Java/model/COS/Chroma; actual HTTP/Worker/Vue/Chromium",
        "previewDoesNotSave": True, "rejectedDoesNotSave": True, "expiredDoesNotSave": True,
        "crossUserBlocked": True, "approvedExactlyOnce": True, "refreshRestored": True,
        "clinicalReviewCannotBeBypassed": True, "formalRecords": count(), "savePanelOverflow": False,
        "pageErrors": errors, "workflowId": task}
    (output / "issue11-ui-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
