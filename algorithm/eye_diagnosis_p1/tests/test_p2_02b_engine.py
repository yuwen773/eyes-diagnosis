"""Tests for algorithm/p1/training/engine.py."""
from __future__ import annotations

from typing import Any

import pytest
import torch
from torch import nn

from eye_diagnosis_p1.tests.fakes import (
    FakeDataLoaderFactory,
    FakeModelFactory,
    FakeOptimizer,
    FakeScaler,
    FakeTorchAdapter,
)


class _Criterion(nn.Module):
    """Returns 0.5 — predictable so tests can assert exact loss values."""

    def forward(self, logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        return torch.tensor(0.5)


def _build_components(*, seed: int = 42, batch_size: int = 2) -> dict[str, Any]:
    """Bundle the fake adapters + model + optim + scaler + criterion + loader."""
    torch_a = FakeTorchAdapter()
    model, _meta = FakeModelFactory(seed=seed)(experiment="E3")
    optimizer = FakeOptimizer(model)
    scaler = FakeScaler(enabled=True)
    criterion = _Criterion()
    loader = FakeDataLoaderFactory(batch_size=batch_size, num_batches=3, num_classes=8)()
    return {
        "torch_a": torch_a, "model": model, "optimizer": optimizer,
        "scaler": scaler, "criterion": criterion, "loader": loader,
    }


def test_train_one_epoch_returns_epoch_stats() -> None:
    from p1.training.engine import EpochStats, train_one_epoch

    c = _build_components()
    stats = train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=True, grad_clip_norm=1.0,
    )
    assert isinstance(stats, EpochStats)
    assert stats.num_batches == 3
    assert stats.num_samples == 6


def test_evaluate_returns_only_macro_auprc_not_per_class() -> None:
    from p1.training.engine import ValStats, evaluate

    c = _build_components()
    stats = evaluate(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        criterion=c["criterion"], device="cpu", threshold=0.5,
    )
    assert isinstance(stats, ValStats)
    d = stats.to_dict()
    # Per-epoch scope: macro_auprc + probs/labels. NO per-class fields.
    # schema_version is included by all P2-02B dataclasses (consistency).
    expected_keys = {"schema_version", "loss", "macro_auprc", "num_batches",
                     "num_samples", "probabilities", "labels"}
    assert set(d.keys()) == expected_keys
    assert "per_class_auprc" not in d


def test_train_one_epoch_enters_autocast_when_amp_true() -> None:
    from p1.training.engine import train_one_epoch

    c = _build_components()
    autocast_calls_before = len(c["torch_a"].autocast_calls)
    train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=True, grad_clip_norm=1.0,
    )
    assert len(c["torch_a"].autocast_calls) - autocast_calls_before >= 3


def test_train_one_epoch_skips_autocast_when_amp_false() -> None:
    from p1.training.engine import train_one_epoch

    c = _build_components()
    autocast_calls_before = len(c["torch_a"].autocast_calls)
    train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=False, grad_clip_norm=None,
    )
    assert len(c["torch_a"].autocast_calls) == autocast_calls_before


def test_train_one_epoch_raises_nan_loss_error_on_nan() -> None:
    from p1.training.engine import NanLossError, train_one_epoch

    c = _build_components(batch_size=2)

    class _NanCriterion(nn.Module):
        def forward(self, logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
            return torch.tensor(float("nan"))

    with pytest.raises(NanLossError):
        train_one_epoch(
            torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
            optimizer=c["optimizer"], scaler=c["scaler"], criterion=_NanCriterion(),
            device="cpu", amp=True, grad_clip_norm=1.0,
        )


def test_train_one_epoch_raises_cuda_oom_error_on_oom() -> None:
    from p1.training.engine import CudaOomError, train_one_epoch

    c = _build_components()

    class _OomOptimizer:
        def __init__(self, real: Any) -> None:
            self.real = real

        def zero_grad(self, set_to_none: bool = True) -> None:
            self.real.zero_grad(set_to_none=set_to_none)

        def step(self) -> None:
            raise RuntimeError("CUDA out of memory. Tried to allocate 1.00 GiB.")

    with pytest.raises(CudaOomError):
        train_one_epoch(
            torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
            optimizer=_OomOptimizer(c["optimizer"]),
            scaler=c["scaler"], criterion=c["criterion"],
            device="cpu", amp=True, grad_clip_norm=1.0,
        )


def test_train_one_epoch_raises_cuda_runtime_error_on_other_cuda_error() -> None:
    from p1.training.engine import CudaRuntimeError, train_one_epoch

    c = _build_components()

    class _CudaFailOptimizer:
        def __init__(self, real: Any) -> None:
            self.real = real

        def zero_grad(self, set_to_none: bool = True) -> None:
            self.real.zero_grad(set_to_none=set_to_none)

        def step(self) -> None:
            raise RuntimeError("CUDA error: device-side assert triggered")

    with pytest.raises(CudaRuntimeError):
        train_one_epoch(
            torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
            optimizer=_CudaFailOptimizer(c["optimizer"]),
            scaler=c["scaler"], criterion=c["criterion"],
            device="cpu", amp=True, grad_clip_norm=1.0,
        )


def test_unscale_called_before_clip_grad_norm() -> None:
    from p1.training.engine import train_one_epoch

    c = _build_components()

    calls: list[str] = []
    orig_unscale = c["scaler"].unscale_
    orig_clip = c["scaler"].clip_grad_norm_

    def _track_unscale(opt: Any) -> None:
        calls.append("unscale_")
        orig_unscale(opt)

    def _track_clip(params: Any, max_norm: Any, *a: Any, **k: Any) -> Any:
        calls.append("clip")
        return orig_clip(params, max_norm, *a, **k)

    c["scaler"].unscale_ = _track_unscale  # type: ignore[assignment]
    c["scaler"].clip_grad_norm_ = _track_clip  # type: ignore[assignment]

    train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=True, grad_clip_norm=1.0,
    )
    assert calls.index("unscale_") < calls.index("clip")
    assert len([x for x in calls if x == "unscale_"]) == 3
    assert len([x for x in calls if x == "clip"]) == 3