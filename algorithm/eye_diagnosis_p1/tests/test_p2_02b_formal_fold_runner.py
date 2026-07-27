"""Tests for algorithm/p1/training/formal_fold_runner.py."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import torch
from torch import nn

from eye_diagnosis_p1.tests.fakes import (
    FakeDataLoaderFactory,
    FakeFoldAssignmentLoader,
    FakeManifestLoader,
    FakeModelFactory,
    FakeTorchAdapter,
)


# --- helpers (also imported by tests/fakes indirectly via FakeModelFactory) --

def _build_runner_deps(
    *,
    patient_batch: int = 2,
    num_batches: int = 3,
    epochs_to_run: int = 2,
    fold: int = 0,
    experiment: str = "E3",
    seed: int = 42,
    max_epochs: int | None = None,
    patience: int | None = None,
) -> dict[str, Any]:
    return {
        "torch_adapter": FakeTorchAdapter(),
        "model_factory": FakeModelFactory(seed=seed),
        "data_factory": FakeDataLoaderFactory(
            batch_size=patient_batch, num_batches=num_batches, num_classes=8,
        ),
        "cfg": {
            "schema_version": "p2-02a-v1",
            "optimizer": "AdamW", "learning_rate": 0.0001, "weight_decay": 0.0001,
            "max_epochs": 20, "early_stopping_patience": 5,
            "checkpoint_selector": "validation_macro_auprc",
            "loss": "bce_with_logits",
            "patient_batch": patient_batch, "gradient_accumulation": 1,
            "amp": True, "gradient_clip_norm": 1.0,
            "scheduler": "reduce_on_plateau",
            "scheduler_metric": "validation_macro_auprc",
            "scheduler_factor": 0.5, "scheduler_patience": 2,
            "threshold_policy": "fixed_0.5",
        },
        "experiment": experiment,
        "fold": fold,
        "seed": seed,
        "max_epochs": max_epochs if max_epochs is not None else epochs_to_run,
        "patience": patience,
    }


# --- happy path -------------------------------------------------------------


def test_run_formal_fold_writes_all_artifact_files(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)
    receipt = run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )

    fold_dir = tmp_path / "fold_0"
    expected_files = {
        "protocol.json", "environment.json", "training_log.jsonl",
        "best_checkpoint.pth", "best_checkpoint.sha256",
        "validation_predictions.csv", "oof.csv",
        "metrics.json", "fold_receipt.json",
    }
    actual = {p.name for p in fold_dir.iterdir()}
    assert expected_files.issubset(actual), f"missing: {expected_files - actual}"
    assert receipt.status == "PASS"
    assert receipt.best_epoch >= 0
    assert receipt.checkpoint_sha256 is not None
    assert len(receipt.checkpoint_sha256) == 64


def test_run_formal_fold_no_tmp_files_after_success(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    leftover = list(tmp_path.rglob("*.tmp"))
    assert leftover == [], f"tmp files leaked: {leftover}"


def test_run_formal_fold_appends_jsonl_per_epoch(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=3)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    log_path = tmp_path / "fold_0" / "training_log.jsonl"
    rows = [json.loads(line) for line in log_path.read_text().splitlines() if line]
    assert len(rows) == 3
    for i, row in enumerate(rows):
        assert row["schema_version"] == "p2-02b-v1"
        assert row["epoch"] == i
        assert "train_loss" in row
        assert "val_loss" in row
        assert "val_macro_auprc" in row
        assert "lr" in row
        assert "early_stop_counter" in row
        assert "is_best" in row


def test_run_formal_fold_sets_strict_determinism_flags(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=1)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    assert torch.backends.cudnn.deterministic is True
    assert torch.backends.cudnn.benchmark is False


def test_run_formal_fold_writes_metrics_json_with_skipped_classes(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    metrics = json.loads((tmp_path / "fold_0" / "metrics.json").read_text())
    assert metrics["schema_version"] == "p2-02b-v1"
    assert "macro_auprc" in metrics
    assert "skipped_classes" in metrics
    assert isinstance(metrics["skipped_classes"], list)


# --- failure paths ----------------------------------------------------------


def test_run_formal_fold_nan_blocks_no_checkpoint(tmp_path: Path) -> None:
    """Inject NaN-producing model → BLOCKED with error_class='nan_loss'."""
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=3)
    deps["model_factory"] = _NanModelFactory()  # type: ignore[assignment]

    receipt = run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    assert receipt.status == "BLOCKED"
    assert receipt.error_class == "nan_loss"
    assert receipt.error_epoch is not None
    assert receipt.checkpoint_sha256 is None
    # Fold receipt must still exist.
    receipt_path = tmp_path / "fold_0" / "fold_receipt.json"
    assert receipt_path.exists()


def test_run_formal_fold_oom_blocks(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=3)
    deps["model_factory"] = _OomModelFactory()  # type: ignore[assignment]

    receipt = run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    assert receipt.status == "BLOCKED"
    assert receipt.error_class == "cuda_oom"


def test_run_formal_fold_checkpoint_io_failure_blocks(tmp_path: Path) -> None:
    """Disk-full on checkpoint write → BLOCKED with error_class='checkpoint_io'."""
    from p1.training import checkpoint as ckpt_mod
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)

    def _raise(*_a: Any, **_k: Any) -> None:
        raise OSError("disk full")

    # Patch the lower-level _atomic_write_torch so save_checkpoint's own
    # try/except can wrap the OSError into CheckpointError. Patching
    # save_checkpoint directly would bypass the wrapping and the runner
    # wouldn't see a CheckpointError to catch.
    original_aio = ckpt_mod._atomic_write_torch
    ckpt_mod._atomic_write_torch = _raise  # type: ignore[assignment]
    try:
        receipt = run_formal_fold(
            out_dir=tmp_path,
            manifest_pids={1, 2, 3, 4},
            split_df=FakeFoldAssignmentLoader().load(),
            fold_df=FakeFoldAssignmentLoader().load(),
            **deps,
        )
    finally:
        ckpt_mod._atomic_write_torch = original_aio  # type: ignore[assignment]

    assert receipt.status == "BLOCKED"
    assert receipt.error_class == "checkpoint_io"
    # No checkpoint left behind.
    assert not (tmp_path / "fold_0" / "best_checkpoint.pth").exists()


# --- fakes (NaN / OOM injectors live here, NOT in tests/fakes/) ----------


class _NanModelFactory:
    """Returns a model that produces NaN logits → triggers NanLossError."""

    def __call__(self, *, experiment: str, weights: str = "", device: str = "cpu"):
        model = _NanModel()
        if device == "cuda":
            model = model.to("cuda")
        meta = {"experiment": experiment, "weights": weights, "device": device}
        return model, meta


class _NanModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        # One real parameter so torch.optim.AdamW accepts model.parameters().
        self.dummy = nn.Parameter(torch.zeros(1))

    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        out = torch.zeros(left.shape[0], 8, device=left.device)
        out[:, 0] = float("nan")
        return out


class _OomModelFactory:
    """Returns a model that raises CUDA OOM in forward."""

    def __call__(self, *, experiment: str, weights: str = "", device: str = "cpu"):
        model = _OomModel()
        if device == "cuda":
            model = model.to("cuda")
        meta = {"experiment": experiment, "weights": weights, "device": device}
        return model, meta


class _OomModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        # One real parameter so torch.optim.AdamW accepts model.parameters().
        self.dummy = nn.Parameter(torch.zeros(1))

    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        raise RuntimeError("CUDA out of memory. Tried to allocate 1.00 GiB.")