"""Backbone decision policy for the P1-01c benchmark.

Pure logic — no I/O, no torch, no benchmark state. Given the
``BackboneEvidence`` collected from Part A (compute) and Part B (I/O),
applies the decision rules in the P1-01c scope and returns a
``BackboneDecision`` the CLI writes to ``backbone_decision_v1.json``.

Rules (from the P1-01c spec):

- **Keep B4** if ALL of:
  * patient_batch >= 2 stable
  * 3 repeats of 100 steps, no OOM
  * peak reserved <= 85% of start free VRAM
  * I/O throughput is not catastrophically low (<= ~30% of B3)
- **Choose B3** if B4 fails any of the above.
- **Choose B2** only if B3 also cannot reach patient_batch >= 2.

These are *current* thresholds for this round. The CLI captures every
backbone's evidence in the decision artifact so a later round can
re-decide without re-running the sweep.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Sequence

_BACKBONES = ("efficientnet_b2", "efficientnet_b3", "efficientnet_b4")
_INPUT_SIZE = {"efficientnet_b2": 288, "efficientnet_b3": 300, "efficientnet_b4": 380}
_VRAM_HEADROOM = 0.85  # peak reserved / start free
_IO_FLOOR = 0.70       # B4 I/O must be >= 70% of B3's I/O to retain B4


@dataclass(frozen=True)
class BackboneEvidence:
    backbone: str
    input_size: int
    stable_patient_batches: tuple[int, ...]
    max_peak_reserved_mb: int
    start_free_vram_mb: int
    oomed: bool
    io_patients_per_second: float


@dataclass(frozen=True)
class BackboneDecision:
    selected_backbone: str
    selected_patient_batch: int
    gradient_accumulation_target: int
    target_patient_batch: int
    notes: list[str] = field(default_factory=list)
    evidence: list[BackboneEvidence] = field(default_factory=list)


def decision_to_dict(d: BackboneDecision) -> dict:
    out = asdict(d)
    out["evidence"] = [asdict(e) for e in d.evidence]
    return out


def _b4_passes(ev_b4: BackboneEvidence | None, ev_b3: BackboneEvidence | None) -> bool:
    if ev_b4 is None or ev_b4.oomed or ev_b4.max_peak_reserved_mb == 0:
        return False
    if max(ev_b4.stable_patient_batches, default=0) < 2:
        return False
    headroom = ev_b4.max_peak_reserved_mb / max(ev_b4.start_free_vram_mb, 1)
    if headroom > _VRAM_HEADROOM:
        return False
    if ev_b3 is not None and ev_b3.io_patients_per_second > 0:
        ratio = ev_b4.io_patients_per_second / ev_b3.io_patients_per_second
        if ratio < _IO_FLOOR:
            return False
    return True


def _b3_passes(ev_b3: BackboneEvidence | None) -> bool:
    if ev_b3 is None or ev_b3.oomed or ev_b3.max_peak_reserved_mb == 0:
        return False
    return max(ev_b3.stable_patient_batches, default=0) >= 2


def decide_backbone(
    evidence: Sequence[BackboneEvidence], *, target_patient_batch: int
) -> BackboneDecision:
    by = {e.backbone: e for e in evidence}
    ev_b4 = by.get("efficientnet_b4")
    ev_b3 = by.get("efficientnet_b3")
    ev_b2 = by.get("efficientnet_b2")

    notes: list[str] = []

    if _b4_passes(ev_b4, ev_b3):
        selected = "efficientnet_b4"
        pb = max(ev_b4.stable_patient_batches)
    elif _b3_passes(ev_b3):
        selected = "efficientnet_b3"
        pb = max(ev_b3.stable_patient_batches)
        notes.append("B4 failed to meet all retention criteria; falling back to B3.")
    else:
        selected = "efficientnet_b2"
        pb = max(ev_b2.stable_patient_batches, default=1) if ev_b2 is not None else 1
        notes.append("B3 also cannot reach patient_batch>=2; falling back to B2.")

    # Gradient accumulation target: enough accumulations to hit target.
    accum = max(1, math.ceil(target_patient_batch / max(pb, 1)))

    return BackboneDecision(
        selected_backbone=selected,
        selected_patient_batch=pb,
        gradient_accumulation_target=accum,
        target_patient_batch=target_patient_batch,
        notes=notes,
        evidence=list(evidence),
    )
