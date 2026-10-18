"""Interrupt original API/Worker at a persisted RUNNING segment; real local model."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from acceptance_runtime import Owned, wait_http, free_port, envelope, save
from acceptance_observe import observe
from accept_python_migration import check_ports, run_lock, WEIGHT, EXPECTED_WEIGHT, SAMPLES
from acceptance_provider import Budget
from web.tests.handoff_fixtures import isolated_database
from web.security import encode

OUT = Path(__file__).resolve().parent / "real-inflight-restart"
RUN = OUT.parent.parent


def main():
    OUT.mkdir(exist_ok=False)
    check_ports()
    before = observe(RUN)
    save(OUT / "business-before.json", before)
    admin_url = os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"]
    target = make_url(admin_url)
    assert target.host in {"127.0.0.1", "localhost"} and not target.database
    url, schema = isolated_database(admin_url)
    port = free_port()
    password = secrets.token_urlsafe(24)
    owned = Owned(OUT, [admin_url, target.password, password])
    python = ROOT / "algorithm/.venv-model-acceptance/Scripts/python.exe"
    env = {k: v for k, v in os.environ.items() if k.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
    env.update(PYTHONPATH=str(ROOT / "algorithm"), PYTHONUTF8="1", PYTHONUNBUFFERED="1",
        NO_PROXY="127.0.0.1,localhost", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
        MYSQL_HOST=target.host, MYSQL_PORT=str(target.port or 3306), MYSQL_USER=target.username,
        MYSQL_PASSWORD=target.password, MYSQL_DATABASE=schema, MIGRATION_MYSQL_URL=url,
        REDIS_HOST="127.0.0.1", REDIS_PORT=str(port), REDIS_DB="8", REDIS_PASSWORD="",
        WEB_HOST="127.0.0.1", WEB_PORT="8080", MODEL_WEIGHTS_PATH=str(WEIGHT), MODEL_WEIGHTS_SHA256=EXPECTED_WEIGHT,
        MODEL_REGISTRY_PATH=str(ROOT / "algorithm/checkpoints/registry.json"),
        MODEL_CALIBRATION_PATH=str(ROOT / "algorithm/configs/calibration/efficientnet_b4_temperature.json"),
        SESSION_COOKIE_NAME="EYE_SESSION", SESSION_COOKIE_SECURE="false")
    engine = create_engine(url)
    result = {"status": "FAIL", "schema": schema, "checks": {},
        "scope": "Original entries and graph, real PyTorch classifier, fresh MySQL/Redis; no external providers or human decisions"}
    save(OUT / "probe-manifest.json", {"schema": schema, "redisPort": port, "image": "1_left.jpg",
        "sourceSha256": hashlib.sha256((SAMPLES / "1_left.jpg").read_bytes()).hexdigest(), "retained": True})
    with run_lock(RUN):
        try:
            migration = subprocess.run([sys.executable, "-m", "web.migrations", "upgrade"],
                cwd=ROOT / "algorithm", env=env, capture_output=True, timeout=120)
            assert migration.returncode == 0
            with engine.begin() as db:
                db.execute(text("INSERT INTO t_user(id,userAccount,userPassword,userName,userRole) VALUES "
                    "(9007199254740993,'inflight-audit',:password,'Synthetic restart patient','user')"),
                    {"password": encode(password)})
            redis_dir = OUT / "redis"
            redis_dir.mkdir()
            owned.start("redis", ["D:/Work/Backend/Redis-x64-3.2.100/redis-server.exe", "--bind", "127.0.0.1",
                "--port", port, "--dir", redis_dir, "--appendonly", "no", "--save", ""], env)
            api_command = [python, ROOT / "scripts/run_service.py", "api"]
            worker_command = [python, ROOT / "scripts/run_service.py", "worker"]
            api = owned.start("api", api_command, env)
            wait_http(api, "http://127.0.0.1:8080/ready")
            with httpx.Client(base_url="http://127.0.0.1:8080", trust_env=False, timeout=30) as client:
                envelope(client.post("/api/user/login", json={"userAccount": "inflight-audit", "userPassword": password}))
                source = (SAMPLES / "1_left.jpg").read_bytes()

                def upload():
                    return envelope(client.post("/api/diagnosis/workflows", data={"idempotencyKey": "inflight-restart-original-1"},
                        files={"file": ("1_left.jpg", source, "image/jpeg")}))

                task = upload()
                wid = task["workflowId"]
                result["workflowId"] = wid
                worker = owned.start("worker", worker_command, env)
                deadline = time.monotonic() + 60
                while True:
                    with engine.connect() as db:
                        running = db.execute(text("SELECT jobId,status,leaseVersion,leaseUntil,segmentCode "
                            "FROM t_workflow_job WHERE workflowId=:wid AND status='RUNNING'"), {"wid": wid}).mappings().first()
                    if running:
                        break
                    assert time.monotonic() < deadline, "Did not observe an actual RUNNING segment"
                    time.sleep(.01)
                save(OUT / "observed-running.json", json.loads(json.dumps(dict(running), default=str)))
                owned.stop(worker)
                interrupted = envelope(client.get("/api/diagnosis/workflows/" + wid))
                assert interrupted["status"] == "RUNNING"
                owned.stop(api)
                api = owned.start("api-restart", api_command, env)
                wait_http(api, "http://127.0.0.1:8080/ready")
                restored = envelope(client.get("/api/diagnosis/workflows/" + wid))
                assert restored == interrupted
                result["checks"]["apiRestartDuringExecution"] = "PASS"
                owned.start("worker-restart", worker_command, env)
                deadline = time.monotonic() + 150
                while True:
                    view = envelope(client.get("/api/diagnosis/workflows/" + wid))
                    if view["status"] == "WAITING_HUMAN_REVIEW":
                        break
                    assert view["status"] not in {"FAILED", "COMPLETED", "COMPLETED_LIMITED"}, view["status"]
                    assert time.monotonic() < deadline, "Recovery did not reach the real quality wait"
                    time.sleep(.2)
                assert upload()["workflowId"] == wid
                with client.stream("GET", "/api/diagnosis/workflows/" + wid + "/events") as stream:
                    assert stream.status_code == 200
                    next(stream.iter_lines())
                connected = client.get("/api/diagnosis/workflows/" + wid + "/events")
                assert connected.status_code == 200 and wid in connected.text and "event: done" in connected.text
                (OUT / "reconnected.sse").write_text(connected.text, encoding="utf-8")
                with engine.connect() as db:
                    envelopes = [dict(row) for row in db.execute(text("SELECT * FROM t_inference_envelope "
                        "WHERE workflowId=:wid"), {"wid": wid}).mappings()]
                    reviews = db.execute(text("SELECT COUNT(*) FROM t_human_review_task WHERE workflowId=:wid"), {"wid": wid}).scalar_one()
                    records = db.execute(text("SELECT COUNT(*) FROM t_saved_workflow_diagnosis")).scalar_one()
                assert len(envelopes) == 1 and envelopes[0]["modelWeightFingerprint"] == EXPECTED_WEIGHT
                assert reviews == 1 and records == 0
                save(OUT / "final-workflow.json", view)
                save(OUT / "inference-envelope.json", json.loads(json.dumps(envelopes[0], default=str)))
                result["checks"].update(workerRestartDuringExecution="PASS", oneCommittedInferenceEnvelope="PASS",
                    sameKeySameTask="PASS", realSSEReconnect="PASS", noFormalRecord="PASS")
                result["physicalModelCallCount"] = "Not asserted; an uncommitted interrupted segment may recompute"
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
            assert before["sha256"] == after["sha256"]
            result.update(businessTablesUnchanged=True, cleanup="PASS", budget=Budget(RUN / "provider-calls.sqlite3").summary())
            save(OUT / "result.json", result)
    print(json.dumps(result), flush=True)
    raise SystemExit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
