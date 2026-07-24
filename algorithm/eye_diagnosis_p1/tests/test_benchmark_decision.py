"""Tests for the backbone decision policy.

The decision is pure logic — given a list of compute + I/O results, return a
``BackboneDecision`` with ``selected_backbone``, ``selected_patient_batch``,
``gradient_accumulation_target``, ``notes``, and the per-backbone evidence.

Rules (P1-01c spec):

- B4 retained only if:
  * patient_batch >= 2 (encoder image batch >= 4)
  * 100 stable steps, 3x repeat, no OOM
  * peak reserved <= 85% of free VRAM at start
  * p95 tail not pathological
  * I/O throughput is >= ~70% of B3's
- Otherwise B3, unless B3 can't reach patient_batch >= 2 either.
- Decisions are recorded even when nothing reached the target.
"""

from __future__ import annotations

from p1.benchmark.decision import (  # noqa: E402
    BackboneDecision,
    BackboneEvidence,
    decide_backbone,
    decision_to_dict,
)


def _ev(
    backbone: str,
    stable_patient_batches: list[int],
    peak_reserved_mb: int,
    start_free_mb: int,
    oom: bool = False,
    io_patients_per_second: float = 0.0,
) -> BackboneEvidence:
    return BackboneEvidence(
        backbone=backbone,
        input_size={"efficientnet_b2": 288, "efficientnet_b3": 300, "efficientnet_b4": 380}[backbone],
        stable_patient_batches=tuple(stable_patient_batches),
        max_peak_reserved_mb=peak_reserved_mb,
        start_free_vram_mb=start_free_mb,
        oomed=oom,
        io_patients_per_second=io_patients_per_second,
    )


def test_keeps_b4_when_stable_and_within_85_percent_vram() -> None:
    evid = [_ev("efficientnet_b4", [1, 2, 4], peak_reserved_mb=5800, start_free_mb=7000, io_patients_per_second=20.0)]
    d = decide_backbone(evid, target_patient_batch=8)
    assert d.selected_backbone == "efficientnet_b4"
    assert d.selected_patient_batch == 4
    assert d.gradient_accumulation_target == 2  # 8 / 4


def test_drops_to_b3_when_b4_only_stable_at_batch_1() -> None:
    evid = [
        _ev("efficientnet_b4", [1], peak_reserved_mb=4000, start_free_mb=7000, io_patients_per_second=12.0),
        _ev("efficientnet_b3", [1, 2, 4], peak_reserved_mb=3500, start_free_mb=7000, io_patients_per_second=22.0),
    ]
    d = decide_backbone(evid, target_patient_batch=8)
    assert d.selected_backbone == "efficientnet_b3"
    assert d.selected_patient_batch == 4
    assert d.gradient_accumulation_target == 2


def test_drops_to_b3_when_peak_reserved_exceeds_85_percent() -> None:
    # 6000 / 7000 = 85.7% — over the threshold.
    evid = [
        _ev("efficientnet_b4", [1, 2], peak_reserved_mb=6000, start_free_mb=7000, io_patients_per_second=15.0),
        _ev("efficientnet_b3", [1, 2, 4], peak_reserved_mb=3500, start_free_mb=7000, io_patients_per_second=22.0),
    ]
    d = decide_backbone(evid, target_patient_batch=8)
    assert d.selected_backbone == "efficientnet_b3"


def test_falls_to_b2_when_b3_cannot_reach_batch_2() -> None:
    evid = [
        _ev("efficientnet_b4", [], peak_reserved_mb=0, start_free_mb=0, oom=True, io_patients_per_second=0.0),
        _ev("efficientnet_b3", [1], peak_reserved_mb=4000, start_free_mb=7000, io_patients_per_second=18.0),
        _ev("efficientnet_b2", [1, 2, 4, 6], peak_reserved_mb=3000, start_free_mb=7000, io_patients_per_second=28.0),
    ]
    d = decide_backbone(evid, target_patient_batch=8)
    assert d.selected_backbone == "efficientnet_b2"
    assert d.selected_patient_batch == 6
    assert d.gradient_accumulation_target == 2  # 8 / 6 ceil = 2 (acc steps)


def test_decision_serialises_to_dict() -> None:
    evid = [_ev("efficientnet_b4", [1, 2, 4], peak_reserved_mb=5800, start_free_mb=7000, io_patients_per_second=20.0)]
    d = decide_backbone(evid, target_patient_batch=8)
    out = decision_to_dict(d)
    import json
    json.dumps(out)
    assert "selected_backbone" in out
    assert "evidence" in out
    assert out["selected_backbone"] in {"efficientnet_b2", "efficientnet_b3", "efficientnet_b4"}
