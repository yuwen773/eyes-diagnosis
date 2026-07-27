"""Unit tests for P2-02A T4: 100-batch stability run.

T4 is the final gate in P2-02A before epoch training. It runs 100
consecutive real batches at the cell-F config (amp=True, batch=8,
workers=2, pin_memory=True) and verifies:

- No OOM across 100 batches
- No NaN loss at any step
- First-batch time, P50/P95 of subsequent batches, peak VRAM

These tests use fake adapters (same pattern as test_p2_02a_stability_probe.py)
so they stay CPU-only. The fake DataLoader yields 100 distinct batches;
the fake TorchAdapter records autocast calls, sync point counts, and
timing/VRAM data.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from eye_diagnosis_p1.tests.test_p2_02a_stability_probe import (
    FakeDataLoaderFactory,
    FakeModelFactory,
    FakeScaledTensor,
    FakeTensor,
)


# ---------------------------------------------------------------------------
# Test fakes specific to T4 (multi-batch DataLoader, timing, OOM/NaN control)
# ---------------------------------------------------------------------------


class _FakeAutocastCM:
    """Null context manager that records enter/exit."""

    def __init__(self, events: list[str]) -> None:
        self._events = events

    def __enter__(self) -> "_FakeAutocastCM":
        self._events.append("enter")
        return self

    def __exit__(self, *exc_info: Any) -> bool:
        self._events.append("exit")
        return False


class AutocastRecordingAdapter:
    """TorchAdapter that records autocast + sync calls for T4 tests."""

    def __init__(
        self,
        *,
        vram_free_mb: int = 8000,
        inject_nan_at_batch: int | None = None,
    ) -> None:
        self.vram_free_mb = vram_free_mb
        self.sync_calls = 0
        self.autocast_events: list[str] = []
        self.isfinite_calls: list[Any] = []
        self._vram_call_idx = 0
        self.inject_nan_at_batch = inject_nan_at_batch
        self._batch_idx = 0

    def cuda_is_available(self) -> bool:
        return True

    def cuda_device_count(self) -> int:
        return 1

    def cuda_synchronize(self) -> None:
        self.sync_calls += 1

    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]:
        self._vram_call_idx += 1
        return self.vram_free_mb * 1024 * 1024, 16 * 1024 * 1024 * 1024

    def isfinite(self, tensor: Any) -> bool:
        self.isfinite_calls.append(tensor)
        if self.inject_nan_at_batch is not None:
            self._batch_idx += 1
            if self._batch_idx == self.inject_nan_at_batch:
                return False
        return True

    def GradScaler(self, enabled: bool) -> Any:
        return _FakeScalerForT4()

    def BCEWithLogitsLoss(self) -> Any:
        return _FakeLossForT4()

    def float(self, tensor: Any) -> FakeTensor:
        return FakeTensor(tensor.shape, device=tensor.device, dtype="float32")

    def autocast(
        self,
        device_type: str = "cuda",
        dtype: Any = None,
        enabled: bool = True,
    ) -> _FakeAutocastCM:
        return _FakeAutocastCM(self.autocast_events)


class _FakeScalerForT4:
    """GradScaler that returns a FakeScaledTensor with backward()."""

    def __init__(self) -> None:
        self.scale_calls = 0
        self.step_calls = 0
        self.update_calls = 0

    def scale(self, loss: Any) -> FakeScaledTensor:
        self.scale_calls += 1
        return FakeScaledTensor(loss.shape, device="cuda", dtype="float32")

    def step(self, optimizer: Any) -> None:
        self.step_calls += 1

    def update(self) -> None:
        self.update_calls += 1


class _FakeLossForT4:
    """BCEWithLogitsLoss that returns a finite loss tensor (shape () for item()).

    BCEWithLogitsLoss returns a scalar, so the fake returns a tensor with
    shape () and item() = 0.5.
    """

    def __call__(self, logits: Any, labels: Any) -> FakeTensor:
        return FakeTensor((), device="cuda", dtype="float32")


class _FakeOptimizer:
    """Records zero_grad and step calls."""

    def __init__(self) -> None:
        self.zero_grad_calls = 0

    def zero_grad(self, set_to_none: bool = True) -> None:  # noqa: ARG002
        self.zero_grad_calls += 1


# ---------------------------------------------------------------------------
# Fake DataLoader that yields N distinct batches
# ---------------------------------------------------------------------------


class MultiBatchFakeDataLoader:
    """Yields N fake batches, each with distinct FakeTensor content."""

    def __init__(
        self,
        n_batches: int,
        batch_size: int = 8,
        image_size: int = 380,
        num_classes: int = 8,
    ) -> None:
        self.n_batches = n_batches
        self.batch_size = batch_size
        self.image_size = image_size
        self.num_classes = num_classes
        self.iter_called = False
        self._cursor = 0

    def __iter__(self) -> "MultiBatchFakeDataLoader":
        self.iter_called = True
        self._cursor = 0
        return self

    def __next__(self) -> tuple[FakeTensor, FakeTensor, FakeTensor, float]:
        if self._cursor >= self.n_batches:
            raise StopIteration
        self._cursor += 1
        left = FakeTensor((self.batch_size, 3, self.image_size, self.image_size))
        right = FakeTensor((self.batch_size, 3, self.image_size, self.image_size))
        labels = FakeTensor((self.batch_size, self.num_classes))
        cpu_ms = 12.5  # plausible average from benchmark
        return left, right, labels, cpu_ms


class MultiBatchDataLoaderFactory:
    """DataLoaderFactory that builds a MultiBatchFakeDataLoader."""

    def __init__(
        self,
        n_batches: int = 100,
        batch_size: int = 8,
    ) -> None:
        self.n_batches = n_batches
        self.batch_size = batch_size
        self.build_calls: list[dict[str, Any]] = []

    def __call__(
        self,
        *,
        dataset: Any,
        batch_size: int,
        num_workers: int,
        pin_memory: bool,
    ) -> MultiBatchFakeDataLoader:
        self.build_calls.append(
            {
                "dataset": dataset,
                "batch_size": batch_size,
                "num_workers": num_workers,
                "pin_memory": pin_memory,
            }
        )
        return MultiBatchFakeDataLoader(self.n_batches, self.batch_size)


# ---------------------------------------------------------------------------
# Module existence
# ---------------------------------------------------------------------------


def test_t4_module_exposes_run_t4_stability() -> None:
    """p1.stability.t4 must expose a run_t4_stability function."""
    import p1.stability.t4 as t4

    assert hasattr(t4, "run_t4_stability"), (
        "T4 module must expose run_t4_stability()"
    )


# ---------------------------------------------------------------------------
# Happy-path: 100 batches complete without error
# ---------------------------------------------------------------------------


def test_t4_runs_100_batches_on_happy_path() -> None:
    """All 100 batches complete with PASS verdict."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["verdict"] == "PASS"
    assert report["total_batches_attempted"] == 100
    assert report["success_batches"] == 100
    assert report["oom"] is False
    assert report["nan_detected"] is False
    assert len(report["batch_timings"]) == 100
    # Every batch has the expected timing keys.
    for bt in report["batch_timings"]:
        assert set(bt.keys()) == {"batch_idx", "loss", "gpu_step_ms", "vram_free_mb"}


def test_t4_records_first_batch_and_percentiles() -> None:
    """T4 reports first_batch_ms, p50_gpu_ms, p95_gpu_ms."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert isinstance(report["first_batch_ms"], float)
    assert report["first_batch_ms"] >= 0
    assert isinstance(report["p50_gpu_ms"], float)
    assert isinstance(report["p95_gpu_ms"], float)
    assert report["p95_gpu_ms"] >= report["p50_gpu_ms"] >= 0
    assert isinstance(report["peak_vram_mb"], int)


def test_t4_enters_autocast_for_amp_true() -> None:
    """When amp=True, autocast is entered for every forward pass."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["verdict"] == "PASS"
    enters = sum(1 for e in torch_a.autocast_events if e == "enter")
    exits = sum(1 for e in torch_a.autocast_events if e == "exit")
    # 100 batches, each has enter + exit
    assert enters == 100
    assert enters == exits


# ---------------------------------------------------------------------------
# NaN detection
# ---------------------------------------------------------------------------


def test_t4_detects_nan_and_reports_failure() -> None:
    """When loss is NaN at batch N, T4 short-circuits and reports nan_detected."""
    import p1.stability.t4 as t4

    NAN_BATCH = 47
    torch_a = AutocastRecordingAdapter(inject_nan_at_batch=NAN_BATCH)
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["verdict"] == "BLOCKED"
    assert report["nan_detected"] is True
    assert report["nan_at_batch"] == NAN_BATCH


# ---------------------------------------------------------------------------
# OOM handling
# ---------------------------------------------------------------------------


class OOMDataLoaderOnFirstBatch:
    """Raises RuntimeError('CUDA out of memory') on __next__."""

    def __iter__(self) -> "OOMDataLoaderOnFirstBatch":
        return self

    def __next__(self) -> None:
        raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB.")


class OOMDataLoaderFactory:
    def __call__(self, **kwargs: Any) -> OOMDataLoaderOnFirstBatch:  # noqa: ARG002
        return OOMDataLoaderOnFirstBatch()


def test_t4_catches_oom_and_reports_blocked() -> None:
    """When the DataLoader raises an OOM-like error, T4 catches it."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=OOMDataLoaderFactory(),
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["oom"] is True
    assert report["total_batches_attempted"] == 0
    assert report["verdict"] == "BLOCKED"


# ---------------------------------------------------------------------------
# Early termination on too few batches
# ---------------------------------------------------------------------------


def test_t4_passes_with_exactly_100_batches() -> None:
    """100 batches is the exact target — PASS."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["verdict"] == "PASS"
    assert report["success_batches"] == 100


def test_t4_exhausts_iterator_early_when_every_item_raises_stop() -> None:
    """If every iter() raises StopIteration on first next(), exit cleanly."""
    import p1.stability.t4 as t4

    class EmptyDLFactory:
        def __call__(self, **kwargs: Any) -> Any:  # noqa: ARG002
            # Return something that is iterable but immediately empty
            class _Empty:
                def __iter__(s):
                    return s

                def __next__(s):
                    raise StopIteration

            return _Empty()

    torch_a = AutocastRecordingAdapter()
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=EmptyDLFactory(),
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["total_batches_attempted"] == 0
    assert report["success_batches"] == 0
    # This is the degenerate case — T4 should handle it without a traceback.
    # Real data will never hit this; a misconfigured test loader will. In
    # the real run, fold 0 yields ~61 batches per epoch (491 patients ÷ 8),
    # so the iterator restarts and reaches 100 in 2 epochs.


# ---------------------------------------------------------------------------
# Config passthrough
# ---------------------------------------------------------------------------


def test_t4_declares_expected_config_in_report() -> None:
    """The T4 report declares the config it was run with."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["config"]["amp"] is True
    assert report["config"]["patient_batch"] == 8
    assert report["config"]["num_workers"] == 2
    assert report["config"]["pin_memory"] is True
    assert report["config"]["experiment"] == "E3"
    assert report["config"]["backbone"] == "efficientnet_b4"


# ---------------------------------------------------------------------------
# Autocast disabled path
# ---------------------------------------------------------------------------


def test_t4_skips_autocast_when_amp_false() -> None:
    """When amp=False, no autocast contexts are entered."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=False,
        patient_batch=1,
        num_workers=0,
        pin_memory=False,
    )
    assert report["verdict"] == "PASS"
    assert torch_a.autocast_events == []


# ---------------------------------------------------------------------------
# Reviewer-requested MEDIUM coverage: OOM in training step, epoch restart,
# scaler call counts, autocast ordering.
# ---------------------------------------------------------------------------


class OOMOnForwardFakeModel:
    """Fake model that raises CUDA OOM on first forward call."""

    def __init__(self) -> None:
        self.calls = 0

    def train(self) -> "OOMOnForwardFakeModel":
        return self

    def __call__(self, left: Any, right: Any) -> FakeTensor:
        self.calls += 1
        raise RuntimeError("CUDA out of memory. Tried to allocate 1.50 GiB.")


class OOMOnForwardModelFactory:
    def __init__(self) -> None:
        self.build_calls = 0

    def __call__(
        self, *, experiment: str, weights: str, device: str
    ) -> tuple[OOMOnForwardFakeModel, dict[str, Any]]:
        self.build_calls += 1
        return OOMOnForwardFakeModel(), {
            "weights": weights,
            "weights_loaded": True,
            "initialization": "imagenet",
            "model_device": device,
            "first_conv_in_channels": 3,
        }


def test_t4_catches_oom_during_training_step() -> None:
    """OOM raised inside model() (not DataLoader) is also caught."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = OOMOnForwardModelFactory()
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["oom"] is True
    assert report["verdict"] == "BLOCKED"
    assert report["nan_detected"] is False
    assert report["total_batches_attempted"] == 1
    assert report["success_batches"] == 0


class _TwoEpochFakeDataLoader:
    """Yields 60 batches, raises StopIteration, then yields 40 more on restart.

    Mirrors the real-data scenario: fold 0 has ~491 patients ÷ batch=8 ≈ 61
    per epoch, so reaching 100 batches requires 2 epochs.
    """

    def __init__(self) -> None:
        self.epoch = 0
        self._cursor = 0

    def __iter__(self) -> "_TwoEpochFakeDataLoader":
        self.epoch += 1
        self._cursor = 0
        return self

    def __next__(self) -> tuple[FakeTensor, FakeTensor, FakeTensor, float]:
        epoch_size = 60 if self.epoch == 1 else 40
        if self._cursor >= epoch_size:
            raise StopIteration
        self._cursor += 1
        left = FakeTensor((8, 3, 380, 380))
        right = FakeTensor((8, 3, 380, 380))
        labels = FakeTensor((8, 8))
        return left, right, labels, 12.5


class _TwoEpochDataLoaderFactory:
    def __call__(
        self, *, dataset: Any, batch_size: int, num_workers: int, pin_memory: bool
    ) -> _TwoEpochFakeDataLoader:  # noqa: ARG002
        return _TwoEpochFakeDataLoader()


def test_t4_handles_epoch_restart() -> None:
    """T4 restarts the DataLoader iterator when StopIteration fires."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = _TwoEpochDataLoaderFactory()
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["success_batches"] == 100
    assert report["verdict"] == "PASS"
    assert report["total_batches_attempted"] == 100


class _RecordingScaler:
    """Records every call so we can assert call counts."""

    def __init__(self) -> None:
        self.scale_calls = 0
        self.step_calls = 0
        self.update_calls = 0

    def scale(self, loss: Any) -> FakeScaledTensor:
        self.scale_calls += 1
        return FakeScaledTensor((), device="cuda", dtype="float32")

    def step(self, optimizer: Any) -> None:
        self.step_calls += 1

    def update(self) -> None:
        self.update_calls += 1


class _RecordingScalerFactory:
    def __init__(self) -> None:
        self.scaler = _RecordingScaler()

    def __call__(self, enabled: bool) -> _RecordingScaler:  # noqa: ARG002
        return self.scaler


def test_t4_scaler_call_counts_match_batch_count() -> None:
    """Each success batch must trigger exactly one scale/step/update cycle."""
    import p1.stability.t4 as t4

    scaler_factory = _RecordingScalerFactory()
    torch_a = AutocastRecordingAdapter()
    # Wire the scaler factory into the adapter so t4 sees it.
    torch_a.GradScaler = scaler_factory.__call__  # type: ignore[method-assign]
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["success_batches"] == 100
    assert scaler_factory.scaler.scale_calls == 100
    assert scaler_factory.scaler.step_calls == 100
    assert scaler_factory.scaler.update_calls == 100


def test_t4_autocast_events_are_strictly_enter_exit_pairs() -> None:
    """Each batch's autocast enter must be matched by an exit, in order."""
    import p1.stability.t4 as t4

    torch_a = AutocastRecordingAdapter()
    dl_factory = MultiBatchDataLoaderFactory(n_batches=100)
    model_factory = FakeModelFactory(batch=8)
    optimizer_factory = lambda m: _FakeOptimizer()  # noqa: E731

    report = t4.run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
    )
    assert report["verdict"] == "PASS"
    events = torch_a.autocast_events
    assert len(events) == 200
    for i in range(0, 200, 2):
        assert events[i] == "enter", f"position {i}: {events!r}"
        assert events[i + 1] == "exit", f"position {i + 1}: {events!r}"
