"""Actual Vue chat with controlled HTTP/model/Java and file SQLite."""

import argparse
import json
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

SESSION_COOKIE_NAME = "EYE_SESSION"

API = "http://127.0.0.1:15285"
FRONTEND = "http://127.0.0.1:15286"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    output = parser.parse_args().output_dir
    output.mkdir(parents=True, exist_ok=True)
    errors, checks = [], []
    with sync_playwright() as playwright, httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "alice"}) as api:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1360, "height": 1000})
        context.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice", "url": API}])
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(FRONTEND + "/agent")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(output / "initial.png"), full_page=True)
        def send():
            page.locator("textarea").fill("请把我的简介改为眼科学生")
            page.get_by_role("button", name="发送", exact=True).click()
            expect(page.get_by_role("button", name="批准此版本修改").last).to_be_visible(timeout=15000)
        def profile():
            return api.get("/api/agent/profile").json()["data"]["userProfile"]
        send()
        region = page.get_by_role("region", name="资料变更确认")
        expect(region).to_contain_text("旧简介")
        expect(region).to_contain_text("眼科学生")
        assert profile() == "旧简介"
        page.screenshot(path=str(output / "pending.png"), full_page=True)
        page.reload()
        expect(region.get_by_role("button", name="拒绝修改")).to_be_visible(timeout=15000)
        checks.append("pending-restored-after-refresh")
        region.get_by_role("button", name="拒绝修改").click()
        expect(region).to_contain_text("已拒绝，未修改")
        assert profile() == "旧简介"
        checks.append("reject-no-profile-effect")
        send()
        session_id = page.evaluate("localStorage.getItem('agent_current_thread_id')")
        rows = api.get("/api/agent/tool-confirmations", params={"sessionId": session_id}).json()["data"]
        row = next(row for row in rows if row["status"] == "PENDING")
        api.post("/fixture/expire/" + row["confirmationId"])
        region.get_by_role("button", name="刷新确认状态").click()
        expect(region).to_contain_text("已过期")
        assert profile() == "旧简介"
        checks.append("expiry-displayed-no-profile-effect")
        send()
        row = next(row for row in api.get("/api/agent/tool-confirmations", params={"sessionId": session_id}).json()["data"] if row["status"] == "PENDING")
        page.set_viewport_size({"width": 390, "height": 844})
        expect(region.get_by_role("button", name="批准此版本修改")).to_be_visible()
        region.get_by_role("button", name="批准此版本修改").scroll_into_view_if_needed()
        assert region.evaluate("element => element.clientWidth >= 300 && element.scrollWidth <= element.clientWidth + 1")
        page.screenshot(path=str(output / "narrow-pending.png"), full_page=True)
        page.set_viewport_size({"width": 1360, "height": 1000})
        region.get_by_role("button", name="批准此版本修改").click()
        expect(region).to_contain_text("已批准并完成修改")
        assert profile() == "眼科学生"
        body = {"idempotencyKey": row["idempotencyKey"], "expectedContentDigest": row["contentDigest"]}
        receipt = api.post(f'/api/agent/tool-confirmations/{row["confirmationId"]}/approve', json=body).json()
        assert receipt["data"]["status"] == "APPROVED"
        with httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "bob"}) as other:
            assert other.post(f'/api/agent/tool-confirmations/{row["confirmationId"]}/approve', json=body).json().get("code", -1) != 0
        checks.extend(["approve-profile-effect", "replay-receipt", "cross-user-denied"])
        page.reload()
        expect(region).to_contain_text("已批准并完成修改", timeout=15000)
        page.screenshot(path=str(output / "approved.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert region.evaluate("element => element.scrollWidth <= element.clientWidth + 1")
        page.screenshot(path=str(output / "narrow.png"), full_page=True)
        page.set_viewport_size({"width": 1360, "height": 1000})
        page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
        page.screenshot(path=str(output / "dark.png"), full_page=True)
        assert not errors, errors
        (output / "ui-results.json").write_text(json.dumps({"checks": checks, "pageErrors": errors,
            "profile": profile()}, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    main()
