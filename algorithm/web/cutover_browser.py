"""Headless browser acceptance against isolated real Nginx, never network mocks."""

import io
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright


def verify_browser(proxy, password: str, runtime: Path, worker, report: dict) -> None:
    origin = f"http://127.0.0.1:{proxy.port}"
    image = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(image, format="PNG")
    captures = runtime / "browser"
    captures.mkdir()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page.goto(origin + "/user/login", wait_until="networkidle")
            page.get_by_placeholder("请输入账号").fill("issue19_alice")
            page.get_by_placeholder("请输入密码").fill(password)
            with page.expect_response(lambda r: r.url == origin + "/api/user/login" and r.request.method == "POST") as login:
                page.get_by_role("button", name="登 录").click()
            (captures / "login-response.txt").write_text(
                str(login.value.status) + " " + login.value.headers.get("content-type", "") + "\n" + login.value.text(), encoding="utf-8")
            assert login.value.json()["code"] == 0
            page.wait_for_url(origin + "/")
            page.screenshot(path=str(captures / "login.png"))
            page.goto(origin + "/diagnosis", wait_until="networkidle")
            page.locator("#workflow-image").set_input_files({"name": "synthetic.png", "mimeType": "image/png", "buffer": image.getvalue()})
            with page.expect_response(lambda r: r.url == origin + "/api/diagnosis/workflows" and r.request.method == "POST") as upload:
                page.locator(".workflow-uploader .submit-button").click()
            assert upload.value.status == 202
            workflow = upload.value.json()["data"]["workflowId"]
            worker()
            page.reload(wait_until="networkidle")
            expect(page.locator(".workflow-uploader")).to_contain_text("处理完成，结果受限", timeout=15000)
            page.screenshot(path=str(captures / "workflow.png"))
            page.goto(origin + "/agent", wait_until="networkidle")
            page.locator("textarea.chat-textarea").fill("hello browser cutover")
            with page.expect_response(lambda r: r.url == origin + "/api/agent/chat/stream") as stream:
                page.get_by_role("button", name="发送", exact=True).click()
            assert stream.value.status == 200
            expect(page.locator("textarea.chat-textarea")).to_have_value("")
            expect(page.get_by_role("button", name="发送", exact=True)).to_be_visible(timeout=15000)
            assert "event: done" in stream.value.text()
            page.screenshot(path=str(captures / "chat.png"))
            report["browser"] = {"status": "PASS", "engine": "headless Chromium",
                "networkMocks": False, "checks": ["login", "upload-202", "workflow-reload", "chat-sse-done"],
                "workflowId": workflow}
        finally:
            browser.close()
