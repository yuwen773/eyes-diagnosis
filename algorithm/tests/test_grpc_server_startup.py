import hashlib
import hmac
import os
import sys
import types
from pathlib import Path

import pytest


class _FakeModel:
    def __init__(self, *args, **kwargs):
        pass


def _import_grpc_server(monkeypatch):
    """Import grpc_server module with heavy ML dependencies stubbed out."""
    fake_module = types.ModuleType("eye_disease_model")
    fake_module.EyeDiseaseModel = _FakeModel
    fake_module.disease_categories = {}
    monkeypatch.setitem(sys.modules, "eye_disease_model", fake_module)

    repo_root = Path(__file__).resolve().parents[2]
    algorithm_dir = repo_root / "algorithm"
    if str(algorithm_dir) not in sys.path:
        sys.path.insert(0, str(algorithm_dir))

    if "grpc_server" in sys.modules:
        del sys.modules["grpc_server"]
    return __import__("grpc_server")


def test_missing_model_weights_aborts_startup(monkeypatch, tmp_path):
    monkeypatch.delenv("MODEL_WEIGHTS_PATH", raising=False)
    monkeypatch.delenv("MODEL_WEIGHTS_SHA256", raising=False)

    grpc_server = _import_grpc_server(monkeypatch)

    with pytest.raises(RuntimeError, match="MODEL_WEIGHTS_PATH"):
        grpc_server.DiagnosisServicer()


def test_model_hash_mismatch_aborts_startup(monkeypatch, tmp_path):
    weights = tmp_path / "model.pth"
    weights.write_bytes(b"invalid")
    monkeypatch.setenv("MODEL_WEIGHTS_PATH", str(weights))
    monkeypatch.setenv("MODEL_WEIGHTS_SHA256", "0" * 64)

    grpc_server = _import_grpc_server(monkeypatch)

    with pytest.raises(RuntimeError, match="SHA-256"):
        grpc_server.DiagnosisServicer()
