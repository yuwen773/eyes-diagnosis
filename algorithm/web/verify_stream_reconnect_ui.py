"""Issue18: disconnect actual Vue/SSE clients and recover authoritative state."""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes
from web.tests.test_final_clinical_review import final_versions
from web.tests.test_save_confirmation import requested, decision
from web.verify_chat_workflow_ui import ready

SESSION_COOKIE_NAME = "EYE_SESSION"

API = "http://127.0.0.1:15281"
UI = "http://127.0.0.1:15282"


def stop_owned(process, marker):
    if process is None or process.poll() is not None:
        return
    if os.name == "nt":
        command = f"Get-CimInstance Win32_Process -Filter 'ProcessId = {process.pid}' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
        info = json.loads(subprocess.check_output(["pwsh.exe", "-NoLogo", "-NoProfile", "-Command", command], text=True))
        if info["ProcessId"] != process.pid or info["Name"] not in {"python.exe", "node.exe"} or marker not in info["CommandLine"]:
            raise RuntimeError("Fixture ownership changed; refusing to stop process")
    process.terminate()
    process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    for port in (15281, 15282):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"Port {port} occupied; no existing process will be stopped")
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    errors, checks, commands = [], [], []
    backend = vite = None
    env = dict(os.environ, VITE_API_BASE_URL=API + "/api", VITE_APP_API_BASE_URL=API)
    with (output / "fixture.log").open("w", encoding="utf-8") as log:
        try:
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            backend = subprocess.Popen([sys.executable, "-m", "web.tests.reconnect_ui_server"],
                env=env, stdout=log, stderr=log, creationflags=flags)
            ready(backend, API + "/health")
            vite = subprocess.Popen([shutil.which("node"), str(frontend / "node_modules/vite/bin/vite.js"),
                "--host", "127.0.0.1", "--port", "15282", "--strictPort"], cwd=frontend,
                env=env, stdout=log, stderr=log, creationflags=flags)
            ready(vite, UI)
            with sync_playwright() as playwright, httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "alice"}) as api:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1360, "height": 1100})
                context.add_cookies([{"name": SESSION_COOKIE_NAME, "value": "alice", "url": API}])
                task = api.post("/api/diagnosis/workflows", data={"idempotencyKey": "issue18"},
                    files={"file": ("fundus.png", picture_bytes(), "image/png")}).json()["data"]["workflowId"]
                bound = api.post("/api/agent/chat/stream", json={"threadId": "reconnect", "message": "原诊断任务",
                    "diagnosis": {"workflowId": task}})
                assert "event: workflow" in bound.text and "event: done" in bound.text
                diagnosis, chat = context.new_page(), context.new_page()
                for page in (diagnosis, chat):
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.on("request", lambda req: commands.append(req.url) if req.method == "POST" else None)
                diagnosis.goto(UI + "/diagnosis?workflow=" + task)
                chat.goto(UI + "/agent?workflow=" + task)
                chat.evaluate("localStorage.setItem('agent_current_thread_id', 'reconnect')")
                chat.reload()
                for page in (diagnosis, chat):
                    expect(page.get_by_role("heading", name="等待处理", exact=True)).to_be_visible()
                    assert "validateImage" not in page.locator("body").inner_text()
                checks.append("snapshot-done-does-not-complete-task-on-either-page")

                context.set_offline(True)
                expect(diagnosis.get_by_role("alert")).to_contain_text("重新连接", timeout=15000)
                wait_stream = api.post("/api/agent/chat/stream", json={"threadId": "reconnect", "message": "补充本次说明",
                    "supplement": {"workflowId": task, "idempotencyKey": "wait-18"}})
                assert "event: supplement" in wait_stream.text
                api.post("/__fixture/run").raise_for_status()
                before = api.get("/__fixture/proof").json()
                assert before["inferenceCalls"] == 1 and before["formalRecords"] == 0
                context.set_offline(False)
                for page in (diagnosis, chat):
                    expect(page.get_by_role("heading", name="等待医生复核", exact=True)).to_be_visible(timeout=15000)
                    expect(page.get_by_text("等待您补充说明，请在原聊天中回复。", exact=False)).to_be_visible()
                    assert "glaucoma" not in page.locator("body").inner_text()
                    assert "unpublished model description" not in page.locator("body").inner_text()
                panel = chat.get_by_role("region", name="待补充说明", exact=True)
                panel.get_by_label("本次补充说明", exact=True).fill("左眼图片，供医生参考")
                panel.get_by_role("button", name="提交补充并继续", exact=True).click()
                expect(panel).to_have_count(0)
                expect(diagnosis.get_by_text("等待您补充说明，请在原聊天中回复。", exact=False)).to_have_count(0)
                diagnosis.screenshot(path=str(output / "review-reconnected.png"), full_page=True)
                checks.append("offline-reconnect-restores-review-and-supplement-without-exposing-prediction")

                with httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "doctor"}) as doctor:
                    review = next(row for row in doctor.get("/api/reviews/tasks").json()["data"] if row["workflowId"] == task)
                    path = "/api/reviews/tasks/" + review["reviewTaskId"]
                    detail = doctor.get(path).json()["data"]
                    assert doctor.post(path + "/claim", json=final_versions(detail)).status_code == 200
                    detail = doctor.get(path).json()["data"]
                    context.set_offline(True)
                    assert doctor.post(path + "/submit", json={**final_versions(detail), "decisionCode": "CONFIRM_AI_ASSESSMENT",
                        "reasonCode": "AI_ASSESSMENT_CONFIRMED"}).status_code == 200
                    api.post("/__fixture/run").raise_for_status()
                    context.set_offline(False)
                for page in (diagnosis, chat):
                    expect(page.get_by_role("heading", name="处理完成", exact=True)).to_be_visible(timeout=15000)
                    expect(page.get_by_role("heading", name="正式诊断记录尚未保存", exact=True)).to_be_visible()
                view = api.get(f"/api/diagnosis/workflows/{task}").json()["data"]
                consent = api.post(f"/api/diagnosis/workflows/{task}/save-confirmation", json=requested(view)).json()["data"]
                for page in (diagnosis, chat):
                    expect(page.get_by_role("heading", name="等待您确认保存", exact=True)).to_be_visible(timeout=15000)
                approve_url = API + f'/api/diagnosis/workflows/{task}/save-confirmations/{consent["confirmationId"]}/approve'

                def lose_receipt(route):
                    response = route.fetch()
                    assert response.json()["data"]["status"] == "APPROVED"
                    route.abort("failed")

                diagnosis.route(approve_url, lose_receipt, times=1)
                diagnosis.get_by_role("button", name="批准并保存正式诊断", exact=True).click()
                for page in (diagnosis, chat):
                    expect(page.get_by_role("heading", name="正式诊断记录已保存", exact=True)).to_be_visible(timeout=15000)
                assert api.post(approve_url, json=decision(consent)).status_code == 200
                assert api.get("/__fixture/proof").json()["formalRecords"] == 1
                diagnosis.reload()
                expect(diagnosis.get_by_role("heading", name="正式诊断记录已保存", exact=True)).to_be_visible()
                diagnosis.screenshot(path=str(output / "saved-reconnected.png"), full_page=True)
                checks.append("clinical-approval-is-not-save-and-lost-save-receipt-recovers-on-both-pages-exactly-once")

                chat.get_by_role("button", name="新对话", exact=True).click()
                expect(chat.get_by_label("本会话诊断任务")).to_have_count(0)

                def lose_answer(route):
                    response = route.fetch()
                    assert "event: done" in response.text()
                    route.abort("failed")

                chat.route(API + "/api/agent/chat/stream", lose_answer, times=1)
                chat.locator("textarea").fill("断连回执恢复")
                chat.get_by_role("button", name="发送", exact=True).click()
                expect(chat.locator(".assistant-message").filter(has_text="已持久化的完整回答")).to_be_visible(timeout=15000)
                restored_session = chat.evaluate("localStorage.getItem('agent_current_thread_id')")
                chat.reload()
                expect(chat.locator(".assistant-message").filter(has_text="已持久化的完整回答")).to_be_visible()
                assert len(api.get(f"/api/agent/history/{restored_session}").json()["data"]["messages"]) == 2
                assert api.get("/__fixture/proof").json()["chatCalls"] == 1
                checks.append("lost-chat-receipt-and-refresh-recover-persisted-answer-with-one-model-call")

                chat.get_by_role("button", name="新对话", exact=True).click()
                chat.locator("textarea").fill("故障测试")
                chat.get_by_role("button", name="发送", exact=True).click()
                expect(chat.locator(".assistant-message")).to_have_count(0)
                expect(chat.get_by_text("上次回答未完成，可以重新提问。", exact=True)).to_be_visible(timeout=15000)
                chat.reload()
                expect(chat.get_by_text("上次回答未完成，可以重新提问。", exact=True)).to_be_visible()
                assert "未完成片段" not in chat.locator("body").inner_text()
                checks.append("real-error-sse-and-refresh-never-present-partial-answer-as-success")

                chat.goto(UI + "/agent?workflow=" + task)
                chat.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
                expect(chat.get_by_role("heading", name="正式诊断记录已保存", exact=True)).to_be_visible()
                chat.screenshot(path=str(output / "dark.png"), full_page=True)
                diagnosis.set_viewport_size({"width": 390, "height": 844})
                assert diagnosis.get_by_role("region", name="任务状态", exact=True).evaluate("el => el.scrollWidth <= el.clientWidth")
                diagnosis.screenshot(path=str(output / "mobile.png"), full_page=True)
                with httpx.Client(base_url=API, cookies={SESSION_COOKIE_NAME: "bob"}) as bob:
                    assert bob.get(f"/api/diagnosis/workflows/{task}/events").status_code == 403
                    assert bob.get("/api/agent/history/reconnect").json()["code"] == 40101
                assert "event: supplement" in api.post("/api/agent/chat/stream", json={"threadId": "reconnect",
                    "message": "再次补充", "supplement": {"workflowId": task, "idempotencyKey": "expiry-wait"}}).text
                chat.evaluate("localStorage.setItem('agent_current_thread_id', 'reconnect')")
                chat.reload()
                expect(chat.get_by_role("region", name="待补充说明", exact=True)).to_be_visible()
                context.clear_cookies()
                expect(diagnosis.get_by_role("region", name="任务状态", exact=True)).to_have_count(0, timeout=15000)
                expect(chat.get_by_role("region", name="任务状态", exact=True)).to_have_count(0, timeout=15000)
                expect(chat.get_by_role("region", name="待补充说明", exact=True)).to_have_count(0, timeout=15000)
                proof = api.get("/__fixture/proof").json()
                assert proof == {**before, "formalRecords": 1, "chatCalls": 2}
                assert len([url for url in commands if url == approve_url]) == 1
                assert len([url for url in commands if url == API + "/api/agent/chat/stream"]) == 2
                assert not errors, errors
                checks.append("theme-mobile-ownership-and-expired-identity-with-no-extra-inference-or-writes")
                browser.close()
        finally:
            stop_owned(vite, "vite.js")
            stop_owned(backend, "web.tests.reconnect_ui_server")
    result = {"date": "2026-10-14", "checks": checks, "proof": proof, "pageErrors": errors,
              "scope": "Real Vue/Chromium/HTTP/SSE/Worker; SQLite and controlled Java/model/Chroma/embedding. Not real-service or clinical acceptance."}
    (output / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                                        encoding="utf-8", newline="\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
