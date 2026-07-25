"""Tests for the compute-benchmark measurement core.

The heavy CUDA sweep is not run here; instead we test the *pure* control
logic that the real benchmark relies on, using injected fakes:

- ``measure_config`` computes P50/P95 step time and throughput from a
  step function + injected clock, and records peak/free VRAM via an
  injected memory probe.
- An out-of-memory error raised by the step function is *captured*
  (``oom=True``, ``stable=False``) — it never propagates and aborts the
  whole benchmark.
- ``run_compute_sweep`` stops testing larger patient batches for a backbone
  once a deterministic OOM occurs.
- Every ``ConfigResult`` serialises to a dict with the full field set the
  ``benchmark_compute_v1.json`` schema requires.

These run on CPU; no GPU needed.
"""

from __future__ import annotations

import pytest

from p1.benchmark.compute import (  # noqa: E402
    ConfigResult,
    FakeMemoryProbe,
    is_oom_error,
    measure_config,
    result_to_dict,
    run_compute_sweep,
)

REQUIRED_FIELDS = {
    "backbone",
    "weights",
    "input_size",
    "patient_batch_size",
    "encoder_image_batch_size",
    "amp",
    "steps",
    "stable",
    "oom",
    "start_free_vram_mb",
    "peak_allocated_mb",
    "peak_reserved_mb",
    "free_vram_after_step_mb",
    "step_time_p50_ms",
    "step_time_p95_ms",
    "patients_per_second",
    "images_per_second",
}


class _StepClock:
    """Monotonic fake clock advancing a fixed delta each call (seconds)."""

    def __init__(self, delta_s: float):
        self.delta_s = delta_s
        self.t = 0.0

    def __call__(self) -> float:
        self.t += self.delta_s
        return self.t


def _ok_step() -> None:
    return None


def test_measure_config_reports_percentiles_and_throughput() -> None:
    # The fake clock advances 5 ms per call; t0 and t1 are consecutive
    # calls, so each measured step interval is exactly 5 ms.
    clock = _StepClock(delta_s=0.005)
    mem = FakeMemoryProbe(start_free_mb=7000, peak_alloc_mb=1234, peak_reserved_mb=2345, free_after_mb=5000)
    res = measure_config(
        backbone="efficientnet_b4",
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        input_size=380,
        patient_batch=2,
        step_fn=_ok_step,
        warmup=3,
        measure=10,
        clock=clock,
        mem=mem,
        sync=lambda: None,
        amp=True,
    )
    assert res.oom is False
    assert res.stable is True
    assert res.steps == 10
    assert res.encoder_image_batch_size == 4
    assert abs(res.step_time_p50_ms - 5.0) < 1e-6
    assert abs(res.step_time_p95_ms - 5.0) < 1e-6
    # 2 patients / 0.005 s = 400 patients/s; images = 2x.
    assert abs(res.patients_per_second - 400.0) < 1e-3
    assert abs(res.images_per_second - 800.0) < 1e-3
    assert res.peak_allocated_mb == 1234
    assert res.peak_reserved_mb == 2345
    assert res.start_free_vram_mb == 7000


def test_oom_is_captured_not_raised() -> None:
    def oom_step() -> None:
        raise RuntimeError("CUDA out of memory. Tried to allocate ...")

    mem = FakeMemoryProbe(start_free_mb=7000, peak_alloc_mb=0, peak_reserved_mb=0, free_after_mb=7000)
    res = measure_config(
        backbone="efficientnet_b4",
        weights="w",
        input_size=380,
        patient_batch=8,
        step_fn=oom_step,
        warmup=2,
        measure=10,
        clock=_StepClock(0.001),
        mem=mem,
        sync=lambda: None,
        amp=True,
    )
    assert res.oom is True
    assert res.stable is False


def test_non_oom_error_propagates() -> None:
    def bad_step() -> None:
        raise ValueError("something unrelated")

    with pytest.raises(ValueError):
        measure_config(
            backbone="efficientnet_b2",
            weights="w",
            input_size=288,
            patient_batch=1,
            step_fn=bad_step,
            warmup=1,
            measure=5,
            clock=_StepClock(0.001),
            mem=FakeMemoryProbe(7000, 0, 0, 7000),
            sync=lambda: None,
            amp=True,
        )


def test_is_oom_error_detection() -> None:
    assert is_oom_error(RuntimeError("CUDA out of memory"))
    assert is_oom_error(RuntimeError("CUBLAS_STATUS_ALLOC_FAILED"))
    assert not is_oom_error(RuntimeError("shape mismatch"))
    assert not is_oom_error(ValueError("x"))


def test_sweep_stops_larger_batches_after_oom() -> None:
    """Once patient_batch=2 OOMs for a backbone, batch 4/6/8 are skipped."""
    oom_from = {"efficientnet_b4": 2}

    def make_step(backbone, patient_batch):
        def step():
            if patient_batch >= oom_from.get(backbone, 999):
                raise RuntimeError("CUDA out of memory")
        return step

    results = run_compute_sweep(
        backbones=[
            ("efficientnet_b4", "w4", 380),
        ],
        patient_batches=[1, 2, 4, 6, 8],
        make_step=make_step,
        warmup=1,
        measure=3,
        clock_factory=lambda: _StepClock(0.001),
        mem_factory=lambda: FakeMemoryProbe(7000, 100, 200, 6000),
        sync=lambda: None,
        repeats=1,
    )
    by_batch = {r.patient_batch_size: r for r in results}
    # batch 1 stable, batch 2 OOM, 4/6/8 recorded as OOM-skipped (not run).
    assert by_batch[1].oom is False and by_batch[1].stable is True
    assert by_batch[2].oom is True
    for b in (4, 6, 8):
        assert by_batch[b].oom is True
        assert by_batch[b].stable is False


def test_result_to_dict_has_all_required_fields() -> None:
    res = ConfigResult(
        backbone="efficientnet_b3",
        weights="EfficientNet_B3_Weights.IMAGENET1K_V1",
        input_size=300,
        patient_batch_size=4,
        encoder_image_batch_size=8,
        amp=True,
        steps=100,
        stable=True,
        oom=False,
        start_free_vram_mb=7000,
        peak_allocated_mb=4000,
        peak_reserved_mb=5000,
        free_vram_after_step_mb=2000,
        step_time_p50_ms=50.0,
        step_time_p95_ms=60.0,
        patients_per_second=80.0,
        images_per_second=160.0,
    )
    d = result_to_dict(res)
    assert REQUIRED_FIELDS.issubset(d.keys())
    import json

    json.dumps(d)  # must be serialisable
