"""Frozen P2-02A CUDA stability probe protocol.

The ``P202AProtocol`` dataclass pins the inputs of the P2-02A single-batch
staged probe + 6-cell matrix + 100-batch stability gate. It is the
*experiment* contract, NOT the eventual epoch-training protocol — that
contract is ``p1/protocol_e0_e3_v1.json`` and remains unchanged.

Deviating from any field below requires a new ``schema_version`` and a
user-approved protocol change.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, fields, asdict
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "p2-02a-v1"


class P202AProtocolError(ValueError):
    """Raised when a P2-02A protocol file is missing fields or has wrong values."""


@dataclass(frozen=True)
class P202AProtocol:
    """Frozen P2-02A probe protocol."""

    schema_version: str
    experiment: str
    backbone: str
    weights: str
    fold: int
    seed: int
    target_success_batches: int
    image_size: int
    num_classes: int


def default_p202a_protocol() -> P202AProtocol:
    """Return the canonical P2-02A protocol dataclass.

    The probe is intentionally restricted to E3 (bilateral shared encoder).
    Diagnosing the silent full-fold hang on E3 is the prerequisite for
    running any of E0/E1/E2/E3, so E0/E1/E2 are not in scope here.
    """
    return P202AProtocol(
        schema_version=SCHEMA_VERSION,
        experiment="E3",
        backbone="efficientnet_b4",
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        fold=0,
        seed=42,
        target_success_batches=100,
        image_size=380,
        num_classes=8,
    )


def dump_p202a_protocol(p: P202AProtocol, path: Path) -> None:
    """Serialize ``p`` to ``path`` as JSON with stable key ordering."""
    payload = asdict(p)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _validate(payload: dict[str, Any]) -> None:
    """Reject any field that disagrees with the frozen v1 contract."""
    expected = {f.name for f in fields(P202AProtocol)}
    missing = expected - set(payload)
    if missing:
        raise P202AProtocolError(f"missing required fields: {sorted(missing)}")
    extra = set(payload) - expected
    if extra:
        raise P202AProtocolError(f"unknown fields: {sorted(extra)}")

    if payload["schema_version"] != SCHEMA_VERSION:
        raise P202AProtocolError(
            f"schema_version must be {SCHEMA_VERSION!r}, got {payload['schema_version']!r}"
        )
    if payload["experiment"] != "E3":
        raise P202AProtocolError(
            f"experiment must be 'E3' for P2-02A, got {payload['experiment']!r}"
        )
    if payload["backbone"] != "efficientnet_b4":
        raise P202AProtocolError(
            f"backbone must be 'efficientnet_b4', got {payload['backbone']!r}"
        )
    if payload["weights"] != "EfficientNet_B4_Weights.IMAGENET1K_V1":
        raise P202AProtocolError(
            f"weights must be IMAGENET1K_V1, got {payload['weights']!r}"
        )
    if payload["fold"] != 0:
        raise P202AProtocolError(
            f"fold must be 0 for P2-02A, got {payload['fold']!r}"
        )
    if payload["seed"] != 42:
        raise P202AProtocolError(
            f"seed must be 42, got {payload['seed']!r}"
        )
    if payload["target_success_batches"] != 100:
        raise P202AProtocolError(
            f"target_success_batches must be 100, got {payload['target_success_batches']!r}"
        )
    if payload["image_size"] != 380:
        raise P202AProtocolError(
            f"image_size must be 380, got {payload['image_size']!r}"
        )
    if payload["num_classes"] != 8:
        raise P202AProtocolError(
            f"num_classes must be 8, got {payload['num_classes']!r}"
        )


def load_p202a_protocol(path: Path) -> P202AProtocol:
    """Load and validate ``path`` as a P2-02A protocol JSON file."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as e:
        raise P202AProtocolError(f"protocol file not found: {path}") from e
    except json.JSONDecodeError as e:
        raise P202AProtocolError(f"protocol JSON is malformed: {e}") from e
    if not isinstance(raw, dict):
        raise P202AProtocolError("protocol JSON must be an object")
    _validate(raw)
    return P202AProtocol(**raw)
