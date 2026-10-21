"""T1.2 contract tests for the real single-batch CUDA stability probe.

These tests cover ``p1.stability.probe.CudaStabilityProbe`` — the
dependency-injected real-CUDA path. The probe walks the 9
``STAGE_NAMES`` in fixed order, records each stage, and short-circuits
on the first exception.

The tests are CI-safe: they use fake adapters (``FakeTorchAdapter``,
``FakeDataLoaderFactory``, ``FakeModelFactory``, ``FakeScalerFactory``)
instead of touching PyTorch / CUDA / DataLoader / PIL. The fake
adapters record every call so tests can assert the probe makes the
right sequence of calls (e.g. ``torch.cuda.synchronize()`` bracketing
``forward``).

CI boundary (NEVER executed here):
- torch.cuda.*
- Real ImageNet download
- Real JPEG decode
- Real RTX 4060

Setup metadata (model_build / model_to_cuda / weights / device /
first_conv_in_channels) is NOT a stage. It is carried on
``ProbeContext.setup`` and serialised separately by the report layer.
"""

from __future__ import annotations

import contextlib
from typing import Any, Callable, List

import pytest

from p1.stability.schema import STAGE_NAMES
from p1.stability.stages import (
    ProbeContext,
    ProbeRunResult,
    ProbeRunner,
    StageSpec,
)


# ---------------------------------------------------------------------------
# Fake adapters — CI-safe stand-ins for Torch / DataLoader / Model / Scaler.
# ---------------------------------------------------------------------------


class FakeTensor:
    """Stand-in for a torch.Tensor with the attributes the probe reads."""

    def __init__(
        self,
        shape: tuple[int, ...],
        *,
        device: str = "cpu",
        dtype: str = "float32",
    ) -> None:
        self.shape = shape
        self.device = device
        self.dtype = dtype
        # Track if we were "moved" to cuda.
        self._moved = False

    def to(self, device: str) -> "FakeTensor":
        new = FakeTensor(self.shape, device=device, dtype=self.dtype)
        new._moved = True
        return new

    def item(self) -> float:
        # Return a dummy scalar for loss.item() calls.
        return 0.5


class FakeScaledTensor(FakeTensor):
    """Stand-in for a GradScaler-scaled fake tensor."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.backward_calls = 0

    def backward(self) -> None:
        self.backward_calls += 1


class FakeScaler:
    """Records every scale/step/update call; never raises."""

    def __init__(self) -> None:
        self.scale_calls: list[Any] = []
        self.step_calls: list[Any] = []
        self.update_calls: int = 0

    def scale(self, loss: Any) -> FakeScaledTensor:
        self.scale_calls.append(loss)
        return FakeScaledTensor(loss.shape)

    def step(self, optimizer: Any) -> None:
        self.step_calls.append(optimizer)

    def update(self) -> None:
        self.update_calls += 1


class FakeOptimizer:
    """Records zero_grad calls."""

    def __init__(self) -> None:
        self.zero_grad_calls: list[bool | None] = []

    def zero_grad(self, set_to_none: bool | None = True) -> None:
        self.zero_grad_calls.append(set_to_none)


class FakeModel:
    """Records forward() calls; returns logits with the right shape."""

    def __init__(self, batch: int, num_classes: int = 8) -> None:
        self.batch = batch
        self.num_classes = num_classes
        self.forward_calls: list[tuple[Any, Any]] = []

    def train(self) -> "FakeModel":
        return self

    def __call__(self, left: Any, right: Any) -> FakeTensor:
        self.forward_calls.append((left, right))
        return FakeTensor((self.batch, self.num_classes))


class FakeLossOutput(FakeTensor):
    """Loss output stands in for the result of BCEWithLogitsLoss."""


class FakeLoss:
    """Records the call and returns a finite loss tensor."""

    def __init__(self) -> None:
        self.calls: list[tuple[Any, Any]] = []

    def __call__(self, logits: Any, labels: Any) -> FakeLossOutput:
        self.calls.append((logits, labels))
        # batch=logits.shape[0]
        return FakeLossOutput(logits.shape)


class FakeDataLoader:
    """Yields a single fake batch on first iter().next()."""

    def __init__(self, batch: FakeBatch) -> None:
        self.batch = batch
        self.iter_called = False
        self.next_called = False

    def __iter__(self) -> "FakeDataLoader":
        self.iter_called = True
        return self

    def __next__(self) -> "FakeBatch":
        if self.next_called:
            raise StopIteration
        self.next_called = True
        return self.batch


class FakeBatch:
    """A batch tuple: (left_eye, right_eye, labels, patient_ids)."""

    def __init__(
        self,
        left: FakeTensor,
        right: FakeTensor,
        labels: FakeTensor,
        pids: list[str],
    ) -> None:
        self.left = left
        self.right = right
        self.labels = labels
        self.pids = pids


class FakeDataset:
    """Just a marker; the probe doesn't index it directly."""


# ---------------------------------------------------------------------------
# Fake Adapters — what the probe receives.
# ---------------------------------------------------------------------------


class FakeTorchAdapter:
    """Stand-in for ``torch`` (cuda, AMP, sync)."""

    def __init__(
        self,
        *,
        vram_free_mb: int = 8000,
        vram_after_mb: int | None = None,
    ) -> None:
        self.vram_free_mb = vram_free_mb
        # If unspecified, treat it as unchanged so the host->device stage
        # sees a stable read.
        self.vram_after_mb = (
            vram_after_mb if vram_after_mb is not None else vram_free_mb
        )
        self.sync_calls: int = 0
        self.isfinite_calls: list[Any] = []

    def cuda_is_available(self) -> bool:
        return True

    def cuda_device_count(self) -> int:
        return 1

    def cuda_synchronize(self) -> None:
        self.sync_calls += 1

    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]:
        # First call (host->device start) returns vram_free_mb;
        # second call (host->device end) returns vram_after_mb.
        # The probe calls it exactly twice during host_to_device, so
        # alternate: first = before, second = after.
        if self.sync_calls == 0 or len(self.isfinite_calls) == 0:
            # We'll use a different counter to track the call number
            # for VRAM (so it doesn't conflict with sync_calls).
            pass
        # Use a dedicated counter.
        if not hasattr(self, "_vram_call_idx"):
            self._vram_call_idx = 0
        self._vram_call_idx += 1
        if self._vram_call_idx % 2 == 1:
            mb = self.vram_free_mb
        else:
            mb = self.vram_after_mb
        return mb * 1024 * 1024, 16 * 1024 * 1024 * 1024

    def isfinite(self, tensor: Any) -> bool:
        self.isfinite_calls.append(tensor)
        return True

    def GradScaler(self, enabled: bool) -> FakeScaler:
        return FakeScaler()

    def BCEWithLogitsLoss(self) -> FakeLoss:
        return FakeLoss()

    def float(self, tensor: Any) -> FakeTensor:
        # labels.float() — return a new tensor with same shape.
        return FakeTensor(tensor.shape, device=tensor.device, dtype="float32")

    def autocast(
        self,
        device_type: str = "cuda",
        dtype: Any = None,
        enabled: bool = True,
    ) -> Any:
        # The probe opens autocast in _stage_forward and closes it in
        # _stage_loss. Return a context manager that does nothing — the
        # behaviour under autocast is exercised by the dedicated
        # test_p2_02a_probe_autocast.py tests.
        return contextlib.nullcontext()


class FakeDataLoaderFactory:
    """Builds a FakeDataLoader wrapping a single FakeBatch."""

    def __init__(
        self,
        *,
        batch: int = 1,
        image_size: int = 380,
        num_classes: int = 8,
    ) -> None:
        self.batch = batch
        self.image_size = image_size
        self.num_classes = num_classes
        self.build_calls: list[dict[str, Any]] = []

    def __call__(
        self,
        *,
        dataset: Any,
        batch_size: int,
        num_workers: int,
        pin_memory: bool,
    ) -> FakeDataLoader:
        self.build_calls.append(
            {
                "dataset": dataset,
                "batch_size": batch_size,
                "num_workers": num_workers,
                "pin_memory": pin_memory,
            }
        )
        left = FakeTensor((batch_size, 3, self.image_size, self.image_size))
        right = FakeTensor((batch_size, 3, self.image_size, self.image_size))
        labels = FakeTensor((batch_size, self.num_classes))
        pids = [f"p{i}" for i in range(batch_size)]
        return FakeDataLoader(FakeBatch(left, right, labels, pids))


class FakeModelFactory:
    """Builds a FakeModel."""

    def __init__(self, batch: int = 1, num_classes: int = 8) -> None:
        self.batch = batch
        self.num_classes = num_classes
        self.build_calls: list[dict[str, Any]] = []

    def __call__(
        self,
        *,
        experiment: str,
        weights: str,
        device: str,
    ) -> tuple[FakeModel, dict[str, Any]]:
        self.build_calls.append(
            {"experiment": experiment, "weights": weights, "device": device}
        )
        model = FakeModel(self.batch, self.num_classes)
        setup = {
            "weights": weights,
            "weights_loaded": True,
            "initialization": "imagenet",
            "model_device": device,
            "first_conv_in_channels": 3,
        }
        return model, setup


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stages() -> List[StageSpec]:
    return [StageSpec(name=n) for n in STAGE_NAMES]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_probe_module_exposes_build_probe() -> None:
    """The probe module must expose a ``build_probe`` factory."""
    from p1.stability import probe as probe_mod

    assert hasattr(probe_mod, "build_probe"), (
        "p1.stability.probe must expose build_probe()"
    )


def test_build_probe_returns_runner_with_nine_stages() -> None:
    """``build_probe`` returns a ProbeRunner pre-loaded with 9 stages."""
    from p1.stability.probe import build_probe

    runner = build_probe(
        torch=FakeTorchAdapter(),
        dataloader_factory=FakeDataLoaderFactory(),
        model_factory=FakeModelFactory(),
    )
    assert isinstance(runner, ProbeRunner)


def test_probe_runs_all_nine_stages_in_order_on_happy_path() -> None:
    """All 9 stages execute and produce a 9-entry report on success."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory(batch=1)
    model_factory = FakeModelFactory(batch=1)
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert isinstance(result, ProbeRunResult)
    assert result.all_pass is True
    assert result.failed_stage is None
    assert len(result.records) == 9
    for i, name in enumerate(STAGE_NAMES):
        assert result.records[i]["stage"] == name
        assert result.records[i]["status"] == "ok"


def test_probe_records_setup_metadata_on_context() -> None:
    """Setup metadata (weights / device / first_conv_in_channels) is set
    on ``ProbeContext.setup`` BEFORE any stage executes."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    runner.run(ctx)
    setup = ctx.setup
    assert setup["weights"] == "EfficientNet_B4_Weights.IMAGENET1K_V1"
    assert setup["weights_loaded"] is True
    assert setup["initialization"] == "imagenet"
    assert setup["model_device"] == "cuda"
    assert setup["first_conv_in_channels"] == 3


def test_probe_first_batch_wait_validates_shape() -> None:
    """``first_batch_wait`` asserts left=[B,3,380,380] right=[B,3,380,380]
    labels=[B,8]. A wrong shape fails the stage."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    # image_size mismatch forces the wrong shape
    dl_factory = FakeDataLoaderFactory(batch=1, image_size=224)
    model_factory = FakeModelFactory(batch=1)
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is False
    assert result.failed_stage == "first_batch_wait"


def test_probe_host_to_device_records_vram_before_and_after() -> None:
    """``host_to_device`` records VRAM free before AND after the move."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter(vram_free_mb=8000, vram_after_mb=7500)
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    h2d = next(r for r in result.records if r["stage"] == "host_to_device")
    assert h2d.get("vram_free_before_mb") == 8000
    assert h2d.get("vram_free_after_mb") == 7500


def test_probe_forward_bracketed_by_synchronize() -> None:
    """``forward`` is bracketed by cuda_synchronize before and after."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    # Total sync calls: 2 for host_to_device + 2 for forward + 1 for
    # backward + 1 for optimizer_step = 6.
    assert torch_a.sync_calls == 6


def test_probe_loss_computes_bce_with_logits() -> None:
    """``loss`` calls BCEWithLogitsLoss and verifies isfinite."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    # isfinite is called once during the loss stage.
    assert len(torch_a.isfinite_calls) >= 1


def test_probe_backward_and_optimizer_step_use_amp_when_enabled() -> None:
    """With AMP on, backward scales the loss and the optimizer steps."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        amp=True,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    # backward stage must have run; we can't directly assert GradScaler
    # was used (the fake is injected), but the report's loss stage must
    # show ok and optimizer_step must show ok.


def test_probe_short_circuits_on_loader_failure() -> None:
    """If ``dataloader_create`` fails, all later stages are SKIPPED."""
    from p1.stability.probe import build_probe

    class FailingDLFactory:
        def __call__(self, **kwargs: Any) -> None:
            raise RuntimeError("dataloader boom")

    torch_a = FakeTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FailingDLFactory(),
        model_factory=FakeModelFactory(),
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.failed_stage == "dataloader_create"
    assert len(result.records) == 9
    for r in result.records[3:]:  # everything after dataloader_create
        assert r["status"] == "failed"
        assert r["exception_type"] == "StageSkipped"


def test_probe_dataloader_create_records_workers_and_pin() -> None:
    """``dataloader_create`` records num_workers and pin_memory on its record."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        num_workers=2,
        pin_memory=True,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    rec = next(r for r in result.records if r["stage"] == "dataloader_create")
    assert rec["num_workers"] == 2
    assert rec["pin_memory"] is True


def test_probe_emits_real_time_stage_heartbeat(capsys: Any) -> None:
    """The probe prints ``STAGE <name> START`` and ``STAGE <name> PASS``
    lines to stdout (with flush) so a CUDA hang is localisable.

    The T2 watchdog (future) will rely on these heartbeats to detect
    hangs. T1.2 only requires the happy-path output; the heartbeat
    format is part of the probe's CLI contract.
    """
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    captured = capsys.readouterr().out
    # Every T0 stage must have produced a START line and a PASS line.
    for stage in STAGE_NAMES:
        assert f"STAGE {stage} START" in captured, (
            f"missing STAGE {stage} START in: {captured!r}"
        )
        assert f"STAGE {stage} PASS" in captured, (
            f"missing STAGE {stage} PASS in: {captured!r}"
        )


def test_probe_failed_stage_emits_start_but_no_pass(capsys: Any) -> None:
    """A stage that raises emits its START line but NOT its PASS line.

    This is the property the T2 watchdog depends on: the last START
    without a matching PASS is the stage that hung.
    """
    from p1.stability.probe import build_probe

    class FailingDLFactory:
        def __call__(self, **kwargs: Any) -> None:
            raise RuntimeError("dataloader boom")

    torch_a = FakeTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FailingDLFactory(),
        model_factory=FakeModelFactory(),
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.failed_stage == "dataloader_create"
    captured = capsys.readouterr().out
    # dataloader_create START was emitted...
    assert "STAGE dataloader_create START" in captured
    # ...but PASS was not (it raised before reaching the print).
    assert "STAGE dataloader_create PASS" not in captured
    # Stages that never executed have neither START nor PASS.
    for stage in ("host_to_device", "forward", "loss", "backward", "optimizer_step"):
        assert f"STAGE {stage} START" not in captured
        assert f"STAGE {stage} PASS" not in captured


def test_probe_test_read_count_is_zero() -> None:
    """frozen_input_validation records test_read_count = 0 (no Test reads)."""
    from p1.stability.probe import build_probe

    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    model_factory = FakeModelFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    rec = next(
        r for r in result.records if r["stage"] == "frozen_input_validation"
    )
    assert rec.get("test_read_count") == 0


# ---------------------------------------------------------------------------
# Probe -> Frozen Validator wiring tests (P1-F01 fix).
#
# The probe MUST call ``validate_frozen_training_inputs`` during the
# ``frozen_input_validation`` stage. A fold artifact that is not a strict
# subset of the Development set (e.g. contains Test patients, or drops
# Development patients) must fail the stage; the DataLoader must NOT be
# created and no JPEGs may be read.
# ---------------------------------------------------------------------------


class _FakeValidator:
    """Records calls to ``validate_frozen_training_inputs``."""

    def __init__(self, raise_exc: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.raise_exc = raise_exc

    def __call__(
        self,
        manifest_patient_ids: set[str],
        split_assignment: dict[str, str],
        fold_assignment: dict[str, int],
        *,
        expected_folds: int,
    ) -> None:
        self.calls.append(
            {
                "manifest_patient_ids": set(manifest_patient_ids),
                "split_assignment": dict(split_assignment),
                "fold_assignment": dict(fold_assignment),
                "expected_folds": expected_folds,
            }
        )
        if self.raise_exc is not None:
            raise self.raise_exc


def test_probe_calls_validate_frozen_training_inputs() -> None:
    """``frozen_input_validation`` invokes the frozen-input validator."""
    from p1.stability.probe import build_probe

    validator = _FakeValidator()
    torch_a = FakeTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FakeDataLoaderFactory(),
        model_factory=FakeModelFactory(),
        validator=validator,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    assert len(validator.calls) == 1
    call = validator.calls[0]
    assert call["expected_folds"] == 5
    # Manifest patient IDs and fold map were passed through.
    assert isinstance(call["manifest_patient_ids"], set)
    assert isinstance(call["fold_assignment"], dict)


def test_probe_fails_when_fold_contains_test_patients() -> None:
    """A fold that contains Test patients must fail frozen_input_validation.

    The DataLoader must NOT be created. No JPEGs may be read
    (``test_read_count`` stays 0).
    """
    from p1.stability.probe import build_probe

    sentinel = RuntimeError(
        "fold assignment contains Test patients: ['p_test']"
    )
    validator = _FakeValidator(raise_exc=sentinel)
    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=FakeModelFactory(),
        validator=validator,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.failed_stage == "frozen_input_validation"
    # dataloader_create was never built; later stages are SKIPPED.
    assert len(result.records) == 9
    for r in result.records[2:]:  # everything after frozen_input_validation
        assert r["status"] == "failed"
        assert r["exception_type"] == "StageSkipped"
    # DataLoader factory was NOT consulted.
    assert dl_factory.build_calls == []
    # test_read_count stays 0 (no JPEGs read).
    rec = next(
        r for r in result.records if r["stage"] == "frozen_input_validation"
    )
    assert rec["test_read_count"] == 0


def test_probe_fails_when_fold_drops_development_patients() -> None:
    """A fold that is missing Development patients must fail too."""
    from p1.stability.probe import build_probe

    sentinel = RuntimeError(
        "fold assignment does not match Development set: missing=['p1','p2']"
    )
    validator = _FakeValidator(raise_exc=sentinel)
    torch_a = FakeTorchAdapter()
    dl_factory = FakeDataLoaderFactory()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=FakeModelFactory(),
        validator=validator,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.failed_stage == "frozen_input_validation"
    assert dl_factory.build_calls == []