"""Regression tests for AMP gating in the P2-02A stability probe.

The v2 T3 real-GPU run exposed a second frozen-code defect: the probe's
``amp=True`` flag only built a ``GradScaler(enabled=True)`` but never wrapped
the forward pass in ``torch.autocast``. Cells E (batch=8) and F (batch=8,
workers=2) both OOM'd at ``_stage_forward`` because the EfficientNet-B4 model
ran in fp32 instead of fp16.

Evidence that amp was a no-op:
- benchmark ``run_io_config`` wraps ``model(...)`` and ``criterion(...)`` in
  ``torch.autocast(device_type="cuda", dtype=amp_dtype)``; that run fit
  batch=8 at 5708 MB.
- probe.py has zero ``autocast`` references (grep -n "autocast" probe.py).
- cells A (amp=False) and B (amp=True) in v2 produced identical results,
  proving the amp flag was inert.

These tests assert the probe's ``_stage_forward`` and ``_stage_loss`` enter
autocast(enabled=True) when ``amp=True`` and skip autocast(enabled=True) when
``amp=False``. They are CPU-only — they exercise the probe with a fake
``TorchAdapter`` that records autocast enter/exit events.

References:
- protocol/P2-02A matrix cell A-F amp flag
- p1/benchmark/cuda_runtime.py: build_compute_step L95, run_io_config L201
"""

from __future__ import annotations

from typing import Any

import pytest

from p1.stability.stages import ProbeContext

from eye_diagnosis_p1.tests.test_p2_02a_stability_probe import (
    FakeDataLoaderFactory,
    FakeModelFactory,
    FakeScaledTensor,
    FakeTensor,
)


# ---------------------------------------------------------------------------
# Autocast-recording fake — extends FakeTorchAdapter with autocast()
# ---------------------------------------------------------------------------


class _FakeAutocastContext:
    """Stand-in for the ``torch.autocast`` context manager.

    Records every enter/exit with the kwargs the probe passed. Never
    touches real CUDA, so the test stays CPU-only.
    """

    def __init__(
        self,
        device_type: str,
        dtype: Any,
        enabled: bool,
        events: list[dict[str, Any]],
    ) -> None:
        self.device_type = device_type
        self.dtype = dtype
        self.enabled = enabled
        self.events = events

    def __enter__(self) -> "_FakeAutocastContext":
        self.events.append(
            {"device_type": self.device_type, "dtype": self.dtype, "enabled": self.enabled, "event": "enter"}
        )
        return self

    def __exit__(self, *exc_info: Any) -> bool:
        self.events.append(
            {"device_type": self.device_type, "dtype": self.dtype, "enabled": self.enabled, "event": "exit"}
        )
        return False


class AutocastRecordingTorchAdapter:
    """A FakeTorchAdapter-equivalent that ALSO records autocast calls.

    Inherits the cuda / sync / isfinite / scaler / BCEWithLogitsLoss / float
    surface from the test infra's FakeTorchAdapter (via duck-typing: it
    implements the same methods). Adds ``autocast`` returning a recording
    context manager so the probe's behavior can be asserted.
    """

    def __init__(
        self,
        *,
        vram_free_mb: int = 8000,
        vram_after_mb: int | None = None,
    ) -> None:
        self.vram_free_mb = vram_free_mb
        self.vram_after_mb = vram_after_mb if vram_after_mb is not None else vram_free_mb
        self.sync_calls = 0
        self.isfinite_calls: list[Any] = []
        self.autocast_events: list[dict[str, Any]] = []
        self._vram_call_idx = 0

    # -- cuda / sync / memory (mirror FakeTorchAdapter) ----------------

    def cuda_is_available(self) -> bool:
        return True

    def cuda_device_count(self) -> int:
        return 1

    def cuda_synchronize(self) -> None:
        self.sync_calls += 1

    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]:
        self._vram_call_idx += 1
        mb = self.vram_free_mb if self._vram_call_idx % 2 == 1 else self.vram_after_mb
        return mb * 1024 * 1024, 16 * 1024 * 1024 * 1024

    def isfinite(self, tensor: Any) -> bool:
        self.isfinite_calls.append(tensor)
        return True

    def GradScaler(self, enabled: bool) -> Any:  # noqa: ARG002 — probe decides
        return _NoOpScaler()

    def BCEWithLogitsLoss(self) -> Any:
        return _NoOpLoss()

    def float(self, tensor: Any) -> FakeTensor:
        return FakeTensor(tensor.shape, device=tensor.device, dtype="float32")

    # -- autocast: the new method the probe must use -------------------

    def autocast(
        self,
        device_type: str = "cuda",
        dtype: Any = None,
        enabled: bool = True,
    ) -> _FakeAutocastContext:
        return _FakeAutocastContext(device_type, dtype, enabled, self.autocast_events)


class _NoOpScaler:
    """Stand-in for GradScaler. ``scale(loss)`` returns a FakeScaledTensor so
    the backward stage can complete without touching real CUDA. The
    autocast-focused tests assert probe behavior at the forward/loss
    boundary; they do not depend on real GradScaler semantics."""

    def scale(self, loss: Any) -> FakeScaledTensor:
        return FakeScaledTensor(loss.shape, device="cuda", dtype="float32")

    def step(self, optimizer: Any) -> None:
        return None

    def update(self) -> None:
        return None


class _NoOpLoss:
    def __call__(self, logits: Any, labels: Any) -> FakeTensor:
        return FakeTensor(logits.shape, device="cuda", dtype="float32")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_torch_adapter_protocol_exposes_autocast_method() -> None:
    """TorchAdapter Protocol must declare autocast(device_type, dtype, enabled).

    Regression: v2 run failure analysis showed probe depends on a torch API
    that the protocol didn't declare. The Protocol must list every method the
    probe calls (cuda_synchronize, isfinite, GradScaler, BCEWithLogitsLoss,
    float, autocast).
    """
    from p1.stability.probe import TorchAdapter

    # Protocol methods are declared on the class (they appear in vars()
    # and dir()) but not in __annotations__. We inspect the class namespace.
    declared = set(vars(TorchAdapter).keys()) - {
        "__module__", "__doc__", "__dict__", "__weakref__",
        "__parameters__", "_is_protocol", "__subclasshook__", "__init__",
        "__abstractmethods__", "_abc_impl",
    }
    assert "autocast" in declared, (
        "TorchAdapter protocol must declare autocast; "
        f"declared methods: {sorted(declared)!r}"
    )


def test_probe_forward_enters_autocast_when_amp_enabled() -> None:
    """With amp=True, the probe enters autocast(enabled=True) at least once.

    The forward stage must wrap the model call in autocast so the
    EfficientNet-B4 weights run in fp16, halving the activation VRAM and
    fitting batch=8 in the 8 GB RTX 4060.
    """
    from p1.stability.probe import build_probe

    torch_a = AutocastRecordingTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FakeDataLoaderFactory(batch=1),
        model_factory=FakeModelFactory(batch=1),
        amp=True,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    enters_enabled = [
        e
        for e in torch_a.autocast_events
        if e["event"] == "enter" and e["enabled"] is True
    ]
    assert len(enters_enabled) >= 1, (
        f"amp=True must enter autocast(enabled=True) at least once; "
        f"got events={torch_a.autocast_events!r}"
    )


def test_probe_forward_skips_autocast_when_amp_disabled() -> None:
    """With amp=False, the probe must NOT enter autocast(enabled=True).

    Cells A (amp=False, batch=1) and B (amp=True, batch=1) differ ONLY by
    the amp flag. v2 produced identical records for A and B, proving amp
    was inert. After the fix, A must enter zero autocast contexts.
    """
    from p1.stability.probe import build_probe

    torch_a = AutocastRecordingTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FakeDataLoaderFactory(batch=1),
        model_factory=FakeModelFactory(batch=1),
        amp=False,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    enters_enabled = [
        e
        for e in torch_a.autocast_events
        if e["event"] == "enter" and e["enabled"] is True
    ]
    assert enters_enabled == [], (
        f"amp=False must NOT enter autocast(enabled=True); "
        f"got events={torch_a.autocast_events!r}"
    )


def test_probe_autocast_targets_cuda_device_type() -> None:
    """autocast must target the ``cuda`` device type.

    The RTX 4060 is a CUDA device. Passing device_type='cpu' would
    silently no-op autocast and reproduce the v2 bug.
    """
    from p1.stability.probe import build_probe

    torch_a = AutocastRecordingTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FakeDataLoaderFactory(),
        model_factory=FakeModelFactory(),
        amp=True,
    )
    ctx = ProbeContext()
    runner.run(ctx)
    cuda_enters = [
        e
        for e in torch_a.autocast_events
        if e["event"] == "enter" and e["device_type"] == "cuda"
    ]
    assert cuda_enters, (
        f"autocast must target device_type='cuda'; "
        f"got events={torch_a.autocast_events!r}"
    )


@pytest.mark.parametrize("amp", [True, False])
def test_probe_autocast_events_balance_enter_and_exit(amp: bool) -> None:
    """Every autocast enter must be balanced by a matching exit.

    A leaked context (enter without exit) would silently hold autocast state
    across stages, breaking the ``host_to_device`` move or the next probe
    run. After the fix the count of enters must equal the count of exits.
    """
    from p1.stability.probe import build_probe

    torch_a = AutocastRecordingTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FakeDataLoaderFactory(),
        model_factory=FakeModelFactory(),
        amp=amp,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    n_enter = sum(1 for e in torch_a.autocast_events if e["event"] == "enter")
    n_exit = sum(1 for e in torch_a.autocast_events if e["event"] == "exit")
    assert n_enter == n_exit, (
        f"autocast enter/exit imbalance for amp={amp}: "
        f"enters={n_enter}, exits={n_exit}, events={torch_a.autocast_events!r}"
    )


def test_probe_autocast_wraps_both_forward_and_loss_stages() -> None:
    """The autocast context must cover both forward AND loss stages.

    The benchmark pattern (``p1.benchmark.cuda_runtime.build_compute_step``
    and ``run_io_config``) wraps ``model(...)`` and ``criterion(...)``
    inside ONE ``with torch.autocast(...)`` context so loss is computed in
    fp16 against fp16 logits. Two separate contexts would force a
    fp16→fp32 promotion and inflate activations.

    After the fix, when amp=True, exactly one autocast(enabled=True) enter
    must happen — it covers both stages.
    """
    from p1.stability.probe import build_probe

    torch_a = AutocastRecordingTorchAdapter()
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=FakeDataLoaderFactory(),
        model_factory=FakeModelFactory(),
        amp=True,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    assert result.all_pass is True
    enabled_enters = [
        e
        for e in torch_a.autocast_events
        if e["event"] == "enter" and e["enabled"] is True
    ]
    assert len(enabled_enters) == 1, (
        f"autocast must wrap forward+loss in ONE context (matches benchmark "
        f"pattern); got {len(enabled_enters)} enabled enters: "
        f"{torch_a.autocast_events!r}"
    )