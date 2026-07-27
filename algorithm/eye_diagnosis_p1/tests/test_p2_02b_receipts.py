"""Tests for algorithm/p1/training/receipts.py."""
from __future__ import annotations

import pytest

from p1.training.receipts import ExperimentReceipt, FoldReceipt


def _make_pass_fold(fold: int, best_epoch: int = 4, best_metric: float = 0.7) -> FoldReceipt:
    return FoldReceipt(
        schema_version="p2-02b-v1",
        fold=fold, experiment="E3", seed=42,
        status="PASS",
        best_epoch=best_epoch, best_metric=best_metric,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=best_epoch + 1, early_stopped=False,
        started_at="2026-07-27T10:00:00+00:00",
        finished_at="2026-07-27T10:10:00+00:00",
        duration_s=600.0,
        config_hash="abc123", checkpoint_sha256="def456",
        frozen_inputs={"manifest_sha256": "m", "split_assignment_sha256": "s",
                       "fold_assignment_sha256": "f", "image_root_sha256": "i"},
    )


def test_fold_receipt_to_from_dict_roundtrip() -> None:
    r = _make_pass_fold(0)
    d = r.to_dict()
    r2 = FoldReceipt.from_dict(d)
    assert r2.fold == 0
    assert r2.best_epoch == 4
    assert r2.best_metric == pytest.approx(0.7)
    assert r2.frozen_inputs["manifest_sha256"] == "m"


def test_fold_receipt_blocked_preserves_partial_state() -> None:
    r = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=0, experiment="E3", seed=42,
        status="BLOCKED",
        best_epoch=2, best_metric=0.61,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=3, early_stopped=False,
        started_at="t0", finished_at="t1", duration_s=300.0,
        config_hash="abc", checkpoint_sha256=None,
        error_class="cuda_oom",
        error_message="CUDA OOM at epoch 3, batch 47",
        error_epoch=3, error_batch=47,
        frozen_inputs={"manifest_sha256": "x", "split_assignment_sha256": "y",
                       "fold_assignment_sha256": "z", "image_root_sha256": "w"},
    )
    d = r.to_dict()
    assert d["status"] == "BLOCKED"
    assert d["error_class"] == "cuda_oom"
    assert d["error_epoch"] == 3
    assert d["error_batch"] == 47
    assert d["checkpoint_sha256"] is None


def test_experiment_receipt_overall_status_pass_when_all_pass() -> None:
    fold0 = _make_pass_fold(0)
    fold1 = _make_pass_fold(1)
    e = ExperimentReceipt(
        schema_version="p2-02b-v1",
        experiment="E3", seed=42,
        folds_requested=[0, 1],
        per_fold=[fold0, fold1],
        overall_status="PASS",
    )
    assert e.overall_status == "PASS"
    d = e.to_dict()
    assert d["overall_status"] == "PASS"
    assert len(d["per_fold"]) == 2


def test_experiment_receipt_overall_status_blocked_if_any_blocked() -> None:
    fold0 = _make_pass_fold(0)
    fold1 = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=1, experiment="E3", seed=42,
        status="BLOCKED",
        best_epoch=1, best_metric=0.5,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=2, early_stopped=False,
        started_at="t0", finished_at="t1", duration_s=100.0,
        config_hash="c", checkpoint_sha256=None,
        error_class="nan_loss",
        error_message="NaN at batch 3",
        error_epoch=1, error_batch=3,
        frozen_inputs={"manifest_sha256": "m", "split_assignment_sha256": "s",
                       "fold_assignment_sha256": "f", "image_root_sha256": "i"},
    )
    e = ExperimentReceipt(
        schema_version="p2-02b-v1",
        experiment="E3", seed=42,
        folds_requested=[0, 1],
        per_fold=[fold0, fold1],
        overall_status="BLOCKED",
    )
    assert e.overall_status == "BLOCKED"