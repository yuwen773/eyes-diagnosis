"""FakeProtocolLoader — returns an in-memory copy of the frozen v1 training config."""
from __future__ import annotations

from typing import Any

# Mirrors the pinned frozen v1 config in ``p1/protocol_p2_02a_v1.json``. Locked
# during the P2-02B brainstorming session; do not retune per-variant.
_FROZEN_V1: dict[str, Any] = {
    "schema_version": "p2-02a-v1",
    "optimizer": "AdamW",
    "learning_rate": 0.0001,
    "weight_decay": 0.0001,
    "max_epochs": 20,
    "early_stopping_patience": 5,
    "checkpoint_selector": "validation_macro_auprc",
    "loss": "bce_with_logits",
    "patient_batch": 8,
    "gradient_accumulation": 1,
    "amp": True,
    "gradient_clip_norm": 1.0,
    "scheduler": "reduce_on_plateau",
    "scheduler_metric": "validation_macro_auprc",
    "scheduler_factor": 0.5,
    "scheduler_patience": 2,
    "threshold_policy": "fixed_0.5",
}


class FakeProtocolLoader:
    """Returns a fresh copy of the frozen v1 dict. Tests can mutate the return."""

    def __init__(self, override: dict[str, Any] | None = None) -> None:
        self._override = override or {}

    def load(self) -> dict[str, Any]:
        cfg = dict(_FROZEN_V1)
        cfg.update(self._override)
        return cfg