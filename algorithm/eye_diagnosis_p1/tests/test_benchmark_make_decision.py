"""Tests for the make_decision orchestration in p1.benchmark.run.

These verify that the baseline-free-VRAM argument is plumbed through
to BackboneEvidence (i.e. the VRAM headroom check uses the system
baseline, not the contaminated per-config start_free).
"""

from __future__ import annotations

import pytest

from p1.benchmark.run import make_decision


def _compute(backbone: str, pb: int, *, peak_reserved: int, start_free: int) -> dict:
    return {
        "backbone": backbone,
        "patient_batch_size": pb,
        "stable": True,
        "oom": False,
        "peak_reserved_mb": peak_reserved,
        "start_free_vram_mb": start_free,
    }


def _io(backbone: str, pps: float) -> dict:
    return {
        "backbone": backbone,
        "end_to_end_patients_per_second": pps,
    }


def test_uses_baseline_vram_not_per_config_for_headroom() -> None:
    """If baseline is passed in at 7000, even when per-config start_free
    is contaminated, B4 should be retained when its peak is 80% of 7000."""
    compute = [
        _compute("efficientnet_b4", 1, peak_reserved=1000, start_free=2000),
        _compute("efficientnet_b4", 8, peak_reserved=5600, start_free=100),
        _compute("efficientnet_b3", 8, peak_reserved=3000, start_free=2000),
    ]
    io = [
        _io("efficientnet_b4", 14.0),  # 14/15 = 93% of B3 → above 70% floor
        _io("efficientnet_b3", 15.0),
    ]
    d = make_decision(compute, io, baseline_free_vram_mb=7000)
    assert d["selected_backbone"] == "efficientnet_b4"
    # evidence[0] is B4; check it reports start_free_vram_mb=7000
    assert d["evidence"][0]["start_free_vram_mb"] == 7000


def test_baseline_vram_below_85_percent_threshold_drops_b4() -> None:
    compute = [
        _compute("efficientnet_b4", 8, peak_reserved=6300, start_free=100),  # 6300/7000 = 90%
        _compute("efficientnet_b3", 8, peak_reserved=3000, start_free=2000),
    ]
    io = [_io("efficientnet_b4", 12.0), _io("efficientnet_b3", 15.0)]
    d = make_decision(compute, io, baseline_free_vram_mb=7000)
    assert d["selected_backbone"] == "efficientnet_b3"
    assert any("falling back to B3" in n for n in d["notes"])
