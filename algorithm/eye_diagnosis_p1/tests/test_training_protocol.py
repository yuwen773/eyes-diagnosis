"""Unit tests for the E0E3Protocol dataclass + JSON round-trip."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from p1.training.protocol import (
    E0E3Protocol,
    ProtocolError,
    default_protocol,
    dump_protocol,
    load_protocol,
)


def test_default_protocol_matches_frozen_values() -> None:
    p = default_protocol()
    assert p.schema_version == "p2-01-e0-e3-v1"
    assert p.backbone == "efficientnet_b4"
    assert p.image_size == 380
    assert p.num_classes == 8
    assert p.patient_batch == 8
    assert p.gradient_accumulation == 1
    assert p.amp is True
    assert p.seed == 42
    assert p.e2_seed == 42
    assert p.optimizer == "adamw"
    assert p.learning_rate == 1e-4
    assert p.weight_decay == 1e-4
    assert p.max_epochs == 20
    assert p.smoke_epochs == 2
    assert p.early_stopping_patience == 3
    assert p.lr_scheduler is None
    assert p.warmup_steps == 0
    assert p.gradient_clip_norm == 0.0
    assert p.augmentations == ()
    assert p.checkpoint_selector == "oof_macro_auprc"
    assert p.primary_metric == "oof_macro_auprc"
    assert p.threshold_policy == "fixed_0.5"
    assert p.num_workers == 2
    assert p.pin_memory is True
    assert p.persistent_workers is True
    assert p.preflight_free_vram_mb == 6800


def test_protocol_is_frozen_dataclass() -> None:
    p = default_protocol()
    with pytest.raises((AttributeError, Exception)):
        p.patient_batch = 6  # type: ignore[misc]


def test_round_trip_via_dump_and_load(tmp_path: Path) -> None:
    p = default_protocol()
    out = tmp_path / "protocol.json"
    dump_protocol(p, out)
    loaded = load_protocol(out)
    assert loaded == p


def test_load_rejects_missing_required_field(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"backbone": "efficientnet_b4"}))  # missing many fields
    with pytest.raises(ProtocolError) as ei:
        load_protocol(bad)
    assert "missing" in str(ei.value).lower() or "required" in str(ei.value).lower()


def _protocol_to_jsonable(p: E0E3Protocol) -> dict:
    return {k: (list(v) if isinstance(v, tuple) else v) for k, v in asdict(p).items()}


def test_load_rejects_wrong_backbone(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = _protocol_to_jsonable(p)
    payload["backbone"] = "efficientnet_b3"
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)


def test_load_rejects_wrong_patient_batch(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = _protocol_to_jsonable(p)
    payload["patient_batch"] = 6
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)


def test_load_rejects_wrong_accumulation(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = _protocol_to_jsonable(p)
    payload["gradient_accumulation"] = 2
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)


def test_load_rejects_wrong_schema_version(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = _protocol_to_jsonable(p)
    payload["schema_version"] = "p2-01-e0-e3-v0"
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)