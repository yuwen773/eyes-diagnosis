"""Measure the unchanged production request through the real shared-budget relay.

This diagnostic uses a longer transport timeout to measure the provider; it is
not evidence that the unchanged production adapter meets its time bound.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from accept_python_migration import credentials, REFERENCES
from acceptance_provider import Budget, relay
from web.config import WebConfig
from web.workflow.explanation import ExplanationModel, Draft

run = Path(__file__).resolve().parents[1]
config = credentials()
budget = Budget(run / "provider-calls.sqlite3")
source = (REFERENCES / "01-normal.md").read_text(encoding="utf-8")
captured = []


class Captured(Exception):
    pass


def capture(request):
    captured.append(request.content)
    raise Captured()


real_client = httpx.Client
httpx.Client = lambda **kwargs: real_client(transport=httpx.MockTransport(capture), **kwargs)
try:
    model = ExplanationModel(WebConfig(dashscope_api_key="capture-only", chat_model=config["CHAT_MODEL"]))
    try:
        model.generate({"citations": [{"citationId": "preflight-reference", "quotedText": source}]})
    except Captured:
        pass
finally:
    httpx.Client = real_client

result = {"diagnosticOnly": True, "requestSource": "Unmodified ExplanationModel.generate request bytes",
          "transportReadTimeoutSeconds": 120, "chunks": []}
with relay(budget, config["DASHSCOPE_BASE_URL"], config["DASHSCOPE_API_KEY"]) as base:
    started = time.monotonic()
    try:
        with httpx.Client(timeout=httpx.Timeout(120, connect=10), trust_env=False) as client:
            with client.stream("POST", base + "/chat/completions", content=captured[0], headers={
                "Authorization": "Bearer " + config["DASHSCOPE_API_KEY"], "Content-Type": "application/json"}) as response:
                result.update(httpStatus=response.status_code, headersSeconds=round(time.monotonic() - started, 3))
                response.raise_for_status()
                raw = bytearray()
                for chunk in response.iter_bytes():
                    result["chunks"].append({"bytes": len(chunk), "seconds": round(time.monotonic() - started, 3)})
                    raw.extend(chunk)
                    assert len(raw) <= 65536
        payload = json.loads(raw)
        result.update(requestId=payload.get("id"), usage=payload.get("usage"),
                      finishReason=payload["choices"][0]["finish_reason"])
        draft = Draft.model_validate_json(payload["choices"][0]["message"]["content"])
        result.update(claims=len(draft.claims), exactSourceExcerpts=all(
            claim.text in source and claim.citationIds == ["preflight-reference"] for claim in draft.claims))
    except Exception as exc:
        result["errorType"] = type(exc).__name__
    result["totalSeconds"] = round(time.monotonic() - started, 3)
result["budget"] = budget.summary()
output = Path(__file__).resolve().parent / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-provider-timing.json")
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
