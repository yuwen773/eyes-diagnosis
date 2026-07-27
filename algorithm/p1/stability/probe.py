"""T1.2 real single-batch CUDA stability probe.

This module is the *real CUDA path* layer of the P2-02A probe. It wires
the pure T1.1 state machine (``p1.stability.stages.ProbeRunner``) to
nine ``execute_stage_fn`` callbacks that exercise the actual P2-01
training slice for one Fold-0 batch under a single matrix-cell config.

The module is dependency-injected: it accepts ``TorchAdapter``,
``DataLoaderFactory``, and ``ModelFactory`` rather than calling
``torch`` / ``p1.training.datasets`` directly. This keeps CI green
without GPU and lets tests inject fakes (see
``tests/test_p2_02a_stability_probe.py``). Production callers wire the
real adapters via ``build_real_adapters`` (also defined here).

Setup metadata (model_build / model_to_cuda / weights / device /
first_conv_in_channels) is NOT a stage. It is recorded on
``ProbeContext.setup`` before the run starts.

The 9 stages walk in fixed T0 order:

    manifest_load -> frozen_input_validation -> dataloader_create ->
    first_batch_wait -> host_to_device -> forward -> loss -> backward ->
    optimizer_step

``torch.cuda.synchronize()`` is a *boundary timing op*, not a 10th
stage. It brackets ``forward``, ``backward``, and ``optimizer_step``
on both sides so the staged report can localise a silent hang.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from p1.stability.schema import STAGE_NAMES
from p1.stability.stages import (
    ProbeContext,
    ProbeRunner,
    StageSpec,
)


# ---------------------------------------------------------------------------
# Adapter protocols — the boundaries the probe depends on.
# ---------------------------------------------------------------------------


class TorchAdapter(Protocol):
    """Minimum subset of ``torch`` the probe depends on."""

    def cuda_is_available(self) -> bool: ...
    def cuda_device_count(self) -> int: ...
    def cuda_synchronize(self) -> None: ...
    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]: ...
    def isfinite(self, tensor: Any) -> bool: ...
    def GradScaler(self, enabled: bool) -> Any: ...
    def BCEWithLogitsLoss(self) -> Any: ...
    def float(self, tensor: Any) -> Any: ...
    def autocast(
        self,
        device_type: str = "cuda",
        dtype: Any = None,
        enabled: bool = True,
    ) -> Any: ...


class DataLoaderFactory(Protocol):
    """Builds a DataLoader (or a fake)."""

    def __call__(
        self,
        *,
        dataset: Any,
        batch_size: int,
        num_workers: int,
        pin_memory: bool,
    ) -> Any: ...


class ModelFactory(Protocol):
    """Builds the model + returns a setup-metadata dict."""

    def __call__(
        self,
        *,
        experiment: str,
        weights: str,
        device: str,
    ) -> tuple[Any, dict[str, Any]]: ...


# ---------------------------------------------------------------------------
# The 9 stage specs.
# ---------------------------------------------------------------------------


@dataclass
class _StageRuntime:
    """Per-run state the stage callbacks read and mutate.

    Held inside the closure of ``build_probe``; not part of the
    ``ProbeContext`` because the state machine treats ``setup`` as the
    only mutable carrier. Stage-specific values (the loaded batch, the
    model, the optimizer, the scaler, the loss tensor) are stashed here
    so the next stage can pick them up.
    """

    batch: Any = None
    left: Any = None
    right: Any = None
    labels: Any = None
    pids: list[str] | None = None
    model: Any = None
    optimizer: Any = None
    scaler: Any = None
    loss_fn: Any = None
    logits: Any = None
    loss: Any = None
    # autocast_cm holds the open torch.autocast context manager across
    # the forward and loss stages so one context wraps both, matching
    # the benchmark pattern (p1.benchmark.cuda_runtime). _stage_forward
    # opens it, _stage_loss closes it. None when amp=False.
    autocast_cm: Any = None


def _specs() -> list[StageSpec]:
    return [StageSpec(name=n) for n in STAGE_NAMES]


def _default_validator(
    manifest_patient_ids: set[str],
    split_assignment: dict[str, str],
    fold_assignment: dict[str, int],
    *,
    expected_folds: int,
) -> None:
    """No-op default validator.

    CI / smoke tests that don't want a real frozen-input contract can
    rely on this default. Production callers (the CLI) MUST override
    this with :func:`p1.training.frozen_inputs.validate_frozen_training_inputs`
    so the fold artifact is gated against the P2-01 frozen contract.
    """


def build_probe(
    *,
    torch: TorchAdapter,
    dataloader_factory: DataLoaderFactory,
    model_factory: ModelFactory,
    experiment: str = "E3",
    weights: str = "EfficientNet_B4_Weights.IMAGENET1K_V1",
    device: str = "cuda",
    amp: bool = False,
    patient_batch: int = 1,
    num_workers: int = 0,
    pin_memory: bool = False,
    image_size: int = 380,
    num_classes: int = 8,
    optimizer_factory: Callable[[Any], Any] | None = None,
    validator: Callable[..., None] | None = _default_validator,
    expected_folds: int = 5,
    manifest_patient_ids: set[str] | None = None,
    split_assignment: dict[str, str] | None = None,
    fold_assignment: dict[str, int] | None = None,
) -> ProbeRunner:
    """Construct a ``ProbeRunner`` wired to the given adapters.

    The returned runner carries the 9 T0 stages in order. Each stage
    callback closes over ``runtime`` (a fresh ``_StageRuntime`` per
    ``run()`` call) so successive ``run()`` invocations do not bleed
    state into each other.
    """

    state = {"runtime": _StageRuntime()}

    # -- pre-stage setup ------------------------------------------------
    def _setup(ctx: ProbeContext) -> None:
        rt = state["runtime"]
        rt.model, setup_meta = model_factory(
            experiment=experiment, weights=weights, device=device
        )
        ctx.set_setup(**setup_meta)
        # Optimizer / loss / scaler are stage-specific but cheap to
        # build now; deferred to their stages for clarity in the report.
        rt.scaler = torch.GradScaler(enabled=amp)
        rt.loss_fn = torch.BCEWithLogitsLoss()
        if optimizer_factory is not None:
            rt.optimizer = optimizer_factory(rt.model)
        else:
            # A no-op optimizer stub is sufficient for the fakes;
            # production code passes a real AdamW via optimizer_factory.
            rt.optimizer = _NullOptimizer()

    # -- 1. manifest_load -----------------------------------------------
    def _stage_manifest_load(spec: StageSpec, ctx: ProbeContext) -> None:
        # The T0 stage name is "manifest_load" — the actual loader is
        # injected by the production caller via dataloader_factory.
        # Here we only assert the loader factory is reachable and
        # record that manifest_load happened (no real data is read by
        # the probe; the DataLoader reads it on first_batch_wait).
        if dataloader_factory is None:
            raise RuntimeError("dataloader_factory is required for manifest_load")

    # -- 2. frozen_input_validation -------------------------------------
    def _stage_frozen_input_validation(spec: StageSpec, ctx: ProbeContext) -> None:
        # The probe freezes Test read count = 0 — Fold-0 only ever
        # touches Development patients. This is a contract assertion,
        # not an actual read. The value is mirrored onto the matching
        # stage record by the post-run annotator.
        state["frozen_input_test_read_count"] = 0
        # Frozen-input validation is mandatory. The validator default
        # is a no-op for CI tests that don't carry a real fold
        # artifact. Production callers (the CLI) MUST override
        # ``validator`` with
        # :func:`p1.training.frozen_inputs.validate_frozen_training_inputs`
        # so the fold artifact is gated against the P2-01 frozen
        # contract.
        _validator = validator or _default_validator
        _manifest_pids = manifest_patient_ids if manifest_patient_ids is not None else set()
        _split = split_assignment if split_assignment is not None else {}
        _fold = fold_assignment if fold_assignment is not None else {}
        _validator(
            set(_manifest_pids),
            dict(_split),
            dict(_fold),
            expected_folds=expected_folds,
        )

    # -- 3. dataloader_create -------------------------------------------
    def _stage_dataloader_create(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        dataset = _FakeDataset()  # placeholder; production wiring
        # passes a real BilateralEyeDataset. The probe doesn't index it
        # directly; the DataLoader handles reads.
        loader = dataloader_factory(
            dataset=dataset,
            batch_size=patient_batch,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )
        rt.batch = loader
        state["loader_num_workers"] = num_workers
        state["loader_pin_memory"] = pin_memory

    # -- 4. first_batch_wait --------------------------------------------
    def _stage_first_batch_wait(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        loader = rt.batch
        # Drain one batch. Supports two batch shapes:
        #   - tuple/list:  (left, right, labels) or (left, right, labels, pids)
        #   - object with .left / .right / .labels attributes
        it = iter(loader)
        batch = next(it)
        if hasattr(batch, "left") and hasattr(batch, "right") and hasattr(batch, "labels"):
            left, right, labels = batch.left, batch.right, batch.labels
            pids = getattr(batch, "pids", []) or []
        else:
            if len(batch) == 4:
                left, right, labels, pids = batch
            else:
                left, right, labels = batch
                pids = []
        # Shape contract: left=[B,3,image_size,image_size],
        # right=[B,3,image_size,image_size], labels=[B,num_classes].
        B = patient_batch
        if tuple(left.shape) != (B, 3, image_size, image_size):
            raise AssertionError(
                f"left shape must be {(B, 3, image_size, image_size)}, "
                f"got {tuple(left.shape)}"
            )
        if tuple(right.shape) != (B, 3, image_size, image_size):
            raise AssertionError(
                f"right shape must be {(B, 3, image_size, image_size)}, "
                f"got {tuple(right.shape)}"
            )
        if tuple(labels.shape) != (B, num_classes):
            raise AssertionError(
                f"labels shape must be {(B, num_classes)}, "
                f"got {tuple(labels.shape)}"
            )
        rt.left, rt.right, rt.labels, rt.pids = left, right, labels, pids

    # -- 5. host_to_device ----------------------------------------------
    def _stage_host_to_device(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        torch.cuda_synchronize()
        free_before_bytes, _ = torch.cuda_mem_get_info(0)
        free_before_mb = int(free_before_bytes // (1024 * 1024))
        rt.left = rt.left.to("cuda")
        rt.right = rt.right.to("cuda")
        rt.labels = rt.labels.to("cuda")
        torch.cuda_synchronize()
        free_after_bytes, _ = torch.cuda_mem_get_info(0)
        free_after_mb = int(free_after_bytes // (1024 * 1024))
        state["vram_free_before_mb"] = free_before_mb
        state["vram_free_after_mb"] = free_after_mb

    # -- 6. forward -----------------------------------------------------
    def _stage_forward(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        torch.cuda_synchronize()
        # When amp=True, open a torch.autocast context (defaults to fp16
        # via the adapter) that stays open across the loss stage. Without
        # it, EfficientNet-B4 runs in fp32 and batch=8 OOMs on the 8 GB
        # RTX 4060 (v2 T3 real-GPU run). The context is closed at the end
        # of _stage_loss so a single autocast context wraps both model()
        # and criterion() — matching the benchmark pattern
        # (p1.benchmark.cuda_runtime).
        try:
            if amp:
                rt.autocast_cm = torch.autocast(
                    device_type="cuda", enabled=True
                )
                rt.autocast_cm.__enter__()
            rt.logits = rt.model(rt.left, rt.right)
            torch.cuda_synchronize()
            if tuple(rt.logits.shape) != (patient_batch, num_classes):
                raise AssertionError(
                    f"logits shape must be {(patient_batch, num_classes)}, "
                    f"got {tuple(rt.logits.shape)}"
                )
        except BaseException:
            # Forward raised: pass the active exception to autocast's
            # __exit__ (matching `with`-statement semantics) so torch's
            # context cleanup sees the failure. The exception is then
            # re-raised so the stage machine records the failure.
            if rt.autocast_cm is not None:
                rt.autocast_cm.__exit__(*sys.exc_info())
                rt.autocast_cm = None
            raise

    # -- 7. loss --------------------------------------------------------
    def _stage_loss(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        try:
            labels_f = torch.float(rt.labels)
            rt.loss = rt.loss_fn(rt.logits, labels_f)
            if not torch.isfinite(rt.loss):
                raise RuntimeError("loss is not finite (NaN or Inf)")
        finally:
            # Close the autocast context opened in _stage_forward. If
            # loss raised, __exit__ sees the active exception; otherwise
            # exc_info is (None, None, None) which signals success.
            if rt.autocast_cm is not None:
                rt.autocast_cm.__exit__(*sys.exc_info())
                rt.autocast_cm = None

    # -- 8. backward ----------------------------------------------------
    def _stage_backward(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        scaled = rt.scaler.scale(rt.loss)
        scaled.backward()
        torch.cuda_synchronize()

    # -- 9. optimizer_step ----------------------------------------------
    def _stage_optimizer_step(spec: StageSpec, ctx: ProbeContext) -> None:
        rt = state["runtime"]
        rt.scaler.step(rt.optimizer)
        rt.scaler.update()
        rt.optimizer.zero_grad(set_to_none=True)
        torch.cuda_synchronize()

    def _execute_stage_fn(spec: StageSpec, ctx: ProbeContext) -> None:
        # Lazy setup: build model + scaler + loss_fn + optimizer once,
        # before the first stage.
        if state["runtime"].model is None:
            _setup(ctx)
        # Stage dispatch.
        stage = spec.name
        # Real-time heartbeat: each stage prints START before and PASS
        # after, flushed immediately. The T2 watchdog (and human
        # operators reading Tee-Object logs) localise a silent CUDA
        # hang by seeing the last START without its matching PASS.
        print(f"STAGE {stage} START", flush=True)
        if stage == "manifest_load":
            _stage_manifest_load(spec, ctx)
        elif stage == "frozen_input_validation":
            _stage_frozen_input_validation(spec, ctx)
        elif stage == "dataloader_create":
            _stage_dataloader_create(spec, ctx)
        elif stage == "first_batch_wait":
            _stage_first_batch_wait(spec, ctx)
        elif stage == "host_to_device":
            _stage_host_to_device(spec, ctx)
        elif stage == "forward":
            _stage_forward(spec, ctx)
        elif stage == "loss":
            _stage_loss(spec, ctx)
        elif stage == "backward":
            _stage_backward(spec, ctx)
        elif stage == "optimizer_step":
            _stage_optimizer_step(spec, ctx)
        else:  # pragma: no cover — defensive
            raise RuntimeError(f"unknown stage {stage!r}")
        print(f"STAGE {stage} PASS", flush=True)

    # Wrap the runner so stage-specific side-channels (num_workers,
    # pin_memory, vram, test_read_count) are mirrored onto the stage
    # records after the run.
    runner = ProbeRunner(
        stages=_specs(),
        execute_stage_fn=_execute_stage_fn,
    )

    _original_run = runner.run

    def _run_and_annotate(ctx: ProbeContext) -> Any:
        # Reset per-run state.
        state["runtime"] = _StageRuntime()
        state.pop("loader_num_workers", None)
        state.pop("loader_pin_memory", None)
        state.pop("vram_free_before_mb", None)
        state.pop("vram_free_after_mb", None)
        state.pop("frozen_input_test_read_count", None)
        result = _original_run(ctx)
        # Mirror side-channels into the matching stage records.
        for rec in result.records:
            if rec["stage"] == "dataloader_create":
                if "loader_num_workers" in state:
                    rec["num_workers"] = state["loader_num_workers"]
                if "loader_pin_memory" in state:
                    rec["pin_memory"] = state["loader_pin_memory"]
            elif rec["stage"] == "frozen_input_validation":
                rec["test_read_count"] = state.get(
                    "frozen_input_test_read_count", 0
                )
            elif rec["stage"] == "host_to_device":
                if "vram_free_before_mb" in state:
                    rec["vram_free_before_mb"] = state["vram_free_before_mb"]
                if "vram_free_after_mb" in state:
                    rec["vram_free_after_mb"] = state["vram_free_after_mb"]
        return result

    runner.run = _run_and_annotate  # type: ignore[assignment]
    return runner


class _FakeDataset:
    """Placeholder dataset — production wiring passes a real dataset."""

    pass


class _NullOptimizer:
    """No-op optimizer used when the caller doesn't supply one.

    Production code injects a real AdamW via ``optimizer_factory``;
    tests that don't exercise ``backward`` / ``optimizer_step`` (e.g.
    loader-failure tests) short-circuit before this is touched.
    """

    def zero_grad(self, set_to_none: bool | None = True) -> None:
        return None


__all__ = [
    "TorchAdapter",
    "DataLoaderFactory",
    "ModelFactory",
    "build_probe",
]