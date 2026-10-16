"""Original Vue refresh against the ticket05 real MySQL/Redis/TCP API."""

import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.parse import urlsplit

import httpx
from playwright.sync_api import expect, sync_playwright

from web.tests.test_human_wait_restart import stop_child


def verify_refresh(case, client, kind, workflow_id, wait, thread):
    if os.getenv("WAIT_RECOVERY_BROWSER") != "1":
        case.evidence["browser"] = "NOT_RUN"
        return
    root = Path(__file__).resolve().parents[3]
    frontend = case.env["WAIT_RECOVERY_FRONTEND"]
    api = str(client.base_url).rstrip("/")
    env = {**os.environ, "VITE_API_BASE_URL": api + "/api", "VITE_AGENT_BASE_URL": api}
    log = (case.directory / "vite.log").open("wb")
    child = subprocess.Popen([shutil.which("node"), str(root / "frontend/node_modules/vite/bin/vite.js"),
        "--host", "127.0.0.1", "--port", str(urlsplit(frontend).port), "--strictPort"],
        cwd=root / "frontend", env=env, stdout=log, stderr=log,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        deadline = time.monotonic() + 30
        while True:
            assert child.poll() is None, "Vite child exited; inspect vite.log"
            try:
                if httpx.get(frontend, timeout=1).status_code == 200:
                    break
            except httpx.TransportError:
                pass
            assert time.monotonic() < deadline, "Vite startup timed out"
            time.sleep(.1)
        errors, posts = [], []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(viewport={"width": 1360, "height": 1100})
                context.add_cookies([{"name": "EYE_SESSION", "value": client.cookies.get("EYE_SESSION"), "url": api}])
                context.add_init_script("localStorage.setItem('agent_current_thread_id', " + repr(thread) + ")")
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: posts.append(request.url) if request.method == "POST" else None)
                if kind in {"quality", "final"}:
                    route = "/doctor/reviews?task=" + wait["reviewTaskId"]
                    title = "图像质量复核" if kind == "quality" else "最终临床复核"
                else:
                    route = ("/agent" if kind == "supplement" else "/diagnosis") + "?workflow=" + workflow_id
                    title = "等待您确认保存" if kind == "save" else "处理完成"
                page.goto(frontend + route)
                page.wait_for_load_state("networkidle")
                expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()
                page.reload()
                page.wait_for_load_state("networkidle")
                expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()
                if kind == "supplement":
                    expect(page.get_by_text(wait["items"][0]["prompt"], exact=True).last).to_be_visible()
                output = Path(os.getenv("HUMAN_WAIT_EVIDENCE_DIR", str(case.directory)))
                screenshot = output / f"{case.directory.name}-{kind}-refresh.png"
                page.screenshot(path=str(screenshot), full_page=True)
                assert not any("/diagnosis/workflows" in url for url in posts), posts
                assert not errors, errors
                case.evidence["browser"] = {"status": "PASS", "kind": kind, "pageErrors": errors,
                    "workflowCreatePosts": 0, "screenshot": screenshot.name, "refreshes": 1}
            finally:
                browser.close()
    finally:
        stop_child(child)
        log.close()
