"""Original API/Redis/Worker: bounded plain chat and read-only existing Vue views."""
import json
import os
from pathlib import Path
import shutil
import sys
import time
from uuid import uuid4

import httpx
from playwright.sync_api import expect, sync_playwright
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from accept_python_migration import credentials, run_lock, check_ports, WEIGHT, EXPECTED_WEIGHT, digest
from acceptance_provider import Budget, relay
from acceptance_runtime import Owned, wait_http, envelope, re_schema, save
from acceptance_observe import observe

OUT = Path(__file__).resolve().parent / "doctor-readonly-refresh"
RUN = OUT.parent.parent


def main():
    OUT.mkdir(exist_ok=False)
    check_ports()
    manifest = json.loads((RUN / "runtime/manifest.json").read_text(encoding="utf-8"))
    assert re_schema(manifest["schema"]) and digest(WEIGHT) == EXPECTED_WEIGHT
    target = make_url(os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"])
    assert target.host in {"127.0.0.1", "localhost"} and not target.database
    config = credentials()
    budget = Budget(RUN / "provider-calls.sqlite3")
    owned = Owned(OUT, [*config.values(), target.password, manifest["fixturePassword"]])
    engine = create_engine(target.set(database=manifest["schema"]))
    before = observe(RUN)
    save(OUT / "business-before.json", before)
    result = {"status": "FAIL", "scope": "Real ordinary chat plus read-only original Vue; no human acceptance",
              "checks": {}, "budgetBefore": budget.summary()}
    env = {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
    env.update(config, PYTHONPATH=str(ROOT / "algorithm"), PYTHONUTF8="1", PYTHONUNBUFFERED="1",
        NO_PROXY="127.0.0.1,localhost", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
        MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_USER=target.username,
        MYSQL_PASSWORD=target.password or "", MYSQL_DATABASE=manifest["schema"],
        REDIS_HOST="127.0.0.1", REDIS_PORT=str(manifest["redisPort"]), REDIS_DB="8", REDIS_PASSWORD="",
        WEB_HOST="127.0.0.1", WEB_PORT="8080", CORS_ALLOWED_ORIGINS="http://127.0.0.1:5173",
        MODEL_WEIGHTS_PATH=str(WEIGHT), MODEL_WEIGHTS_SHA256=EXPECTED_WEIGHT,
        MODEL_REGISTRY_PATH=str(ROOT / "algorithm/checkpoints/registry.json"),
        MODEL_CALIBRATION_PATH=str(ROOT / "algorithm/configs/calibration/efficientnet_b4_temperature.json"),
        SESSION_COOKIE_NAME="EYE_SESSION", SESSION_COOKIE_SECURE="false")
    python = ROOT / "algorithm/.venv-model-acceptance/Scripts/python.exe"
    api_command = [python, ROOT / "scripts/run_service.py", "api"]
    threads = {name: "audit-" + uuid4().hex for name in ("context", "separate")}
    save(OUT / "probe-manifest.json", {"chatThreads": threads, "maxLLMRequests": 0,
        "source": "New synthetic nonmedical messages only; original diagnostic tasks read-only"})
    with run_lock(RUN):
        try:
            with engine.connect() as db:
                unfinished = db.execute(text("SELECT status, COUNT(*) FROM t_workflow_job GROUP BY status")).all()
            # Existing human waits must not have ready/running segments before starting an idle Worker.
            assert all(status in {"COMPLETED", "FAILED", "CANCELLED"} for status, _ in unfinished), str(unfinished)
            with relay(budget, config["DASHSCOPE_BASE_URL"], config["DASHSCOPE_API_KEY"]) as base:
                env["DASHSCOPE_BASE_URL"] = base
                owned.start("redis", ["D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe", "--bind", "127.0.0.1",
                    "--port", manifest["redisPort"], "--dir", RUN / "runtime/redis", "--appendonly", "yes", "--save", ""], env)
                api = owned.start("api", api_command, env)
                wait_http(api, "http://127.0.0.1:8080/ready")
                owned.start("idle-worker", [python, ROOT / "scripts/run_service.py", "worker"], env)
                time.sleep(2)
                with httpx.Client(base_url="http://127.0.0.1:8080", trust_env=False, timeout=150) as patient, \
                     httpx.Client(base_url="http://127.0.0.1:8080", trust_env=False, timeout=30) as doctor:
                    for name, client in (("patient", patient), ("doctor", doctor)):
                        account = manifest["accounts"][name]
                        logged = envelope(client.post("/api/user/login", json={"userAccount": account["account"],
                            "userPassword": manifest["fixturePassword"]}))
                        assert logged["id"] == account["id"]
                    frontend_env = {k: v for k, v in env.items() if k.upper() in {
                        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
                    frontend_env.update(VITE_API_BASE_URL="http://127.0.0.1:8080/api", VITE_APP_API_BASE_URL="http://127.0.0.1:8080")
                    vite = owned.start("readonly-frontend", [shutil.which("node"), ROOT / "frontend/node_modules/vite/bin/vite.js",
                        "--host", "127.0.0.1", "--port", "5173", "--strictPort"], frontend_env, ROOT / "frontend")
                    wait_http(vite, "http://127.0.0.1:5173")
                    with sync_playwright() as playwright:
                        browser = playwright.chromium.launch(headless=True)
                        try:
                            for name, client in (("doctor", doctor),):
                                context = browser.new_context(viewport={"width": 1360, "height": 1100})
                                context.add_cookies([{"name": "EYE_SESSION", "value": client.cookies.get("EYE_SESSION"),
                                    "url": "http://127.0.0.1:8080"}])
                                blocked, errors = [], []

                                def guard(route):
                                    request = route.request
                                    path = httpx.URL(request.url).path
                                    allowed = request.method in {"GET", "HEAD", "OPTIONS"} or (
                                        request.method == "POST" and path in {"/api/diagnosis/list/page/my", "/api/news/list/page/vo"})
                                    if not allowed:
                                        blocked.append({"method": request.method, "path": path})
                                        route.abort()
                                    else:
                                        route.continue_()

                                context.route("**/api/**", guard)
                                page = context.new_page()
                                page.on("pageerror", lambda error: errors.append(str(error)))
                                if name == "patient":
                                    thread = manifest["chatSessions"]["1_left.jpg"]
                                    context.add_init_script("localStorage.setItem('agent_current_thread_id', " + json.dumps(thread) + ")")
                                    url = "http://127.0.0.1:5173/agent"
                                    marker = manifest["workflows"]["1_left.jpg"]
                                else:
                                    pending = envelope(doctor.get("/api/reviews/tasks"))[0]
                                    marker = pending["workflowId"]
                                    url = "http://127.0.0.1:5173/doctor/reviews?task=" + pending["reviewTaskId"]
                                page.goto(url, wait_until="networkidle")
                                save(OUT / (name + "-before-assert.json"), {"url": page.url, "body": page.locator("body").inner_text(), "blocked": blocked, "errors": errors})
                                page.screenshot(path=str(OUT / (name + "-before-assert.png")), full_page=True)
                                expect(page.get_by_text(marker, exact=False).last).to_be_visible(timeout=20000)
                                expect(page.locator('button[data-task-id="' + pending["reviewTaskId"] + '"]')).to_have_attribute("aria-pressed", "true")
                                page.reload(wait_until="networkidle")
                                expect(page.get_by_text(marker, exact=False).last).to_be_visible(timeout=20000)
                                page.screenshot(path=str(OUT / (name + "-readonly-refresh.png")), full_page=True)
                                assert not blocked and not errors
                                result["checks"][name + "ReadonlyRefresh"] = "PASS"
                                context.close()
                        finally:
                            browser.close()
            result["status"] = "PASS"
        except Exception as exc:
            result["errorType"] = type(exc).__name__
            import traceback
            result["errorLocation"] = [{"file": Path(f.filename).name, "line": f.lineno} for f in traceback.extract_tb(exc.__traceback__)]
        finally:
            owned.close()
            engine.dispose()
            after = observe(RUN)
            save(OUT / "business-after.json", after)
            result["businessTablesUnchanged"] = before["sha256"] == after["sha256"]
            assert result["businessTablesUnchanged"]
            result["cleanup"] = "PASS"
            result["budgetAfter"] = budget.summary()
            save(OUT / "result.json", result)
    print(json.dumps(result), flush=True)
    raise SystemExit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
