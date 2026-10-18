"""Real approved-reference retrieval and explanation; no workflow mutation."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from accept_python_migration import credentials, run_lock, snapshot
from acceptance_provider import Budget, relay
from acceptance_runtime import Owned, wait_http, re_schema
from acceptance_observe import observe
from web.config import WebConfig
from web.evidence import EvidenceRetriever
from web.workflow.explanation import ExplanationModel, make_draft, risk_assessment, validate_claims
from web.workflow.inference import InferenceEnvelope
from web.workflow.models import InferenceEnvelopeRow

run = Path(__file__).resolve().parents[1]
manifest = json.loads((run / "runtime/manifest.json").read_text(encoding="utf-8"))
assert re_schema(manifest["schema"])
target = make_url(os.environ["REAL_SERVICES_MYSQL_ADMIN_URL"])
assert target.drivername == "mysql+pymysql" and target.host == "127.0.0.1" and not target.database
config = credentials()
attempt = run / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-reference-explanations-" + uuid4().hex[:6])
attempt.mkdir()
snapshot(attempt)
budget = Budget(run / "provider-calls.sqlite3")
owned = Owned(attempt, [config[key] for key in ("DASHSCOPE_API_KEY", "COS_SECRET_ID", "COS_SECRET_KEY")] + [target.password])
engine = create_engine(target.set(database=manifest["schema"]))
sessions = sessionmaker(engine, expire_on_commit=False)
result = {"status": "FAIL", "checks": [], "scope": "Real MySQL/Chroma/embedding/ExplanationModel and claim validation; no graph resume, publication or human decisions"}
with run_lock(run):
    before = observe(run)
    try:
        env = {key: value for key, value in os.environ.items() if key.upper() in
               {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
        env.update(ANONYMIZED_TELEMETRY="False", PYTHONUTF8="1")
        chroma = owned.start("chroma-reference-check", [sys.executable, "-c", "from chromadb.cli.cli import app; app()", "run",
            "--host", "127.0.0.1", "--port", str(manifest["chromaPort"]), "--path", run / "runtime/chroma"], env)
        wait_http(chroma, f"http://127.0.0.1:{manifest['chromaPort']}/api/v2/heartbeat")
        with relay(budget, config["DASHSCOPE_BASE_URL"], config["DASHSCOPE_API_KEY"]) as base:
            settings = WebConfig(dashscope_api_key=config["DASHSCOPE_API_KEY"], dashscope_base_url=base,
                chat_model=config["CHAT_MODEL"], embedding_model=config["EMBEDDING_MODEL"],
                chroma_host="http://127.0.0.1", chroma_port=manifest["chromaPort"])
            retriever = EvidenceRetriever(sessions, settings)
            for sample, disease in (("1_left.jpg", "normal"), ("0_left.jpg", "cataract"), ("13_left.jpg", "myopia")):
                started = time.monotonic()
                batch = retriever.retrieve(disease)
                assert batch["status"] == "SUFFICIENT", disease
                with sessions() as db:
                    row = db.scalar(select(InferenceEnvelopeRow).where(
                        InferenceEnvelopeRow.workflow_id == manifest["workflows"][sample]))
                    envelope = InferenceEnvelope.model_validate(row)
                risk = risk_assessment(envelope, "AVAILABLE", evidence=batch)
                draft = make_draft(ExplanationModel(settings), envelope, batch, risk)
                checked = validate_claims(draft, retriever.validate(batch)) if draft["status"] == "DRAFT" else draft
                check = {"sample": sample, "disease": disease, "status": "PASS" if checked["status"] == "VALIDATED" else "FAIL",
                    "elapsedSeconds": round(time.monotonic() - started, 3), "explanationStatus": checked["status"],
                    "validation": checked.get("validation"), "citations": [{key: c[key] for key in
                        ("citationId", "documentId", "sourceRevision", "quotedTextDigest")} for c in batch["citations"]]}
                if "content" in draft:
                    try:
                        claims = json.loads(draft["content"]["draft"])["claims"]
                        check["claimDiagnostics"] = [{"citationIds": claim.get("citationIds"),
                            "textLength": len(claim.get("text", "")), "exactSourceExcerpt": any(
                                claim.get("text", "") in citation["quotedText"] for citation in batch["citations"])}
                            for claim in claims]
                    except (ValueError, KeyError, TypeError):
                        check["claimDiagnostics"] = "INVALID_STRUCTURE"
                result["checks"].append(check)
                print(json.dumps(check, ensure_ascii=False), flush=True)
        result["status"] = "PASS" if all(check["status"] == "PASS" for check in result["checks"]) else "FAIL"
    except Exception as exc:
        result["errorType"] = type(exc).__name__
    finally:
        engine.dispose()
        owned.close()
        result["cleanup"] = "PASS"
        after = observe(run)
        result["businessTablesUnchanged"] = before["sha256"] == after["sha256"]
        assert result["businessTablesUnchanged"]
        result["budget"] = budget.summary()
        (attempt / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"evidence": str(attempt), **result}, ensure_ascii=False))
raise SystemExit(0 if result["status"] == "PASS" else 1)
