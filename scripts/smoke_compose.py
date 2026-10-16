"""Isolated stock Compose demo; retains owned databases, volumes and private logs."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from web.models.news import News
from web.models.user import User
from web.security import encode
from web.verify_real_services import envelope, free_port

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = "eye-compose06-" + uuid4().hex[:12]
    runtime = ROOT / ".scratch/baseline-runtime" / name
    runtime.mkdir(parents=True)
    report: dict[str, Any] = {"status": "FAIL", "project": name, "checks": [], "providers": "NOT_VERIFIED", "clinical": "NOT_VERIFIED"}
    owned = []
    compose = []
    password = "Ticket06-isolated-demo!"

    with (runtime / "docker.log").open("ab") as log:
        def run(command, *, env=None, capture=False):
            result = subprocess.run(command, cwd=ROOT, env=env, check=True, capture_output=capture,
                                    stdout=None if capture else log, stderr=None if capture else log)
            return result.stdout.decode().strip() if capture else ""

        try:
            for image in ("eye-python-cpu:ticket06", "eye-frontend:ticket06"):
                run(["docker", "image", "inspect", image])
            run(["docker", "network", "create", name])
            for role, image, command, volume in (
                ("mysql", "mysql:8.0.26", ["-e", "MYSQL_ROOT_PASSWORD=" + password, "-p", "127.0.0.1::3306"], "/var/lib/mysql"),
                ("redis", "redis:7-alpine", [], "/data"),
                ("chroma", "ghcr.io/chroma-core/chroma:1.0.0", [], "/data"),
            ):
                container = name + "-" + role
                run(["docker", "run", "-d", "--name", container, "--network", name, "--network-alias", role,
                     "-v", container + ":" + volume, *command, image])
                owned.append(container)
            mapping = json.loads(run(["docker", "inspect", owned[0]], capture=True))[0]
            port = mapping["NetworkSettings"]["Ports"]["3306/tcp"][0]["HostPort"]
            schema = "eye_compose_issue06_" + uuid4().hex
            url = f"mysql+pymysql://root:{password}@127.0.0.1:{port}/{schema}"
            admin = create_engine(url.rsplit("/", 1)[0], connect_args={"connect_timeout": 2})
            try:
                deadline = time.monotonic() + 180
                while True:
                    try:
                        with admin.begin() as db:
                            report["mysqlVersion"] = db.exec_driver_sql("SELECT VERSION()").scalar_one()
                            db.exec_driver_sql(f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
                        break
                    except Exception:
                        if time.monotonic() > deadline:
                            raise
                        time.sleep(1)
            finally:
                admin.dispose()
            run([sys.executable, "-m", "web.migrations", "upgrade"], env={**os.environ, "MIGRATION_MYSQL_URL": url})
            engine = create_engine(url)
            owner = 9007199254740993
            now = datetime(2026, 1, 2, 10)
            try:
                with Session(engine) as session:
                    session.add(User(id=owner, user_account="compose_alice", user_password=encode(password),
                                     user_name="Compose 验收", user_role="user", edit_time=now, create_time=now, update_time=now))
                    session.add(News(id=9007199254741000, user_id=owner, title="保留的演示新闻", content="Synthetic retained content",
                                     summary="Synthetic retained summary", cover_img="https://example.invalid/cover.png",
                                     status=1, publish_time=now, edit_time=now))
                    session.commit()
            finally:
                engine.dispose()
            settings = dict(line.split("=", 1) for line in (ROOT / "deploy/python/.env.example").read_text().splitlines()
                            if line and not line.startswith("#"))
            settings.update(MYSQL_HOST="mysql", MYSQL_PORT="3306", MYSQL_DATABASE=schema, MYSQL_USER="root", MYSQL_PASSWORD=password,
                            REDIS_HOST="redis", REDIS_PORT="6379", REDIS_DB="8", CHROMA_HOST="chroma", CHROMA_PORT="8000")
            environment_file = runtime / "runtime.env"
            environment_file.write_text("\n".join(f"{k}={v}" for k, v in settings.items()) + "\n", encoding="utf-8")
            override = runtime / "compose.yml"
            override.write_text("networks:\n  default:\n    external: true\n    name: " + name + "\n", encoding="utf-8")
            model_dir = runtime / "models"
            model_dir.mkdir()
            front_port = free_port()
            env = {**os.environ, "EYE_ENV_FILE": str(environment_file), "EYE_HTTP_PORT": str(front_port), "EYE_MODEL_DIR": str(model_dir)}
            compose = ["docker", "compose", "-p", name, "-f", str(ROOT / "deploy/python/compose.yml"), "-f", str(override)]
            run([*compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "180"], env=env)
            (runtime / "before-restart.json").write_text(run([*compose, "ps", "--format", "json"], env=env, capture=True))
            address = f"http://127.0.0.1:{front_port}"
            with httpx.Client(base_url=address, timeout=15, trust_env=False) as client:
                envelope(client.get("/api/user/get/login"), code=40100)
                envelope(client.post("/api/user/login", json={"userAccount": "compose_alice", "userPassword": password}))
                assert envelope(client.get("/api/user/get/login"))["id"] == str(owner)
                news = envelope(client.get("/api/news/get/9007199254741000"))
                assert news["title"] == "保留的演示新闻"
                task = envelope(client.post("/api/diagnosis/workflows", data={"idempotencyKey": "stock-worker"},
                    files={"file": ("invalid.png", b"invalid-image", "image/png")}), status=202)["workflowId"]
                deadline = time.monotonic() + 60
                while True:
                    view = envelope(client.get("/api/diagnosis/workflows/" + task))
                    if view["status"] == "REJECTED":
                        break
                    assert time.monotonic() < deadline, "Stock Worker did not consume the durable task"
                    time.sleep(.2)
                assert view["stopReasonCode"] == "INVALID_IMAGE"
                api_container = name + "-api-1"
                old_address = json.loads(run(["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}",
                                              api_container], capture=True))[name]["IPAddress"]
                run([*compose, "stop", "api", "worker"], env=env)
                # Force Docker's legitimate address-reuse case during restart.
                # The proxy must rediscover API rather than cache its old IP.
                reservation = name + "-ip-reservation"
                run(["docker", "run", "-d", "--no-healthcheck", "--name", reservation, "--network", name, "--ip", old_address,
                     "eye-python-cpu:ticket06", "python", "-c", "import time; time.sleep(300)"])
                owned.append(reservation)
                run([*compose, "start", "api", "worker"], env=env)
                new_address = json.loads(run(["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}",
                                              api_container], capture=True))[name]["IPAddress"]
                assert new_address != old_address
                report["apiAddressChanged"] = True
                (runtime / "after-restart.json").write_text(run([*compose, "ps", "--format", "json"], env=env, capture=True))
                deadline = time.monotonic() + 120
                while True:
                    try:
                        after = envelope(client.get("/api/diagnosis/workflows/" + task))
                        break
                    except (httpx.HTTPError, AssertionError, ValueError):
                        assert time.monotonic() < deadline
                        time.sleep(.5)
                assert after == view
                assert envelope(client.get("/api/news/get/9007199254741000")) == news
            run([*compose, "exec", "-T", "api", "python", "-c",
                 "import shutil; assert not shutil.which('java') and not shutil.which('mvn')"], env=env)
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page(viewport={"width": 1360, "height": 1000})
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(address + "/user/login")
                    page.wait_for_load_state("networkidle")
                    page.get_by_placeholder("请输入账号", exact=True).fill("compose_alice")
                    page.get_by_placeholder("请输入密码", exact=True).fill(password)
                    page.locator(".login-button").click()
                    page.wait_for_function("!location.pathname.includes('/user/login')")
                    page.wait_for_load_state("networkidle")
                    page.screenshot(path=str(output / "compose-login.png"), full_page=True)
                    assert not errors
                finally:
                    browser.close()
            report.update(status="PASS", schema=schema, workflowId=task, frontend=address,
                          checks=["stock-compose-healthy", "python-migration", "original-password-login-large-id", "retained-data-read",
                                  "stock-worker-durable-task", "api-worker-restart-preserves-data-and-session",
                                  "proxy-rediscovers-api-address", "no-jvm", "nginx-vue-browser-login"])
        except Exception as error:
            report["reason"] = type(error).__name__ + "; inspect private runtime logs"
            raise
        finally:
            if compose:
                try:
                    run([*compose, "logs", "--no-color"], env=env)
                except subprocess.CalledProcessError:
                    pass
                try:
                    run([*compose, "down"], env=env)
                except subprocess.CalledProcessError:
                    pass
            for container in reversed(owned):
                try:
                    run(["docker", "stop", container])
                except subprocess.CalledProcessError:
                    pass
            (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
