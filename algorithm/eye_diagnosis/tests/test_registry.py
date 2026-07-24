import json
from pathlib import Path

import pytest

from eye_diagnosis.registry import ModelRegistry, ModelProvenance


def test_registry_refuses_missing_weights(tmp_path: Path):
    fake = tmp_path / "missing.pth"
    with pytest.raises(RuntimeError):
        ModelRegistry(weights_path=fake, registry_path=tmp_path / "registry.json").resolve_current()


def test_registry_hashes_weights(tmp_path: Path):
    weights = tmp_path / "b4.pth"
    weights.write_bytes(b"abc")
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps({"allow_sha256": ["ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"]}))
    reg = ModelRegistry(weights_path=weights, registry_path=registry_path)
    provenance = reg.resolve_current()
    assert isinstance(provenance, ModelProvenance)
    assert provenance.weight_sha256.startswith("ba7816")  # sha256('abc')