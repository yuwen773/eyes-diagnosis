"""Issue12 real Vue/HTTP/SSE and backend process restart; synthetic services."""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes
from web.verify_chat_workflow_ui import ready, stop

SESSION_COOKIE_NAME = "EYE_SESSION"

API = "http://127.0.0.1:18805"
UI = "http://127.0.0.1:15175"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir
    output.mkdir(parents=True, exist_ok=True)
    for port in (18805, 15175):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"Port {port} is occupied; no existing process will be stopped")
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    backend = vite = None
    checks, errors = [], []
    with tempfile.TemporaryDirectory(prefix="eye-supplement-ui-") as directory, (
            output / "fixture.log").open("w", encoding="utf-8") as log:
        env = dict(os.environ, CHAT_UI_DIRECTORY=directory,
                   VITE_API_BASE_URL=API + "/api", VITE_APP_API_BASE_URL=API)

        def start_backend():
            process = subprocess.Popen([sys.executable, "-m", "uvicorn",
                "web.tests.workflow_binding_ui_server:app", "--host", "127.0.0.1", "--port", "18805"],
                env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                return ready(process, API + "/health")
            except Exception:
                stop(process)
                raise

        try:
            backend = start_backend()
            vite = subprocess.Popen([shutil.which("node"), str(frontend / "node_modules/vite/bin/vite.js"),
                "--host", "127.0.0.1", "--port", "15175", "--strictPort"], cwd=frontend,
                env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            ready(vite, UI)
            with sync_playwright() as playwright, httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "alice"}) as api:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1360, "height": 1100})
                context.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice", "url": API}])
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                attachment = api.post("/api/agent/image/upload", files={"file": ("fundus.png", picture_bytes(), "image/png")}).json()["data"]
                started = api.post("/api/agent/chat/stream", json={"threadId": "issue12-browser", "message": "本次眼底图片",
                    "diagnosis": {"imageUrl": attachment, "idempotencyKey": "browser-task"}})
                assert "event: workflow" in started.text and "event: done" in started.text
                task = api.get("/api/agent/history/issue12-browser").json()["data"]["workflows"][0]["workflowId"]
                page.goto(UI + "/agent")
                page.wait_for_load_state("networkidle")
                page.evaluate("localStorage.setItem('agent_current_thread_id', 'issue12-browser')")
                page.reload()
                expect(page.get_by_label("本会话诊断任务")).to_be_visible()
                page.get_by_role("button", name="补充本次说明", exact=True).click()
                panel = page.get_by_role("region", name="待补充说明", exact=True)
                expect(panel.get_by_role("status")).to_have_text("等待您补充说明")
                wait = api.get("/api/agent/history/issue12-browser").json()["data"]["supplements"][0]
                assert wait["workflowId"] == task and wait["status"] == "WAITING"
                page.screenshot(path=str(output / "issue12-waiting.png"), full_page=True)
                page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
                page.screenshot(path=str(output / "issue12-dark.png"), full_page=True)
                page.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
                page.set_viewport_size({"width": 390, "height": 844})
                assert panel.evaluate("el => el.scrollWidth <= el.clientWidth")
                assert panel.bounding_box()["width"] >= 300
                expect(panel.get_by_role("button", name="提交补充并继续", exact=True)).to_be_visible()
                page.screenshot(path=str(output / "issue12-mobile.png"), full_page=True)
                page.set_viewport_size({"width": 1360, "height": 1100})
                checks.append("chat-sse-creates-correlated-wait-with-desktop-mobile-dark-reply-entry")

                stop(backend)
                backend = start_backend()
                page.reload()
                expect(panel.get_by_role("status")).to_have_text("等待您补充说明")
                restored = api.get("/api/agent/history/issue12-browser").json()["data"]
                assert restored["supplements"] == [wait]
                assert len(restored["messages"]) == 3
                for _ in range(3):
                    assert api.get("/api/agent/history/issue12-browser").json()["data"] == restored
                checks.append("backend-process-restart-restores-same-wait-without-original-input-loop")

                url = API + f"/api/agent/supplements/{wait['requestId']}/reply"
                invalid = api.post(url, json={"sessionId": wait["sessionId"], "workflowId": task,
                    "expectedVersion": "99", "text": "过期版本"})
                assert invalid.json()["code"] == 50001
                text = "暗号是橙子。补充给医生：这张是左眼图片。"
                panel.get_by_label("本次补充说明", exact=True).fill(text)

                def lose_receipt(route):
                    response = route.fetch()
                    assert response.json()["data"]["status"] == "ANSWERED"
                    route.abort("failed")

                page.route(url, lose_receipt, times=1)
                panel.get_by_role("button", name="提交补充并继续", exact=True).click()
                expect(panel.get_by_role("alert")).to_be_visible()
                expect(panel.get_by_label("本次补充说明", exact=True)).to_have_value(text)
                panel.get_by_role("button", name="提交补充并继续", exact=True).click()
                expect(panel).to_have_count(0)
                history = api.get("/api/agent/history/issue12-browser").json()["data"]
                assert history["supplements"][0]["status"] == "ANSWERED"
                assert len(history["messages"]) == 5
                assert [m["content"] for m in history["messages"]].count(text) == 1
                assert history["workflows"][0]["workflowId"] == task
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.locator(".assistant-message").filter(has_text="已收到本次补充说明")).to_be_visible()
                expect(panel).to_have_count(0)
                page.screenshot(path=str(output / "issue12-resumed.png"), full_page=True)
                checks.append("lost-reply-receipt-retries-idempotently-and-refresh-restores-answer")

                page.locator(".chat-textarea").fill("刚才的暗号是什么？")
                page.get_by_role("button", name="发送", exact=True).click()
                expect(page.locator(".assistant-message").last).to_contain_text("橙子")
                page.get_by_role("button", name="补充本次说明", exact=True).click()
                expect(panel).to_be_visible()
                page.get_by_role("button", name="新对话", exact=True).click()
                expect(panel).to_have_count(0)
                assert api.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
                checks.append("answer-enters-session-chat-without-formal-save-or-cross-session-wait")
                assert not errors, errors
                browser.close()
        finally:
            stop(vite)
            stop(backend)
    result = {"date": "2026-10-14", "checks": checks, "pageErrors": errors,
        "scope": "Original Vue + HTTP/SSE + durable SQLite + process restart; synthetic identity/model/COS; no real MySQL/model acceptance"}
    (output / "issue12-ui-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                                                  encoding="utf-8", newline="\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
