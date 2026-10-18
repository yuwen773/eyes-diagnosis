"""Owned real services and HTTP evidence for the final acceptance entry."""
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from acceptance_provider import relay

ROOT = Path(__file__).resolve().parents[1]


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def processes():
    command = ("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,"
               "ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress")
    result = subprocess.check_output(["pwsh.exe", "-NoLogo", "-NoProfile", "-Command", command],
                                     text=True, encoding="utf-8")
    return {int(row["ProcessId"]): row for row in json.loads(result)}


class Owned:
    def __init__(self, attempt, private_values):
        self.attempt, self.private_values = attempt, private_values
        self.children = []
        self.entries = []

    def start(self, role, command, env, cwd=ROOT / "algorithm"):
        log_path = self.attempt / (role + "-" + uuid4().hex[:6] + ".log")
        child = subprocess.Popen([str(c) for c in command], cwd=cwd, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        output = child.stdout
        assert output is not None

        def copy_log():
            with log_path.open("w", encoding="utf-8") as stream:
                for raw in iter(output.readline, b""):
                    line = raw.decode("utf-8", errors="replace")
                    for value in self.private_values:
                        if value:
                            line = line.replace(value, "[REDACTED]")
                    stream.write(line)
                    stream.flush()
            output.close()

        thread = threading.Thread(target=copy_log, daemon=True)
        thread.start()
        self.children.append((child, thread))
        entry = {"role": role, "pid": child.pid, "identity": None,
                 "command": [str(c) for c in command], "log": log_path.name, "cleanup": "PENDING"}
        self.entries.append(entry)
        save(self.attempt / "processes.json", self.entries)
        current = processes()
        entry["identity"] = current.get(child.pid)
        save(self.attempt / "processes.json", self.entries)
        if entry["identity"] is None or child.poll() is not None:
            raise RuntimeError(role + " exited before registration")
        return child

    def stop(self, child):
        entry = next(item for item in self.entries if item["pid"] == child.pid)
        if entry["cleanup"] == "PASS":
            return
        current = processes()
        original = entry["identity"]
        live = current.get(child.pid)
        if live is not None:
            if original is None or any(live[key] != original[key] for key in
                                      ("CreationDate", "ExecutablePath", "CommandLine", "Name")):
                entry["cleanup"] = "BLOCKED_IDENTITY_CHANGED"
                save(self.attempt / "processes.json", self.entries)
                raise RuntimeError("Owned process identity changed")
            descendants = {child.pid}
            while True:
                expanded = descendants | {pid for pid, row in current.items() if row["ParentProcessId"] in descendants}
                if expanded == descendants:
                    break
                descendants = expanded
            entry["descendantsAtStop"] = [current[pid] for pid in descendants if pid != child.pid]
            save(self.attempt / "processes.json", self.entries)
            subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"],
                           capture_output=True, timeout=20, check=True)
            child.wait(timeout=20)
            after = processes()
            if any(pid in after and after[pid]["CreationDate"] == current[pid]["CreationDate"] for pid in descendants):
                raise RuntimeError("Owned process cleanup incomplete")
        entry["cleanup"] = "PASS"
        save(self.attempt / "processes.json", self.entries)

    def close(self):
        errors = []
        for child, thread in reversed(self.children):
            try:
                self.stop(child)
                thread.join(timeout=5)
                if thread.is_alive():
                    raise RuntimeError("Log drain incomplete")
            except Exception as exc:
                errors.append(type(exc).__name__)
        if errors:
            raise RuntimeError("Cleanup failed: " + ", ".join(errors))


def wait_http(child, url, seconds=120):
    deadline = time.monotonic() + seconds
    with httpx.Client(timeout=2, trust_env=False) as client:
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Service exited before readiness")
            try:
                if client.get(url).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
    raise TimeoutError("Service readiness")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def envelope(response, code=0):
    payload = response.json()
    if response.status_code >= 400 or payload.get("code") != code:
        raise HTTPContractError(response.status_code, payload.get("code"), response.url.path)
    return payload.get("data")


class HTTPContractError(RuntimeError):
    def __init__(self, status, code, path):
        self.detail = {"httpStatus": status, "code": code, "path": path}
        super().__init__("HTTP contract failed")


def execute(run, attempt, config, budget, *, manual_seconds=0):
    from accept_python_migration import Blocked, WEIGHT, EXPECTED_WEIGHT, SAMPLES, REFERENCES, check_ports, snapshot
    check_ports()
    snapshot(attempt)
    raw = os.environ.get("REAL_SERVICES_MYSQL_ADMIN_URL", "")
    if not raw:
        raise Blocked("REAL_SERVICES_MYSQL_ADMIN_URL is required; local admin URL without database")
    target = make_url(raw)
    if target.drivername != "mysql+pymysql" or target.host not in {"127.0.0.1", "localhost"} or target.database:
        raise Blocked("Refusing nonlocal or database-scoped admin URL")
    redis = Path(os.environ.get("REAL_SERVICES_REDIS_SERVER", "D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe"))
    if not redis.is_file():
        raise Blocked("Local Redis executable is missing")
    runtime = run / "runtime"
    runtime.mkdir(exist_ok=True)
    manifest_path = runtime / "manifest.json"
    fresh = not manifest_path.exists()
    if fresh:
        manifest = {"schema": "eye_final_" + uuid4().hex, "redisPort": free_port(), "chromaPort": free_port(),
                    "accounts": {name: {"account": "accept_" + name, "id": str(9007199254740993 + index), "role": role}
                        for index, (name, role) in enumerate((("patient", "user"), ("other", "user"),
                                                            ("doctor", "doctor"), ("admin", "admin")))},
                    "createdUtc": datetime.now(timezone.utc).isoformat(), "initialized": False,
                    "workflows": {}, "documents": {}, "chatSessions": {}}
        # This is a disposable local fixture password, not a provider credential.
        manifest["fixturePassword"] = secrets.token_urlsafe(18)
        save(manifest_path, manifest)
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest["schema"].startswith("eye_final_") or not re_schema(manifest["schema"]):
        raise Blocked("Unregistered schema")
    report = {"status": "BLOCKED", "schema": manifest["schema"], "gates": {}, "checks": []}
    objects_path = runtime / "objects.json"
    objects = json.loads(objects_path.read_text(encoding="utf-8")) if objects_path.exists() else []
    secrets_to_redact = [config[k] for k in ("DASHSCOPE_API_KEY", "COS_SECRET_ID", "COS_SECRET_KEY")]
    secrets_to_redact.extend([target.password, raw])
    owned = Owned(attempt, secrets_to_redact)
    engine = None
    try:
        if fresh:
            admin = create_engine(target, connect_args={"connect_timeout": 5})
            try:
                with admin.begin() as db:
                    report["mysqlVersion"] = db.exec_driver_sql("SELECT VERSION()").scalar_one()
                    db.exec_driver_sql(f"CREATE DATABASE `{manifest['schema']}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            finally:
                admin.dispose()
        # Only allowlisted environment reaches application children.
        env = {key: value for key, value in os.environ.items() if key.upper() in
               {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
        env.update(config, PYTHONPATH=str(ROOT / "algorithm"), PYTHONUNBUFFERED="1", PYTHONUTF8="1", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
                   MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_USER=target.username or "",
                   MYSQL_PASSWORD=target.password or "", MYSQL_DATABASE=manifest["schema"],
                   MIGRATION_MYSQL_URL=target.set(database=manifest["schema"]).render_as_string(hide_password=False),
                   REDIS_HOST="127.0.0.1", REDIS_PORT=str(manifest["redisPort"]), REDIS_DB="8", REDIS_PASSWORD="",
                   CHROMA_HOST="127.0.0.1", CHROMA_PORT=str(manifest["chromaPort"]), CHROMA_COLLECTION="diagnosis-knowledge",
                   CHROMA_TENANT="default_tenant", CHROMA_DATABASE="default_database", ANONYMIZED_TELEMETRY="False",
                   WEB_HOST="127.0.0.1", WEB_PORT="8080", CORS_ALLOWED_ORIGINS="http://127.0.0.1:5173",
                   MODEL_WEIGHTS_PATH=str(WEIGHT), MODEL_WEIGHTS_SHA256=EXPECTED_WEIGHT,
                   MODEL_REGISTRY_PATH=str(ROOT / "algorithm/checkpoints/registry.json"),
                   MODEL_CALIBRATION_PATH=str(ROOT / "algorithm/configs/calibration/efficientnet_b4_temperature.json"),
                   MODEL_VERSION="efficientnet-b4@1.0.0", PREPROCESS_VERSION="v1",
                   INFERENCE_POLICY_VERSION="medical-safety-v3-quality-observe", QUALITY_GATE_MODE="observe",
                   SESSION_COOKIE_NAME="EYE_SESSION", SESSION_REDIS_PREFIX="eye:py:session:", SESSION_COOKIE_SECURE="false")
        engine = create_engine(target.set(database=manifest["schema"]))
        if not manifest["initialized"]:
            migration = subprocess.run([sys.executable, "-m", "web.migrations", "upgrade"], cwd=ROOT / "algorithm",
                                       env=env, capture_output=True, timeout=180)
            output = (migration.stdout + migration.stderr).decode("utf-8", errors="replace")
            for value in secrets_to_redact:
                if value:
                    output = output.replace(value, "[REDACTED]")
            (attempt / "migration.log").write_text(output, encoding="utf-8")
            if migration.returncode:
                raise Blocked("Explicit isolated migration failed; retained schema is not automatically repaired/replayed")
            from web.security import encode
            password_hash = encode(manifest["fixturePassword"])
            with engine.begin() as db:
                for account in manifest["accounts"].values():
                    db.execute(text("INSERT INTO t_user(id,userAccount,userPassword,userName,userRole) "
                                    "VALUES (:id,:account,:password,:name,:role)"),
                               {**account, "password": password_hash, "name": "Acceptance " + account["role"]})
            manifest["initialized"] = True
            save(manifest_path, manifest)
        with relay(budget, config["DASHSCOPE_BASE_URL"], config["DASHSCOPE_API_KEY"]) as base, ExitStack() as stack:
            env["DASHSCOPE_BASE_URL"] = base
            redis_dir = runtime / "redis"
            redis_dir.mkdir(exist_ok=True)
            owned.start("redis", [redis, "--bind", "127.0.0.1", "--port", manifest["redisPort"],
                                 "--dir", redis_dir, "--appendonly", "yes", "--save", ""], env)
            chroma = owned.start("chroma", [sys.executable, "-c", "from chromadb.cli.cli import app; app()", "run",
                                  "--host", "127.0.0.1", "--port", manifest["chromaPort"], "--path", runtime / "chroma"], env)
            wait_http(chroma, f"http://127.0.0.1:{manifest['chromaPort']}/api/v2/heartbeat")
            launcher = ROOT / "scripts/run_service.py"
            api_command, worker_command = [sys.executable, launcher, "api"], [sys.executable, launcher, "worker"]
            api = owned.start("api", api_command, env)
            wait_http(api, "http://127.0.0.1:8080/ready")
            worker = owned.start("worker", worker_command, env)
            clients = {name: stack.enter_context(httpx.Client(base_url="http://127.0.0.1:8080", timeout=180, trust_env=False))
                       for name in manifest["accounts"]}
            for name, client in clients.items():
                account = manifest["accounts"][name]
                login = envelope(client.post("/api/user/login", json={"userAccount": account["account"],
                                                                     "userPassword": manifest["fixturePassword"]}))
                assert login["id"] == account["id"] and "EYE_SESSION" in client.cookies
            report["gates"]["realInfrastructure"] = {"status": "PASS", "detail": "Original API/Worker entries; isolated MySQL, Redis, Chroma; Python login and large IDs"}
            patient, other, doctor = clients["patient"], clients["other"], clients["doctor"]
            old = dict(other.cookies)
            envelope(other.post("/api/user/logout"))
            other.cookies.update(old)
            envelope(other.get("/api/user/get/login"), 40100)
            other.cookies.clear()
            envelope(other.post("/api/user/login", json={"userAccount": manifest["accounts"]["other"]["account"],
                                                        "userPassword": manifest["fixturePassword"]}))
            report["checks"].append("real-redis-logout-cookie-replay-invalid")
            # Scope every independently resumable HTTP scenario to this run.
            real_http_checks(run, attempt, report, manifest, manifest_path, clients, engine, objects,
                             objects_path, SAMPLES, REFERENCES)
            # Restart the actual entries at durable waits; never submit a review decision.
            before = {name: envelope(patient.get("/api/diagnosis/workflows/" + wid))
                      for name, wid in manifest["workflows"].items()}
            with engine.connect() as db:
                inference_before = [dict(row) for row in db.execute(text(
                    "SELECT * FROM t_inference_envelope ORDER BY inferenceEnvelopeId")).mappings()]
            owned.stop(worker)
            owned.stop(api)
            api = owned.start("api-restart", api_command, env)
            wait_http(api, "http://127.0.0.1:8080/ready")
            worker = owned.start("worker-restart", worker_command, env)
            time.sleep(2)
            after = {name: envelope(patient.get("/api/diagnosis/workflows/" + wid))
                     for name, wid in manifest["workflows"].items()}
            with engine.connect() as db:
                inference_after = [dict(row) for row in db.execute(text(
                    "SELECT * FROM t_inference_envelope ORDER BY inferenceEnvelopeId")).mappings()]
            assert inference_before == inference_after
            assert all(int(after[name]["workflowVersion"]) >= int(view["workflowVersion"])
                       for name, view in before.items())
            save(attempt / "restart-waits.json", {"before": before, "after": after,
                 "identicalPublicViews": before == after, "identicalCommittedInference": True,
                 "inferenceSha256": hashlib.sha256(json.dumps(inference_before, sort_keys=True, default=str).encode()).hexdigest()})
            report["gates"]["realWaitRestart"] = {"status": "PASS", "tasks": len(before)}
            if manual_seconds:
                frontend_env = {key: value for key, value in os.environ.items() if key.upper() in
                                {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
                frontend_env.update(VITE_API_BASE_URL="http://127.0.0.1:8080/api", VITE_APP_API_BASE_URL="http://127.0.0.1:8080")
                vite = ROOT / "frontend/node_modules/vite/bin/vite.js"
                frontend = owned.start("frontend", [shutil.which("node"), vite, "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
                                       frontend_env, ROOT / "frontend")
                wait_http(frontend, "http://127.0.0.1:5173")
                print("Manual page http://127.0.0.1:5173 ; accounts in runtime/manifest.json. No automatic approval.", flush=True)
                deadline = time.monotonic() + manual_seconds
                finish_marker = runtime / "finish-manual-window"
                finish_marker.unlink(missing_ok=True)
                while time.monotonic() < deadline:
                    if finish_marker.exists():
                        break
                    time.sleep(min(5, max(0, deadline - time.monotonic())))
            # The observer's own sessions may expire during a long human window.
            # Reauthenticate through the original API; browser sessions and their
            # normal TTL remain independent.
            for name in ("patient", "doctor"):
                clients[name].cookies.clear()
                account = manifest["accounts"][name]
                login = envelope(clients[name].post("/api/user/login", json={
                    "userAccount": account["account"], "userPassword": manifest["fixturePassword"]}))
                assert login["id"] == account["id"]
            save(attempt / "review-tasks.json", envelope(doctor.get("/api/reviews/tasks")))
            save(attempt / "formal-records.json", envelope(patient.post("/api/diagnosis/list/page/my", json={})))
            report["gates"]["humanUI"] = {"status": "BLOCKED", "reason": "Actual patient/doctor UI actions and independent evidence are required"}
            report["gates"]["structuredExplanation"] = {"status": "BLOCKED", "reason": "Production adapter read timeout after JSON prompt repair; no additional retry"}
    except Exception as exc:
        report["errorType"] = type(exc).__name__
        import traceback
        report["errorLocation"] = [{"file": Path(frame.filename).name, "line": frame.lineno}
                                   for frame in traceback.extract_tb(exc.__traceback__)]
        if isinstance(exc, Blocked):
            report["reason"] = str(exc)
        if isinstance(exc, HTTPContractError):
            report["httpContract"] = exc.detail
        report["status"] = "BLOCKED" if isinstance(exc, (Blocked, httpx.HTTPError)) else "FAIL"
    finally:
        save(objects_path, objects)
        if engine is not None:
            engine.dispose()
        try:
            owned.close()
            report["cleanup"] = {"status": "PASS"}
        except Exception as exc:
            report["status"] = "FAIL"
            report["cleanup"] = {"status": "FAIL", "errorType": type(exc).__name__}
        save(attempt / "real-services.json", report)
    return report


def re_schema(value):
    import re
    return re.fullmatch(r"eye_final_[0-9a-f]{32}", value)


def real_http_checks(run, attempt, report, manifest, manifest_path, clients, engine, objects, objects_path, samples, references):
    from PIL import Image
    patient, other = clients["patient"], clients["other"]
    checkpoint = run / "scenario-checkpoints"
    checkpoint.mkdir(exist_ok=True)

    def done(name):
        path = checkpoint / (name + ".json")
        if not path.exists():
            return False
        previous = json.loads(path.read_text(encoding="utf-8"))
        # Early run checkpoints used `status` for the proven workflow wait.
        # They were written only after the HTTP/idempotency/SSE assertions.
        if previous["status"] != "PASS" and not (
                name.startswith("original_") and previous["status"] == "WAITING_HUMAN_REVIEW"):
            return False
        frozen = json.loads((run / previous["attempt"] / "source-sha256.json").read_text(encoding="utf-8"))
        for relative, expected in frozen.items():
            if (relative.startswith(("algorithm/web/", "algorithm/eye_diagnosis/")) and
                    "/tests/" not in relative and relative.endswith(".py")):
                if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != expected:
                    from accept_python_migration import Blocked
                    raise Blocked("Product implementation changed since " + name + "; affected evidence requires revalidation")
        return True

    def record(name, data):
        value = {"attempt": attempt.name, **data, "status": "PASS"}
        if "status" in data:
            value["workflowStatus"] = data["status"]
        save(checkpoint / (name + ".json"), value)
        report["checks"].append(name)

    if not done("cos-picture"):
        image = io.BytesIO()
        Image.new("RGB", (32, 24), "white").save(image, "PNG")
        response = envelope(patient.post("/api/agent/image/upload", files={"file": ("acceptance-probe.png", image.getvalue())}))
        url = response if isinstance(response, str) else response["url"]
        key = url.split("/", 3)[3]
        objects.append({"key": key, "url": url, "kind": "disposable-synthetic-probe", "createdBy": "public chat upload"})
        save(objects_path, objects)
        with httpx.Client(timeout=30, trust_env=False) as browser:
            fetch = browser.get(url)
            if fetch.status_code != 200:
                raise RuntimeError(f"COS unsigned browser read HTTP {fetch.status_code}")
            assert hashlib.sha256(fetch.content).digest() == hashlib.sha256(image.getvalue()).digest()
        record("cos-picture", {"url": url, "sha256": hashlib.sha256(image.getvalue()).hexdigest(),
                               "readType": "unsigned HTTP GET; actual browser rendering remains separate"})
    # Files and objects are retained; no production bucket enumeration/deletion.
    if not done("knowledge-upload-search"):
        from web.tests.test_document_upload import table_document
        paths = [ROOT / "algorithm/web/tests/fixtures/documents/simple.doc", *sorted(references.glob("*.md"))]
        uploads = [(path.name, path.read_bytes()) for path in paths]
        uploads.append(("acceptance-format-table.docx", table_document()))
        for name, content in uploads:
            if name in manifest["documents"]:
                continue
            ids = envelope(patient.post("/api/knowledge/upload", files={"files": (name, content)}))
            manifest["documents"][name] = ids[0]
            save(manifest_path, manifest)
        deadline = time.monotonic() + 90
        while True:
            rows = envelope(patient.post("/api/knowledge/list/page", json={"pageSize": 100}))["records"]
            if all(row["status"] != 0 for row in rows) or time.monotonic() >= deadline:
                break
            time.sleep(0.5)
        assert all(row["status"] == 1 for row in rows)
        for row in rows:
            if not any(obj["key"] == row["fileUrl"] for obj in objects):
                objects.append({"key": row["fileUrl"], "documentId": row["id"], "kind": "retained-reference-or-format-fixture"})
        save(objects_path, objects)
        assert envelope(other.post("/api/knowledge/list/page", json={}))["records"] == []
        result = envelope(patient.post("/api/knowledge/search", json={"query": "正常眼底 视神经乳头 黄斑"}))
        empty = envelope(other.post("/api/knowledge/search", json={"query": "正常眼底 视神经乳头 黄斑"}))
        save(attempt / "private-search.json", {"owner": result, "otherUser": empty})
        assert "视神经" in json.dumps(result, ensure_ascii=False)
        assert "正常眼底是指" not in json.dumps(empty, ensure_ascii=False)
        record("knowledge-upload-search", {"documents": manifest["documents"], "evidence": "private-search.json",
                                          "governance": "PRIVATE_USER/PENDING; no automated clinical approval"})
    # Original five samples stay local: production graph does not send raw images to providers.
    for name in ("1_left.jpg", "0_left.jpg", "2_left.jpg", "13_left.jpg", "30_left.jpg"):
        key = "original_" + name.replace(".", "_")
        path = samples / name
        data = path.read_bytes()
        if done(key):
            previous = json.loads((checkpoint / (key + ".json")).read_text(encoding="utf-8"))
            assert previous["workflowId"] == manifest["workflows"][name]
            assert previous["sourceSha256"] == hashlib.sha256(data).hexdigest()
            report["checks"].append(key + ": reused prior same-run proof; human progress retained")
            continue
        view = envelope(patient.post("/api/diagnosis/workflows", data={"idempotencyKey": key, "question": ""},
                                     files={"file": (name, data)}))
        wid = view["workflowId"]
        manifest["workflows"][name] = wid
        save(manifest_path, manifest)
        replay = envelope(patient.post("/api/diagnosis/workflows", data={"idempotencyKey": key, "question": ""},
                                       files={"file": (name, data)}))
        assert replay["workflowId"] == wid
        assert other.get("/api/diagnosis/workflows/" + wid).status_code == 403
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            view = envelope(patient.get("/api/diagnosis/workflows/" + wid))
            if view["status"] not in {"QUEUED", "RUNNING"}:
                break
            time.sleep(0.5)
        assert view["status"] == "WAITING_HUMAN_REVIEW", view["status"]
        assert view["result"] is None
        thread_id = manifest["chatSessions"].setdefault(name, uuid4().hex)
        save(manifest_path, manifest)
        stream = patient.post("/api/agent/chat/stream", json={"message": "查看原上传任务", "threadId": thread_id,
                              "diagnosis": {"workflowId": wid}})
        assert stream.status_code == 200 and wid in stream.text and "event: done" in stream.text
        (attempt / (key + "-chat.sse")).write_text(stream.text, encoding="utf-8")
        events = patient.get("/api/diagnosis/workflows/" + wid + "/events")
        assert events.status_code == 200 and wid in events.text
        (attempt / (key + "-workflow.sse")).write_text(events.text, encoding="utf-8")
        save(attempt / (key + ".json"), view)
        record(key, {"workflowId": wid, "sessionId": thread_id, "status": view["status"],
                     "sourceSha256": hashlib.sha256(data).hexdigest()})
    # Read-only provenance digest, no direct formal result writes.
    with engine.connect() as db:
        bundles = db.execute(text("SELECT * FROM t_inference_envelope")).mappings().all()
        rows = [dict(row) for row in bundles]
    save(attempt / "inference-envelopes.json", json.loads(json.dumps(rows, default=str)))
    save(attempt / "formal-records-before-window.json", envelope(patient.post("/api/diagnosis/list/page/my", json={})))
