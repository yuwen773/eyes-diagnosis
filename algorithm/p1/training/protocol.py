"""Frozen training protocol for the P2-01 E0–E3 baselines.

The protocol pins every value the training entry point can change
(batch size, accumulation, backbone, augmentations, scheduler, etc.).
``load_protocol`` rejects any JSON whose value disagrees with the
frozen field map, so silent overrides are impossible.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any


class ProtocolError(ValueError):
    """Raised when a protocol file is missing fields or violates frozen values."""


@dataclass(frozen=True)
class E0E3Protocol:
    schema_version: str
    backbone: str
    weights: str
    image_size: int
    num_classes: int
    patient_batch: int
    gradient_accumulation: int
    amp: bool
    seed: int
    e2_seed: int
    optimizer: str
    learning_rate: float
    weight_decay: float
    max_epochs: int
    smoke_epochs: int
    early_stopping_patience: int
    lr_scheduler: str | None
    warmup_steps: int
    gradient_clip_norm: float
    augmentations: tuple[str, ...]
    checkpoint_selector: str
    experiment_primary_metric: str
    threshold_policy: str
    num_workers: int
    pin_memory: bool
    persistent_workers: bool
    preflight_free_vram_mb: int


# Every field that the training entry point must NOT be allowed to change.
# ``load_protocol`` enforces these against any incoming JSON.
FROZEN_FIELDS: dict[str, Any] = {
    "schema_version": "p2-01r-e0-e3-v1",
    "backbone": "efficientnet_b4",
    "weights": "EfficientNet_B4_Weights.IMAGENET1K_V1",
    "image_size": 380,
    "num_classes": 8,
    "patient_batch": 8,
    "gradient_accumulation": 1,
    "amp": True,
    "seed": 42,
    "e2_seed": 42,
    "optimizer": "adamw",
    "learning_rate": 1e-4,
    "weight_decay": 1e-4,
    "max_epochs": 20,
    "smoke_epochs": 2,
    "early_stopping_patience": 3,
    "lr_scheduler": None,
    "warmup_steps": 0,
    "gradient_clip_norm": 0.0,
    "augmentations": (),
    "checkpoint_selector": "validation_macro_auprc",
    "experiment_primary_metric": "oof_macro_auprc",
    "threshold_policy": "fixed_0.5",
    "num_workers": 2,
    "pin_memory": True,
    "persistent_workers": True,
    "preflight_free_vram_mb": 6800,
}


def default_protocol() -> E0E3Protocol:
    return E0E3Protocol(**FROZEN_FIELDS)


def _to_jsonable(obj: Any) -> Any:
    if isinstance(obj, tuple):
        return list(obj)
    return obj


def dump_protocol(protocol: E0E3Protocol, path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {k: _to_jsonable(v) for k, v in asdict(protocol).items()}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def load_protocol(path: Path) -> E0E3Protocol:
    raw = json.loads(Path(path).read_text())
    known = {f.name for f in fields(E0E3Protocol)}
    missing = [name for name in known if name not in raw]
    if missing:
        raise ProtocolError(
            f"protocol file {path} missing required fields: {sorted(missing)}"
        )
    bad = []
    for name, expected in FROZEN_FIELDS.items():
        got = raw.get(name)
        # Tuples serialize as lists in JSON; coerce for comparison.
        if isinstance(expected, tuple):
            if not isinstance(got, list) or tuple(got) != expected:
                bad.append((name, expected, got))
            continue
        if got != expected:
            bad.append((name, expected, got))
    if bad:
        msgs = ", ".join(f"{n}: expected {e!r}, got {g!r}" for n, e, g in bad)
        raise ProtocolError(
            f"protocol file {path} violates frozen values: {msgs}"
        )
    kwargs = {k: (tuple(v) if k == "augmentations" else v) for k, v in raw.items()}
    return E0E3Protocol(**kwargs)