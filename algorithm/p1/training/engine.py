"""P2-02B training engine — epoch-level pure functions.

``train_one_epoch`` and ``evaluate`` accept an injected ``TorchAdapter`` and
DI'd model/optimizer/criterion/scaler/loader; they do **no** I/O beyond
forward/backward/optimizer and torch CUDA sync. The runner owns
checkpoint save, JSONL append, and report writing.

Custom exceptions form the bridge between engine and runner:
    * ``NanLossError`` — non-finite loss detected after forward; raised
      BEFORE backward so a poisoned gradient cannot leak into later steps.
    * ``CudaOomError`` — CUDA OOM in any step; caught via the shared
      ``is_oom_error`` matcher from ``p1.benchmark.compute``.
    * ``CudaRuntimeError`` — other CUDA-flavored ``RuntimeError``.

Grad clip order under AMP matches the benchmark pattern: scaler.unscale_
must run BEFORE scaler.clip_grad_norm_, otherwise clip operates on
unscaled gradients which produces wrong results.
"""
from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import torch

from p1.benchmark.compute import is_oom_error


# --- custom exceptions ------------------------------------------------------


class NanLossError(RuntimeError):
    """Loss is NaN or Inf. Raised BEFORE backward to prevent gradient poisoning."""

    def __init__(self, epoch: int, batch_idx: int) -> None:
        super().__init__(f"NaN/Inf loss at epoch={epoch}, batch={batch_idx}")
        self.epoch = epoch
        self.batch_idx = batch_idx


class CudaOomError(RuntimeError):
    """CUDA out-of-memory. Translated from any OOM-like exception."""

    def __init__(self, op: str, epoch: int, batch_idx: int, original: Exception) -> None:
        super().__init__(f"CUDA OOM in {op} at epoch={epoch}, batch={batch_idx}: {original}")
        self.op = op
        self.epoch = epoch
        self.batch_idx = batch_idx
        self.original = original


class CudaRuntimeError(RuntimeError):
    """Other CUDA-flavored RuntimeError. Translated from non-OOM CUDA failures."""

    def __init__(self, op: str, epoch: int, batch_idx: int, original: Exception) -> None:
        super().__init__(f"CUDA runtime error in {op} at epoch={epoch}, batch={batch_idx}: {original}")
        self.op = op
        self.epoch = epoch
        self.batch_idx = batch_idx
        self.original = original


# --- dataclasses -------------------------------------------------------------


@dataclass
class EpochStats:
    schema_version: str = "p2-02b-v1"
    loss: float = 0.0
    num_batches: int = 0
    num_samples: int = 0
    gpu_step_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "loss": self.loss, "num_batches": self.num_batches,
            "num_samples": self.num_samples, "gpu_step_ms": self.gpu_step_ms,
        }


@dataclass
class ValStats:
    schema_version: str = "p2-02b-v1"
    loss: float = 0.0
    macro_auprc: float = 0.0
    num_batches: int = 0
    num_samples: int = 0
    probabilities: list[list[float]] = field(default_factory=list)
    labels: list[list[float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "loss": self.loss, "macro_auprc": self.macro_auprc,
            "num_batches": self.num_batches, "num_samples": self.num_samples,
            "probabilities": list(self.probabilities),
            "labels": list(self.labels),
        }


# --- helpers ----------------------------------------------------------------


def _stack_left_right(batch: Any) -> tuple[Any, Any, Any]:
    """Normalize a batch from any DataLoader shape into (left, right, labels).

    Supports:
        * 3-list / 3-tuple / 4-tuple (with optional ``cpu_ms``)
        * Object with ``left`` / ``right`` / ``labels`` attributes (FakeBilateralBatch)
    """
    if isinstance(batch, (list, tuple)) and not hasattr(batch, "left"):
        if len(batch) == 3:
            left, right, labels = batch[0], batch[1], batch[2]
        elif len(batch) == 4:
            left, right, labels, _cpu_ms = batch
        else:
            raise RuntimeError(
                f"unexpected batch shape: type={type(batch).__name__} len={len(batch)}"
            )
    elif hasattr(batch, "left") and hasattr(batch, "right") and hasattr(batch, "labels"):
        left, right, labels = batch.left, batch.right, batch.labels
    else:
        raise RuntimeError(
            f"unexpected batch shape: type={type(batch).__name__}"
        )
    return left, right, labels


def _to_device(t: Any, device: str) -> Any:
    """Move a tensor (real or FakeTensor) to ``device``."""
    if hasattr(t, "to"):
        return t.to(device)
    return t


def _isfinite(torch_adapter: Any, value: Any) -> bool:
    """Adapter-aware isfinite. Falls back to math.isfinite on plain Python numbers."""
    if hasattr(torch_adapter, "isfinite"):
        try:
            return bool(torch_adapter.isfinite(value))
        except Exception:
            pass
    import math
    return math.isfinite(float(value))


# --- public entry points -----------------------------------------------------


def train_one_epoch(
    *,
    torch_adapter: Any,
    model: Any,
    loader: Any,
    optimizer: Any,
    scaler: Any,
    criterion: Any,
    device: str,
    amp: bool,
    grad_clip_norm: float | None,
) -> EpochStats:
    """One pass over ``loader``. Returns aggregate stats. No I/O."""
    total_loss = 0.0
    num_batches = 0
    num_samples = 0
    t_total = 0.0

    for batch_idx, batch in enumerate(loader):
        left, right, labels = _stack_left_right(batch)
        left = _to_device(left, device)
        right = _to_device(right, device)
        labels = _to_device(labels, device)
        num_samples += int(getattr(labels, "shape", [1])[0])

        optimizer.zero_grad(set_to_none=True)

        autocast_ctx = None
        if amp:
            autocast_ctx = torch_adapter.autocast(
                device_type="cuda", enabled=True
            )
            autocast_ctx.__enter__()
        try:
            logits = model(left, right)
            loss = criterion(logits, labels.float() if hasattr(labels, "float") else labels)
        finally:
            if autocast_ctx is not None:
                autocast_ctx.__exit__(*sys.exc_info())

        # NaN check BEFORE backward — a NaN loss would poison gradients.
        if not _isfinite(torch_adapter, getattr(loss, "item", lambda: loss)()):
            raise NanLossError(epoch=0, batch_idx=batch_idx)

        t0 = time.perf_counter()
        try:
            scaler.scale(loss).backward()
            if amp and grad_clip_norm is not None:
                scaler.unscale_(optimizer)
                scaler.clip_grad_norm_(model.parameters(), grad_clip_norm)
            scaler.step(optimizer)
            scaler.update()
        except Exception as exc:
            if is_oom_error(exc):
                raise CudaOomError(
                    op="backward", epoch=0, batch_idx=batch_idx, original=exc,
                ) from exc
            if isinstance(exc, RuntimeError) and (
                "cuda" in str(exc).lower()
                or "cublas" in str(exc).lower()
                or "cudnn" in str(exc).lower()
            ):
                raise CudaRuntimeError(
                    op="backward", epoch=0, batch_idx=batch_idx, original=exc,
                ) from exc
            raise
        torch_adapter.cuda_synchronize()
        t_total += time.perf_counter() - t0

        loss_val = float(loss.item()) if hasattr(loss, "item") else float(loss)
        total_loss += loss_val
        num_batches += 1

    gpu_step_ms = (t_total / num_batches * 1000.0) if num_batches else 0.0
    return EpochStats(
        loss=(total_loss / num_batches) if num_batches else 0.0,
        num_batches=num_batches,
        num_samples=num_samples,
        gpu_step_ms=gpu_step_ms,
    )


def evaluate(
    *,
    torch_adapter: Any,
    model: Any,
    loader: Any,
    criterion: Any,
    device: str,
    threshold: float = 0.5,
) -> ValStats:
    """Full validation pass. Per-epoch scope: macro_auprc + probs/labels.

    Per spec §7.3, per-epoch ValStats carries ``{loss, macro_auprc, num_batches,
    num_samples, probabilities, labels}`` — NOT per-class. The full per-class
    set is computed once in post-loop by ``compute_full_metrics`` from the
    saved probs/labels.
    """
    import numpy as np
    from sklearn.metrics import average_precision_score

    total_loss = 0.0
    num_batches = 0
    num_samples = 0
    all_probs: list[list[float]] = []
    all_labels: list[list[float]] = []

    model.eval()
    with torch.no_grad():
        for batch in loader:
            left, right, labels = _stack_left_right(batch)
            left = _to_device(left, device)
            right = _to_device(right, device)
            labels = _to_device(labels, device)
            num_samples += int(getattr(labels, "shape", [1])[0])

            autocast_ctx = None
            if torch_adapter is not None:
                autocast_ctx = torch_adapter.autocast(
                    device_type="cuda", enabled=True
                )
                autocast_ctx.__enter__()
            try:
                logits = model(left, right)
                loss = criterion(logits, labels.float() if hasattr(labels, "float") else labels)
                probs = _sigmoid(logits)
                probs_cpu = probs.detach().cpu() if hasattr(probs, "detach") else probs
            finally:
                if autocast_ctx is not None:
                    autocast_ctx.__exit__(*sys.exc_info())

            loss_val = float(loss.item()) if hasattr(loss, "item") else float(loss)
            total_loss += loss_val
            num_batches += 1
            if hasattr(probs_cpu, "tolist"):
                all_probs.extend(probs_cpu.tolist())
            else:
                # FakeTensor — synthesize a probs list of zeros matching labels shape
                shape = getattr(probs_cpu, "shape", (1, 1))
                cols = shape[-1] if shape else 1
                all_probs.extend([[0.0] * cols for _ in range(shape[0] if shape else 1)])
            if hasattr(labels, "detach"):
                all_labels.extend(labels.detach().cpu().tolist())
            else:
                shape = getattr(labels, "shape", (1, 1))
                cols = shape[-1] if shape else 1
                all_labels.extend([[0.0] * cols for _ in range(shape[0] if shape else 1)])

    y_true = np.asarray(all_labels, dtype=np.float64)
    y_proba = np.asarray(all_probs, dtype=np.float64)
    ap_values: list[float] = []
    ndim = y_true.ndim
    if ndim == 1:
        cols = [0]
    else:
        cols = list(range(y_true.shape[1])) if y_true.size else []
    for c in cols:
        col_true = y_true if ndim == 1 else y_true[:, c]
        col_proba = y_proba if ndim == 1 else y_proba[:, c]
        if col_true.sum() == 0:
            continue
        ap_values.append(float(average_precision_score(col_true, col_proba)))
    macro_auprc = float(np.mean(ap_values)) if ap_values else 0.0

    return ValStats(
        loss=(total_loss / num_batches) if num_batches else 0.0,
        macro_auprc=macro_auprc,
        num_batches=num_batches,
        num_samples=num_samples,
        probabilities=all_probs,
        labels=all_labels,
    )


def _sigmoid(x: Any) -> Any:
    """torch.sigmoid if torch is real; otherwise returns x (FakeTensor)."""
    try:
        import torch as _torch
        return _torch.sigmoid(x)
    except Exception:
        return x


__all__ = [
    "NanLossError",
    "CudaOomError",
    "CudaRuntimeError",
    "EpochStats",
    "ValStats",
    "train_one_epoch",
    "evaluate",
]