"""Historical workflow issue 02 acceptance, using Python sessions after session ticket 02.

Start Redis, Nginx and Vite as documented first. This runner owns only its
Web/Worker/browser processes; it restarts them and leaves the test DB intact.
Images are synthetic engineering inputs, never model or clinical evidence.
"""

import argparse
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from PIL import Image


def envelope(response, status=200):
    actual = getattr(response, "status_code", None) or response.status
    assert actual == status, f"Expected HTTP {status}, received {actual}"
    body = response.json()
    assert body["code"] == 0, body
    return body["data"]


def local_url(value: str) -> str:
    if urlparse(value).hostname not in {"localhost", "127.0.0.1"}:
        raise argparse.ArgumentTypeError("Only local acceptance services are supported")
    return value.rstrip("/")


@contextmanager
def web_process(output: Path):
    # Fail if the port belongs to someone else; never stop an existing service.
    import socket
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8080)) == 0:
            raise RuntimeError("Port 8080 must be free for the verifier's own Web process")
    with (output / "web.log").open("ab") as log:
        process = subprocess.Popen([sys.executable, "-m", "uvicorn", "web.app:app",
                                    "--host", "127.0.0.1", "--port", "8080"],
                                   stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Web startup failed; inspect the local web.log")
                try:
                    if httpx.get("http://127.0.0.1:8080/health", timeout=1).status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(.2)
            else:
                raise RuntimeError("Web startup timed out")
            yield process.pid
        finally:
            if os.name == "nt":
                # uv's Windows venv launcher can own another Python process.
                # Stop only this verifier's process tree, before its root exits.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)


def worker_segment(output: Path) -> None:
    with (output / "worker.log").open("ab") as log:
        result = subprocess.run([sys.executable, "-m", "web.workflow.worker", "--once"],
                                stdout=log, stderr=log, timeout=60)
    assert result.returncode == 0, "Worker failed; inspect the local worker.log"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login-file", type=Path, required=True)
    parser.add_argument("--other-login-file", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--api-url", type=local_url, default="http://localhost:8081/api")
    parser.add_argument("--frontend-url", type=local_url, default="http://localhost:5173")
    args = parser.parse_args()
    if not os.environ.get("MYSQL_DATABASE", "").startswith("eye_workflow_"):
        parser.error("Set MYSQL_DATABASE to an isolated eye_workflow_* acceptance database")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    credentials = json.loads(args.login_file.read_text("utf-8"))
    other_credentials = json.loads(args.other_login_file.read_text("utf-8"))
    picture = io.BytesIO()
    Image.new("RGB", (64, 64), "red").save(picture, format="PNG")
    data = picture.getvalue()
    results: dict = {"evidenceType": "real_mysql_python_session_http_ui_synthetic_input_no_model",
                     "checks": [], "snapshots": []}
    checks = results["checks"]
    with httpx.Client(base_url=args.api_url + "/", timeout=20) as client, \
            httpx.Client(base_url=args.api_url + "/", timeout=20) as other:
        with web_process(args.output_dir):
            envelope(client.post("user/login", json=credentials))
            envelope(other.post("user/login", json=other_credentials))
            assert "EYE_SESSION" in client.cookies and "EYE_SESSION" in other.cookies
            before = envelope(client.post("diagnosis/list/page/my", json={}))["total"]
            key = uuid4().hex
            files = {"file": ("synthetic.png", data, "image/png")}
            created = envelope(client.post("diagnosis/workflows", data={"idempotencyKey": key}, files=files), 202)
            workflow_id = created["workflowId"]
            path = f"diagnosis/workflows/{workflow_id}"
            assert created["status"] == "QUEUED"
            duplicate = envelope(client.post("diagnosis/workflows", data={"idempotencyKey": key}, files=files), 202)
            assert duplicate["workflowId"] == workflow_id
            assert other.get(path).status_code == 403
            assert client.post("diagnosis/workflows", data={"idempotencyKey": key},
                               files={"file": ("other.png", b"other", "image/png")}).status_code == 409
            checks.extend(["http_202", "owner_scoped_idempotency", "cross_user_forbidden", "key_payload_conflict"])
            results["snapshots"].append(created)
        # New Web process observes the previously queued task.
        with web_process(args.output_dir):
            assert envelope(client.get(path))["status"] == "QUEUED"
            checks.append("queued_task_survives_web_restart")
            with ThreadPoolExecutor(max_workers=1) as pool:
                execution = pool.submit(worker_segment, args.output_dir)
                # Interleave HTTP idempotent reads with a real Worker commit.
                # Status/version and progress must come from one committed state.
                while not execution.done():
                    snapshot = envelope(client.post("diagnosis/workflows", data={"idempotencyKey": key}, files=files), 202)
                    assert snapshot["workflowId"] == workflow_id
                    if snapshot["workflowVersion"] == "0":
                        assert snapshot["status"] == "QUEUED" and snapshot["progress"]["completed"] == []
                    elif snapshot["workflowVersion"] == "1":
                        assert snapshot["status"] == "RUNNING" and snapshot["progress"]["completed"] == []
                    else:
                        assert snapshot["status"] == "RUNNING" and snapshot["progress"]["completed"] == ["validateImage"]
                    time.sleep(.02)
                execution.result()
            checks.append("idempotent_response_consistent_during_worker_commit")
            running = envelope(client.get(path))
            assert running["status"] == "RUNNING"
            assert running["progress"]["completed"] == ["validateImage"]
            results["snapshots"].append(running)
        with web_process(args.output_dir):
            assert envelope(client.get(path))["workflowVersion"] == running["workflowVersion"]
            worker_segment(args.output_dir)
            final = envelope(client.get(path))
            assert (final["status"], final["stopReasonCode"]) == ("FAILED", "MODEL_UNAVAILABLE")
            assert final["progress"]["completed"] == ["validateImage", "inference"]
            assert final["result"] is None
            assert envelope(client.post("diagnosis/list/page/my", json={}))["total"] == before
            checks.extend(["graph_segment_survives_web_and_worker_rebuild", "explicit_unavailable_no_formal_record"])
            results["snapshots"].append(final)
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page(viewport={"width": 1280, "height": 960})
                    page.goto(args.frontend_url + "/user/login")
                    page.wait_for_load_state("networkidle")
                    page.get_by_placeholder("请输入账号", exact=True).fill(credentials["userAccount"])
                    page.get_by_placeholder("请输入密码", exact=True).fill(credentials["userPassword"])
                    page.locator("button.login-button").click()
                    page.wait_for_url(lambda url: "/user/login" not in str(url))
                    page.goto(args.frontend_url + "/diagnosis")
                    page.wait_for_load_state("networkidle")
                    page.locator("input[type=file]").set_input_files({"name": "synthetic.png", "mimeType": "image/png", "buffer": data})
                    with page.expect_response(lambda response: response.url.endswith("/api/diagnosis/workflows") and
                                               response.request.method == "POST") as accepted:
                        page.get_by_role("button", name="创建分析任务").click()
                    ui_created = envelope(accepted.value, 202)
                    results["uiWorkflowId"] = ui_created["workflowId"]
                    page.get_by_text(ui_created["workflowId"], exact=True).wait_for()
                    page.screenshot(path=str(args.output_dir / "queued.png"), full_page=True)
                    worker_segment(args.output_dir)
                    worker_segment(args.output_dir)
                    page.get_by_text("模型当前不可用，未生成诊断结果。请联系管理员检查模型权重与配置。", exact=True).wait_for(timeout=15000)
                    page.reload(wait_until="networkidle")
                    page.get_by_text(ui_created["workflowId"], exact=True).wait_for()
                    page.get_by_text("模型当前不可用，未生成诊断结果。请联系管理员检查模型权重与配置。", exact=True).wait_for()
                    page.screenshot(path=str(args.output_dir / "restored.png"), full_page=True)
                    checks.extend(["real_upload_page_creates_server_task", "page_refresh_restores_original_task"])
                finally:
                    browser.close()
        # Rebuild both Web and browser, restoring the upload page's own task.
        with web_process(args.output_dir):
            assert envelope(client.get(f"diagnosis/workflows/{ui_created['workflowId']}"))["status"] == "FAILED"
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    context = browser.new_context(viewport={"width": 1280, "height": 960})
                    context.add_cookies([{"name": cookie.name, "value": cookie.value,
                                          "url": args.frontend_url} for cookie in client.cookies.jar
                                        if cookie.value is not None])
                    page = context.new_page()
                    page.goto(args.frontend_url + "/diagnosis?workflow=" + ui_created["workflowId"])
                    page.wait_for_load_state("networkidle")
                    page.get_by_text(ui_created["workflowId"], exact=True).wait_for()
                    page.get_by_text("模型当前不可用，未生成诊断结果。请联系管理员检查模型权重与配置。", exact=True).wait_for()
                    page.screenshot(path=str(args.output_dir / "restored.png"), full_page=True)
                    checks.append("upload_page_task_survives_web_and_browser_rebuild")
                finally:
                    browser.close()
        envelope(client.post("user/logout"))
        envelope(other.post("user/logout"))
    (args.output_dir / "results.json").write_bytes(json.dumps(results, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
    print(json.dumps({"checks": checks, "output": str(args.output_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
