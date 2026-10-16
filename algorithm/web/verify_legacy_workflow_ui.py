"""Original Vue + TCP legacy API + Worker; SQLite/identity are controlled.

Only owns its newly spawned child processes and temporary fixture directory.
No model/provider, real-desktop or clinical acceptance is claimed.
"""

import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_workflow import picture_bytes
from web.verify_real_services import free_port, stop_child, wait_http

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"status": "RUNNING", "checks": [], "pageErrors": [],
              "scope": "original Vue/TCP/Worker; synthetic identity/model-unavailable; SQLite"}
    with tempfile.TemporaryDirectory(prefix="eye-legacy-ui-") as directory, ExitStack() as stack:
        api_port, ui_port = free_port(), 15175
        api, ui = f"http://127.0.0.1:{api_port}", f"http://127.0.0.1:{ui_port}"
        # This fixture's CORS is fixed to the established local browser seam.
        import socket
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", ui_port)) == 0:
                raise RuntimeError("Fixture UI port already in use; no existing process will be stopped")
        env = dict(os.environ, CHAT_UI_DIRECTORY=directory, VITE_API_BASE_URL=api + "/api",
                   VITE_AGENT_BASE_URL=api)

        def start(name, command, cwd, url):
            log = stack.enter_context((args.output_dir / f"{name}.log").open("w", encoding="utf-8"))
            child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            stack.callback(stop_child, child)
            wait_http(child, url)

        start("api", [sys.executable, "-m", "uvicorn", "web.tests.legacy_ui_server:app",
                      "--host", "127.0.0.1", "--port", str(api_port)], ROOT / "algorithm", api + "/health")
        frontend = ROOT / "frontend"
        start("frontend", [shutil.which("node"), str(frontend / "node_modules/vite/bin/vite.js"),
                           "--host", "127.0.0.1", "--port", str(ui_port), "--strictPort"], frontend, ui)
        with sync_playwright() as playwright, httpx.Client(base_url=api, cookies={"EYE_SESSION": "alice"}) as client:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(viewport={"width": 1360, "height": 1000})
                context.add_cookies([{"name": "EYE_SESSION", "value": "alice", "url": api}])
                page = context.new_page()
                page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
                commands = []
                page.on("request", lambda request: commands.append(request.url)
                        if "/legacy-tasks/" in request.url and request.method == "POST" else None)
                page.goto(ui + "/diagnosis/legacy?source=workflow&task=java-wait")
                page.wait_for_load_state("networkidle")
                expect(page.get_by_role("heading", name="旧版任务（只读）")).to_be_visible()
                expect(page.get_by_role("article")).to_contain_text("java-release")
                expect(page.get_by_role("article")).to_contain_text("旧批准不会转移")
                page.reload(wait_until="networkidle")
                page.get_by_role("button", name="刷新旧任务").click()
                expect(page.get_by_label("旧任务详情")).to_be_visible()
                assert commands == []
                original = client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"]
                page.screenshot(path=str(args.output_dir / "legacy-readonly.png"), full_page=True)
                report["checks"].append("list-detail-refresh-read-only-no-command")
                submit = page.get_by_role("button", name="确认关联重建")
                expect(submit).to_be_disabled()
                page.get_by_label("重新上传眼底图片").set_input_files({
                    "name": "new.png", "mimeType": "image/png", "buffer": picture_bytes()})
                expect(submit).to_be_disabled()
                page.get_by_role("checkbox").check()
                submit.click()
                link = page.locator('[data-test="new-workflow"]')
                expect(link).to_be_visible()
                assert len(commands) == 1
                task = link.get_attribute("href").split("workflow=")[1]
                report["checks"].append("fresh-image-and-checkbox-required-one-create")
                link.click()
                expect(page.get_by_label("任务状态")).to_contain_text("等待处理")
                expect(page.get_by_label("任务状态")).to_contain_text("java-wait")
                assert client.post("/fixture/run-worker").status_code == 200
                expect(page.get_by_label("任务状态")).to_contain_text("模型当前不可用", timeout=10000)
                page.reload(wait_until="networkidle")
                expect(page.get_by_label("任务状态")).to_contain_text(task)
                assert len(commands) == 1
                assert client.get("/api/diagnosis/legacy-tasks/workflow/java-wait").json()["data"] == original
                assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"
                page.screenshot(path=str(args.output_dir / "rebuilt-workflow.png"), full_page=True)
                report["checks"].append("worker-progress-refresh-no-duplicate-no-formal-save-original-unchanged")
                page.goto(ui + "/diagnosis/legacy?source=workflow&task=java-wait", wait_until="networkidle")
                expect(page.locator('[data-test="new-workflow"]')).to_have_attribute("href", "/diagnosis?workflow=" + task)
                page.locator('[data-test="new-rebuild"]').click()
                expect(page.get_by_role("button", name="确认关联重建")).to_be_disabled()
                expect(page.get_by_role("checkbox")).not_to_be_checked()
                assert len(commands) == 1
                report["checks"].append("acknowledged-link-restored-explicit-new-operation-requires-new-image-and-confirmation")
                page.goto(ui + "/diagnosis/legacy?source=upload&task=java-upload", wait_until="networkidle")
                expect(page.get_by_label("旧任务详情")).to_contain_text("旧版上传任务")
                report["checks"].append("v3-upload-task-details")
                context.clear_cookies()
                context.add_cookies([{"name": "EYE_SESSION", "value": "bob", "url": api}])
                page.reload(wait_until="networkidle")
                expect(page.get_by_role("alert")).to_contain_text("任务归属")
                expect(page.get_by_label("旧任务详情")).to_have_count(0)
                report["checks"].append("cross-owner-details-cleared")
                assert not report["pageErrors"], report["pageErrors"]
                report["status"] = "PASS"
            finally:
                browser.close()
    (args.output_dir / "ui-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
