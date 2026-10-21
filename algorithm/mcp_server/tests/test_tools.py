from unittest.mock import Mock

import pytest

from mcp_server import tools
from mcp_server.config import MCPConfig


@pytest.fixture
def model_factory(monkeypatch):
    factory = Mock()
    monkeypatch.setattr(tools, "EyeDiseaseModel", factory)
    monkeypatch.setattr(tools, "_model", None)
    monkeypatch.setattr(tools, "_DEFAULT_MODEL_PATHS", [])
    return factory


def test_missing_weights_abort_before_model_creation(model_factory):
    with pytest.raises(RuntimeError, match="weights"):
        tools.load_model(MCPConfig(device="cpu"))
    model_factory.assert_not_called()


def test_explicit_missing_weights_do_not_fall_back(model_factory, monkeypatch, tmp_path):
    fallback = tmp_path / "fallback.pth"
    fallback.write_bytes(b"weights")
    monkeypatch.setattr(tools, "_DEFAULT_MODEL_PATHS", [str(fallback)])
    with pytest.raises(RuntimeError, match="weights"):
        tools.load_model(MCPConfig(model_path=str(tmp_path / "missing.pth"), device="cpu"))
    model_factory.assert_not_called()


@pytest.mark.parametrize("kind", ["empty", "directory"])
def test_invalid_weights_abort_before_model_creation(model_factory, tmp_path, kind):
    weights = tmp_path / "weights.pth"
    if kind == "empty":
        weights.touch()
    else:
        weights.mkdir()
    with pytest.raises(RuntimeError, match="weights"):
        tools.load_model(MCPConfig(model_path=str(weights), device="cpu"))
    model_factory.assert_not_called()


@pytest.mark.asyncio
async def test_failed_weight_load_does_not_publish_model(model_factory, tmp_path):
    weights = tmp_path / "corrupt.pth"
    weights.write_bytes(b"corrupt")
    model_factory.return_value.load_model.side_effect = RuntimeError("corrupt weights")
    with pytest.raises(RuntimeError, match="corrupt weights"):
        tools.load_model(MCPConfig(model_path=str(weights), device="cpu"))
    with pytest.raises(RuntimeError, match="Model not loaded"):
        await tools.diagnose("unused.png")


def test_valid_weights_load_without_downloading_pretrained_model(model_factory, tmp_path):
    weights = tmp_path / "model.pth"
    weights.write_bytes(b"weights")
    tools.load_model(MCPConfig(model_path=str(weights), device="cpu"))
    model_factory.assert_called_once_with(
        num_classes=8, model_name="efficientnet_b4", pretrained=False,
    )
    model_factory.return_value.load_model.assert_called_once_with(str(weights))
