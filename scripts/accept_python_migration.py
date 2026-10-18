"""Resumable Windows final acceptance; never approves a human decision.

Run with algorithm/.venv-model-acceptance/Scripts/python.exe. Evidence is
append-only by attempt, provider counters are shared by API and Worker and
survive process restarts. No credentials are copied to the run directory.
"""
import argparse
import asyncio
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
from urllib.parse import urlparse
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
MAIN = Path("D:/Work/code/eye-diagnosis")
sys.path.insert(0, str(ROOT / "algorithm"))

from acceptance_provider import Budget, relay

REQUIRED = ("DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "CHAT_MODEL", "EMBEDDING_MODEL",
            "COS_SECRET_ID", "COS_SECRET_KEY", "COS_REGION", "COS_BUCKET", "COS_HOST")
WEIGHT = MAIN / "algorithm/models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth"
EXPECTED_WEIGHT = "64b433f5187f7a7d6ea08c20fb159695dc0731df7b2b22fd10aa7bb853662531"
SAMPLES = MAIN / "algorithm/datasets/DataSet/Training_Dataset/Training_Dataset/Training_Dataset"
REFERENCES = MAIN / "src/main/resources/rag"


class Blocked(RuntimeError):
    pass


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def credentials():
    path = MAIN / ".env"
    values = {}
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise Blocked(f"Invalid or duplicate .env key at line {number}")
        if value != value.strip() or value.startswith(('\"', "'")):
            raise Blocked(f"Quoted or padded .env value at line {number}")
        values[key] = value
    missing = [key for key in REQUIRED if not values.get(key)]
    if missing:
        raise Blocked("Missing credential fields: " + ", ".join(missing))
    for key in ("DASHSCOPE_BASE_URL", "COS_HOST"):
        url = urlparse(values[key])
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise Blocked("Expected a credential-free HTTPS URL in " + key)
    if not values["DASHSCOPE_BASE_URL"].rstrip("/").endswith("/v1"):
        raise Blocked("Provider URL must include /v1")
    return {key: values[key] for key in REQUIRED}


@contextmanager
def run_lock(run):
    import msvcrt
    with (run / "run.lock").open("a+b") as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise Blocked("Another acceptance invocation owns this run") from None
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def check_ports():
    occupied = []
    for port in (8080, 5173):
        with socket.socket() as listener:
            try:
                listener.bind(("127.0.0.1", port))
            except OSError:
                command = (f"Get-NetTCPConnection -State Listen -LocalPort {port} | ForEach-Object {{ "
                           "Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess) } | "
                           "Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress")
                info = subprocess.check_output(["pwsh.exe", "-NoLogo", "-NoProfile", "-Command", command],
                                               text=True, encoding="utf-8")
                occupied.append({"port": port, "processes": json.loads(info)})
    if occupied:
        raise Blocked("Required port occupied: " + json.dumps(occupied, ensure_ascii=False))


def snapshot(attempt):
    result = subprocess.run(["git", "status", "--porcelain=v1"], cwd=ROOT, capture_output=True, check=True)
    (attempt / "worktree-status.txt").write_bytes(result.stdout)
    subprocess.run(["git", "diff", "--binary", "--output=" + str(attempt / "implementation.patch")],
                   cwd=ROOT, check=True, capture_output=True)
    paths: list[Path] = []
    for folder in ("algorithm/web", "algorithm/eye_diagnosis", "scripts", "frontend/src"):
        paths.extend(p for p in (ROOT / folder).rglob("*") if p.is_file() and p.suffix in
                     {".py", ".ts", ".vue", ".json", ".css"} and "__pycache__" not in p.parts)
    for relative in ("AGENTS.md", "CONTEXT.md", "pyproject.toml", ".python-version",
                     "algorithm/requirements-web.lock", "frontend/package-lock.json",
                     "algorithm/eye_disease_model.py", "algorithm/checkpoints/registry.json"):
        paths.append(ROOT / relative)
    paths.extend(p for p in (ROOT / "algorithm/configs").rglob("*")
                 if p.is_file() and p.suffix in {".json", ".yaml", ".yml"})
    write_json(attempt / "source-sha256.json", {str(p.relative_to(ROOT)).replace("\\", "/"): digest(p)
                                               for p in paths if p.is_file()})


def preflight(attempt, config):
    check_ports()
    if not WEIGHT.is_file() or digest(WEIGHT) != EXPECTED_WEIGHT:
        raise Blocked("Model weight absent or SHA256 mismatch")
    samples = []
    for name in ("1_left.jpg", "0_left.jpg", "2_left.jpg", "13_left.jpg", "30_left.jpg"):
        path = SAMPLES / name
        if not path.is_file():
            raise Blocked("Missing original sample " + name)
        samples.append({"name": name, "path": str(path), "sha256": digest(path),
                        "source": "training directory; not an independent test set"})
    references = [{"name": p.name, "path": str(p), "sha256": digest(p)}
                  for p in REFERENCES.glob("*.md")]
    snapshot(attempt)
    write_json(attempt / "materials.json", {"weight": {"path": str(WEIGHT), "sha256": EXPECTED_WEIGHT},
               "samples": samples, "references": references,
               "supplementarySamples": "BLOCKED_PENDING_DEIDENTIFICATION_CONFIRMATION",
               "doctorOperator": "BLOCKED_PENDING_ACTUAL_PARTICIPANT", "calibration": "NOT_CALIBRATED"})
    packages = {dist.metadata["Name"]: dist.version for dist in metadata.distributions()}
    write_json(attempt / "environment.json", {"python": sys.version, "executable": sys.executable,
               "declaredPython": (ROOT / ".python-version").read_text().strip(), "packages": packages,
               "privateConfiguration": {key: "PRESENT" for key in REQUIRED},
               "chatModel": config["CHAT_MODEL"], "embeddingModel": config["EMBEDDING_MODEL"]})
    return {"status": "PASS", "scope": "local materials, credential format, ports and source snapshot only"}


def providers(attempt, config, budget, only=None):
    import httpx
    from web.vectorstore import DashScopeEmbedder

    checks = {}
    with relay(budget, config["DASHSCOPE_BASE_URL"], config["DASHSCOPE_API_KEY"]) as base:
        if only == "structuredExplanation":
            checks["structuredExplanation"] = explanation_probe(config, base)
            write_json(attempt / "provider-checks.json", checks)
            return {"status": checks["structuredExplanation"]["status"], "checks": checks}
        try:
            async def embedding():
                async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                    return await DashScopeEmbedder(config["DASHSCOPE_API_KEY"], base,
                                                  config["EMBEDDING_MODEL"], client).embed(["验收连接预检"])
            vectors = asyncio.run(embedding())
            checks["embedding"] = {"status": "PASS", "dimensions": len(vectors[0]), "inputTexts": 1}
        except Exception as exc:
            checks["embedding"] = {"status": "BLOCKED", "errorType": type(exc).__name__}
        try:
            text_seen, done = False, False
            with httpx.Client(timeout=180, trust_env=False) as client:
                with client.stream("POST", base + "/chat/completions", headers={
                    "Authorization": "Bearer " + config["DASHSCOPE_API_KEY"]}, json={
                    "model": config["CHAT_MODEL"], "stream": True, "max_tokens": 64,
                    "messages": [{"role": "user", "content": "仅回复连接正常。"}]}) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if line == "data: [DONE]":
                            done = True
                        elif line.startswith("data: "):
                            item = json.loads(line[6:])
                            text_seen |= any(bool(c.get("delta", {}).get("content")) for c in item.get("choices", []))
            if not (done and text_seen):
                raise ValueError("Incomplete SSE")
            checks["streamingChat"] = {"status": "PASS", "contentSeen": True, "doneSeen": True}
        except Exception as exc:
            checks["streamingChat"] = {"status": "BLOCKED", "errorType": type(exc).__name__}
        checks["structuredExplanation"] = explanation_probe(config, base)
    write_json(attempt / "provider-checks.json", checks)
    return {"status": "PASS" if all(c["status"] == "PASS" for c in checks.values()) else "BLOCKED",
            "checks": checks, "scope": "real embedding, streaming chat and production structured explanation adapter"}


def explanation_probe(config, base):
    import httpx
    from web.config import WebConfig
    from web.workflow.explanation import ExplanationModel, Draft
    try:
        model = ExplanationModel(WebConfig(dashscope_api_key=config["DASHSCOPE_API_KEY"],
                dashscope_base_url=base, chat_model=config["CHAT_MODEL"]))
        source = (REFERENCES / "01-normal.md").read_text(encoding="utf-8")
        raw = model.generate({"citations": [{"citationId": "preflight-reference", "quotedText": source}]})
        draft = Draft.model_validate_json(raw)
        if not all(claim.text in source and claim.citationIds == ["preflight-reference"] for claim in draft.claims):
            raise ValueError("Extractive claim contract failed")
        return {"status": "PASS", "claims": len(draft.claims),
                "referenceSha256": digest(REFERENCES / "01-normal.md")}
    except Exception as exc:
        detail: dict[str, object] = {"status": "BLOCKED", "errorType": type(exc).__name__}
        if isinstance(exc, httpx.HTTPStatusError):
            detail["httpStatus"] = exc.response.status_code
        return detail


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--phase", choices=["preflight", "providers", "automated", "manual", "summary"], required=True)
    parser.add_argument("--provider-check", choices=["structuredExplanation"])
    parser.add_argument("--manual-seconds", type=int, default=0)
    args = parser.parse_args()
    if os.name != "nt" or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.run_id):
        raise SystemExit("Windows and a safe run ID are required")
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip()
    if branch != "worktree-py-rewrite":
        raise SystemExit("Expected worktree-py-rewrite")
    run = ROOT / ".scratch/python-final-acceptance" / args.run_id
    run.mkdir(parents=True, exist_ok=True)
    with (nullcontext() if args.phase == "summary" else run_lock(run)):
        budget = Budget(run / "provider-calls.sqlite3")
        attempt = run / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + args.phase + "-" + uuid4().hex[:6])
        attempt.mkdir()
        try:
            config = credentials()
            if args.phase == "preflight":
                result = preflight(attempt, config)
            elif args.phase == "providers":
                result = providers(attempt, config, budget, args.provider_check)
            elif args.phase in {"automated", "manual"}:
                from acceptance_runtime import execute
                result = execute(run, attempt, config, budget,
                                 manual_seconds=args.manual_seconds if args.phase == "manual" else 0)
            else:
                from acceptance_report import assemble
                result = assemble(run, attempt)
        except Blocked as exc:
            result = {"status": "BLOCKED", "reason": str(exc)}
        except Exception as exc:
            # Exceptions from vendors can contain URLs/credentials; report type only.
            result = {"status": "FAIL", "errorType": type(exc).__name__}
        result.update(phase=args.phase, runId=args.run_id, attempt=attempt.name, budget=budget.summary())
        write_json(attempt / "result.json", result)
        with (run / "attempts.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
