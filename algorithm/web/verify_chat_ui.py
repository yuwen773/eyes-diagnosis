"""Chromium against local Vue/HTTP/SSE; all identities/models/storage are synthetic.

Start Vite on 15175 with both API base settings pointing at 127.0.0.1:18805.
This verifier owns and restarts only its fixture backend, never a real service.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from playwright.sync_api import expect, sync_playwright

SESSION_COOKIE_NAME = "EYE_SESSION"

API = "http://127.0.0.1:18805"
FRONTEND = "http://127.0.0.1:15175"


def start_backend(directory: str, output):
    env = dict(os.environ, CHAT_UI_DIRECTORY=directory)
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "web.tests.chat_ui_server:app",
        "--host", "127.0.0.1", "--port", "18805"], env=env, stdout=output, stderr=output,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Fixture backend exited; inspect its log")
        try:
            if httpx.get(API + "/health", timeout=.5).status_code == 200:
                return process
        except httpx.HTTPError:
            pass
        time.sleep(.1)
    process.kill()
    process.wait()
    raise RuntimeError("Fixture backend startup timeout")


def stop_backend(process):
    process.kill()
    process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    with tempfile.TemporaryDirectory(prefix="eye-chat-ui-") as directory, (
        args.output_dir / "fixture.log").open("w", encoding="utf-8") as log:
        process = start_backend(directory, log)
        try:
            with sync_playwright() as playwright, httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "alice"}) as api:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1360, "height": 1000})
                context.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice", "url": API}])
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(FRONTEND + "/agent")
                page.wait_for_load_state("networkidle")
                # Reconnaissance: retain the initial page before interacting with its controls.
                page.screenshot(path=str(args.output_dir / "issue05-initial.png"), full_page=True)
                expect(page.get_by_role("button", name="发送", exact=True)).to_be_visible()

                def send(text):
                    page.locator("textarea").fill(text)
                    with page.expect_response(lambda response: response.url.endswith("/api/agent/chat/stream")) as pending:
                        page.get_by_role("button", name="发送", exact=True).click()
                    assert pending.value.status == 200
                    expect(page.get_by_role("button", name="发送", exact=True)).to_be_visible(timeout=10000)

                send("暗号是橙子")
                expect(page.locator(".assistant-message")).to_contain_text("橙子")
                session_id = page.evaluate("localStorage.getItem('agent_current_thread_id')")
                assert session_id
                send("我之前的暗号是什么？")
                expect(page.locator(".assistant-message").last).to_contain_text("橙子")
                page.screenshot(path=str(args.output_dir / "issue05-two-turns.png"), full_page=True)
                checks.append("two-turn-context-in-original-page")
                stop_backend(process)
                process = start_backend(directory, log)
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.locator(".assistant-message")).to_have_count(2)
                page.screenshot(path=str(args.output_dir / "issue05-process-restored.png"), full_page=True)
                checks.append("history-after-backend-process-restart")

                page.get_by_role("button", name="新对话", exact=True).click()
                send("我之前的暗号是什么？")
                expect(page.locator(".assistant-message")).to_contain_text("没有提供暗号")
                checks.append("other-session-excluded")
                send("故障测试")
                expect(page.get_by_role("alert").filter(has_text="回答未完成").first).to_be_visible()
                assert page.locator(".assistant-message").count() == 1
                failed_id = page.evaluate("localStorage.getItem('agent_current_thread_id')")
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.get_by_role("alert").filter(has_text="上次回答未完成")).to_be_visible()
                page.screenshot(path=str(args.output_dir / "issue05-model-error.png"), full_page=True)
                assert api.get(f"/api/agent/history/{failed_id}").json()["data"]["executions"][-1]["status"] == "FAILED"
                checks.append("model-error-and-failed-history")

                # Attach through the original input, then verify its restored thumbnail.
                from web.tests.test_workflow import picture_bytes
                page.get_by_role("button", name="新对话", exact=True).click()
                page.locator('input[type="file"]').set_input_files({"name": "fixture.png",
                    "mimeType": "image/png", "buffer": picture_bytes()})
                send("附件上下文测试")
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.locator(".user-message img")).to_have_count(1)
                page.screenshot(path=str(args.output_dir / "issue05-attachment-restored.png"), full_page=True)
                checks.append("attachment-through-original-input-and-reload")

                page.get_by_role("button", name="新对话", exact=True).click()
                page.locator("textarea").fill("慢速中断测试")
                page.get_by_role("button", name="发送", exact=True).click()
                expect(page.locator(".assistant-message")).to_contain_text("partial")
                page.get_by_role("button", name="停止生成", exact=True).click()
                expect(page.get_by_role("alert").filter(has_text="回答已停止").first).to_be_visible()
                stopped_id = page.evaluate("localStorage.getItem('agent_current_thread_id')")
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    state = api.get(f"/api/agent/history/{stopped_id}").json()["data"]
                    if state["executions"][0]["status"] == "INTERRUPTED":
                        break
                    time.sleep(.1)
                assert state["executions"][0]["status"] == "INTERRUPTED"
                assert [m["role"] for m in state["messages"]] == ["USER"]
                checks.append("client-stop-persists-interrupted-without-success")

                forbidden = httpx.get(API + f"/api/agent/history/{session_id}", cookies={SESSION_COOKIE_NAME: "bob"}).json()
                assert forbidden["code"] == 40101
                checks.append("cross-user-history-denied")
                requests = [json.loads(line) for line in (Path(directory) / "model-requests.jsonl").read_text(encoding="utf-8").splitlines()]
                assert requests[1]["messages"][1]["content"] == "暗号是橙子"
                assert [m["role"] for m in requests[1]["messages"]] == ["system", "user", "assistant", "user"]
                assert not errors, errors
                browser.close()
        finally:
            if process.poll() is None:
                stop_backend(process)
    result = {"date": "2026-10-13", "checks": checks, "pageErrors": errors,
        "scope": "Local Chromium/Vue/FastAPI/SSE and backend process restart; SQLite and Java/model/COS doubles"}
    (args.output_dir / "issue05-ui-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                                                          encoding="utf-8", newline="\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
