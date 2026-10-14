"""Public MCP tool seam: one reliability pipeline, no patient prediction release."""

import base64
import json

import pytest

from web.config import WebConfig
from web.inference import InferenceUnavailable
from web.tests.test_workflow import picture_bytes
from web.tests.test_workflow_inference import ControlledEngine, prediction
from web.workflow.inference import WorkflowInference


@pytest.fixture(autouse=True)
def isolated_pipeline(monkeypatch):
    from mcp_server import tools
    monkeypatch.setattr(tools, "_pipeline", None)


def test_mcp_image_tool_uses_workflow_provenance_without_releasing_prediction():
    import asyncio
    from mcp_server import tools
    from mcp_server.server import mcp

    image = picture_bytes()
    engine = ControlledEngine(prediction())
    tools._pipeline = WorkflowInference(WebConfig(), engine=engine)
    result = asyncio.run(mcp.call_tool("eye_disease_diagnosis", {"image_input": base64.b64encode(image).decode()}))
    text = result[0][0].text if isinstance(result, tuple) else result[0].text
    data = json.loads(text)
    assert data["outcome"] == "VALID_PREDICTION"
    assert data["qualityOutcome"] == "PASS"
    assert data["modelFingerprint"] == "a" * 64
    assert data["modelVersion"] == "efficientnet-b4@1.0.0"
    assert data["patientVisible"] is False and data["publication"] == "UNPUBLISHED"
    assert "glaucoma" not in text and "91.0" not in text and "top_predictions" not in text
    assert engine.calls == 1


def test_mcp_image_tool_missing_weights_fails_without_a_fallback(tmp_path):
    import asyncio
    from mcp_server import tools
    from mcp_server.config import MCPConfig

    tools.load_model(MCPConfig(model_path=str(tmp_path / "missing.pth"), device="cpu"))
    with pytest.raises(RuntimeError, match="MODEL_UNAVAILABLE"):
        asyncio.run(tools.diagnose(base64.b64encode(picture_bytes()).decode()))


def test_mcp_conflicting_weight_environment_is_rejected(monkeypatch):
    from mcp_server.config import MCPConfig
    monkeypatch.setenv("MODEL_WEIGHTS_PATH", "shared.pth")
    monkeypatch.setenv("MODEL_PATH", "different.pth")
    with pytest.raises(ValueError, match="MODEL_PATH_CONFLICT"):
        MCPConfig.from_env()


@pytest.mark.parametrize("result,expected", [(prediction(is_ood=True), "SAFETY_ABSTENTION"),
    (prediction(rejected=True, abstain_reason="QUALITY_FAIL", quality_reasons="blur"), "SAFETY_ABSTENTION"),
    (prediction(quality_reasons="blur"), "VALID_PREDICTION")])
def test_mcp_quality_and_abstention_come_from_the_same_inference_envelope(result, expected):
    import asyncio
    from mcp_server import tools

    tools._pipeline = WorkflowInference(WebConfig(), engine=ControlledEngine(result))
    data = json.loads(asyncio.run(tools.diagnose(base64.b64encode(picture_bytes()).decode())))
    assert data["outcome"] == expected
    assert data["patientVisible"] is False
    assert data["qualityOutcome"] == ("REJECT" if result.rejected else "REVIEW" if result.quality_reasons else "PASS")


@pytest.mark.parametrize("result,code", [(InferenceUnavailable(), "MODEL_UNAVAILABLE"),
    (prediction(weight_sha256="b" * 64), "MODEL_FINGERPRINT_MISMATCH"),
    (RuntimeError("private device info"), "INFERENCE_FAILED")])
def test_mcp_technical_failure_never_becomes_a_safety_abstention(result, code):
    import asyncio
    from mcp_server import tools

    tools._pipeline = WorkflowInference(WebConfig(model_weights_sha256="a" * 64), engine=ControlledEngine(result))
    with pytest.raises(RuntimeError, match=code):
        asyncio.run(tools.diagnose(base64.b64encode(picture_bytes()).decode()))
