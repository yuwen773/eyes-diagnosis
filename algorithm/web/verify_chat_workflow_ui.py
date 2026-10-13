"""Issue06 original Vue + real HTTP/SSE/Worker browser regression.

Owns loopback fixture processes and disposable SQLite only. Identity/model/COS
are doubles; missing weights intentionally produce MODEL_UNAVAILABLE.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlparse

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes

API = "http://127.0.0.1:18805"
UI = "http://127.0.0.1:15175"


def ready(process, url):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Fixture process exited; inspect fixture.log")
        try:
            if httpx.get(url, timeout=.5).status_code == 200:
                return process
        except httpx.HTTPError:
            pass
        time.sleep(.1)
    raise RuntimeError("Fixture startup timed out")


def stop(process):
    if process is not None and process.poll() is None:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        else:
            process.terminate()
        process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for port in (18805, 15175):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"Port {port} is already in use; no existing process will be stopped")
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    backend = vite = None
    checks, errors = [], []
    with tempfile.TemporaryDirectory(prefix="eye-binding-ui-") as directory, (
            args.output_dir / "fixture.log").open("w", encoding="utf-8") as log:
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
            with sync_playwright() as playwright, httpx.Client(base_url=API, cookies={"SESSION": "alice"}) as api:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1360, "height": 1000})
                context.add_cookies([{"name": "SESSION", "value": "alice", "url": API}])
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                requests = []
                page.on("request", lambda request: requests.append(request.post_data_json)
                    if request.url.endswith("/api/agent/chat/stream") else None)
                page.goto(UI + "/agent")
                page.wait_for_load_state("networkidle")
                page.screenshot(path=str(args.output_dir / "issue06-initial.png"), full_page=True)
                expect(page.get_by_label("受控图片诊断（单张）")).to_be_visible()

                def attach():
                    page.locator('input[type="file"]').set_input_files({
                        "name": "fundus.png", "mimeType": "image/png", "buffer": picture_bytes()})

                def workflow_id():
                    return parse_qs(urlparse(page.url).query)["workflow"][0]

                page.get_by_label("受控图片诊断（单张）").check()
                attach()
                page.get_by_role("button", name="发送", exact=True).click()
                expect(page.get_by_label("任务状态")).to_contain_text("等待处理")
                first_id = workflow_id()
                first_request = requests[-1]
                repeated = api.post("/api/agent/chat/stream", json=first_request)
                assert first_id in repeated.text
                replay = api.post("/api/diagnosis/workflows", data={
                    "idempotencyKey": first_request["diagnosis"]["idempotencyKey"]},
                    files={"file": ("fundus.png", picture_bytes(), "image/png")})
                assert replay.json()["data"]["workflowId"] == first_id
                checks.append("chat-and-upload-share-one-idempotent-operation")
                assert api.post("/fixture/run-worker").json()["segments"] == 2
                page.get_by_role("button", name="刷新状态", exact=True).click()
                expect(page.get_by_label("任务状态")).to_contain_text("模型当前不可用")
                page.screenshot(path=str(args.output_dir / "issue06-chat-failure.png"), full_page=True)
                page.get_by_role("link", name="在诊断页查看同一任务").click()
                page.wait_for_url("**/diagnosis?workflow=*")
                expect(page.get_by_label("任务状态")).to_contain_text(first_id)
                expect(page.get_by_label("任务状态")).to_contain_text("模型当前不可用")
                page.reload()
                expect(page.get_by_label("任务状态")).to_contain_text(first_id)
                page.screenshot(path=str(args.output_dir / "issue06-upload-same-task.png"), full_page=True)
                checks.append("page-switch-and-refresh-show-same-server-failure")
                page.get_by_role("link", name="在聊天中继续此任务").click()
                page.wait_for_url("**/agent?workflow=*")
                expect(page.get_by_label("任务状态")).to_contain_text(first_id)
                stop(backend)
                backend = start_backend()
                page.reload()
                expect(page.get_by_label("任务状态")).to_contain_text(first_id)
                expect(page.get_by_label("任务状态")).to_contain_text("模型当前不可用")
                assert api.post("/fixture/run-worker").json()["segments"] == 0
                checks.append("backend-process-restart-and-reads-do-not-rerun-inference")

                page.goto(UI + "/diagnosis")
                page.wait_for_load_state("networkidle")
                attach()
                page.get_by_role("button", name="创建分析任务").click()
                expect(page.get_by_label("任务状态")).to_contain_text("等待处理")
                second_id = workflow_id()
                assert second_id != first_id
                page.get_by_role("link", name="在聊天中继续此任务").click()
                page.wait_for_url("**/agent?workflow=*")
                page.get_by_role("button", name="关联到当前对话").click()
                expect(page.get_by_role("button", name="关联到当前对话")).to_have_count(0)
                session_id = page.evaluate("localStorage.getItem('agent_current_thread_id')")
                state = api.get(f"/api/agent/history/{session_id}").json()["data"]
                assert {w["workflowId"] for w in state["workflows"]} == {first_id, second_id}
                checks.append("upload-created-task-binds-to-chat-without-duplicate")

                # Commit at the server but lose the response, then reload and retry the stored request.
                page.get_by_role("button", name="新对话", exact=True).click()
                page.get_by_label("受控图片诊断（单张）").check()
                attach()

                def lose_ack(route):
                    route.fetch()
                    route.abort()

                page.route("**/api/agent/chat/stream", lose_ack, times=1)
                page.get_by_role("button", name="发送", exact=True).click()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_be_visible()
                lost_request = requests[-1]
                page.reload()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_be_visible()
                page.get_by_role("button", name="重试诊断提交（同一请求）").click()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_have_count(0)
                assert requests[-1] == lost_request
                state = api.get(f"/api/agent/history/{lost_request['threadId']}").json()["data"]
                assert len(state["workflows"]) == len(state["messages"]) == 1
                page.screenshot(path=str(args.output_dir / "issue06-retry-restored.png"), full_page=True)
                checks.append("lost-ack-reload-retries-identical-request-once")

                # An unreceived command has no server session yet; switching must not strand its key.
                page.get_by_role("button", name="新对话", exact=True).click()
                page.get_by_label("受控图片诊断（单张）").check()
                attach()
                page.route("**/api/agent/chat/stream", lambda route: route.abort(), times=1)
                page.get_by_role("button", name="发送", exact=True).click()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_be_visible()
                unsent_request = requests[-1]
                context.add_cookies([{"name": "SESSION", "value": "bob", "url": API}])
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_have_count(0)
                context.add_cookies([{"name": "SESSION", "value": "alice", "url": API}])
                page.reload()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_be_visible()
                checks.append("pending-request-isolated-by-login-user")
                page.get_by_role("button", name="新对话", exact=True).click()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_be_visible()
                page.reload()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_be_visible()
                page.get_by_role("button", name="重试诊断提交（同一请求）").click()
                expect(page.get_by_role("button", name="重试诊断提交（同一请求）")).to_have_count(0)
                assert requests[-1] == unsent_request
                assert len(api.get(f"/api/agent/history/{unsent_request['threadId']}").json()["data"]["workflows"]) == 1
                checks.append("unreceived-command-can-recover-after-new-chat-and-reload")

                # Hold a history response, start a new conversation, then deliver the old task.
                held = []
                path = f"**/api/agent/history/{session_id}?*"
                page.route(path, lambda route: held.append(route), times=1)
                with page.expect_request(lambda request: f"/agent/history/{session_id}?" in request.url):
                    page.locator(".history-item").filter(has_text="图片会话").last.click()
                page.get_by_role("button", name="新对话", exact=True).click()
                assert len(held) == 1
                body = api.get(f"/api/agent/history/{session_id}").json()
                held[0].fulfill(status=200, content_type="application/json", body=json.dumps(body))
                page.wait_for_load_state("networkidle")
                expect(page.get_by_label("本会话诊断任务")).to_have_count(0)
                assert "workflow=" not in page.url
                checks.append("stale-history-cannot-attach-another-conversations-task")

                page.get_by_role("button", name="新对话", exact=True).click()
                page.get_by_label("受控图片诊断（单张）").uncheck()
                page.locator("textarea").fill("普通聊天，帮我诊断但不要创建任务")
                page.get_by_role("button", name="发送", exact=True).click()
                expect(page.locator(".assistant-message")).to_be_visible()
                assert "diagnosis" not in requests[-1]
                assert api.get(f"/api/agent/history/{requests[-1]['threadId']}").json()["data"]["workflows"] == []
                assert api.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
                checks.append("ordinary-chat-kept-separate-and-no-formal-diagnosis-saved")
                assert not errors, errors
                browser.close()
        finally:
            stop(vite)
            stop(backend)
    result = {"date": "2026-10-13", "checks": checks, "pageErrors": errors,
              "scope": "Original Vue, real HTTP/SSE/Worker, disposable SQLite; synthetic identity/COS/model; no real diagnosis"}
    (args.output_dir / "issue06-ui-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                                                          encoding="utf-8", newline="\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
