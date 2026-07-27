"""Tests for algorithm/p1/training/orchestrator.py."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from eye_diagnosis_p1.tests.fakes import (
    FakeDataLoaderFactory,
    FakeFoldAssignmentLoader,
    FakeModelFactory,
    FakeTorchAdapter,
)


def _runner_deps(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "torch_adapter": FakeTorchAdapter(),
        "model_factory": FakeModelFactory(seed=42),
        "data_factory": FakeDataLoaderFactory(batch_size=2, num_batches=3, num_classes=8),
        "experiment": "E3", "seed": 42, "max_epochs": 2,
        "patience": 5,
        "cfg": {
            "schema_version": "p2-02a-v1",
            "optimizer": "AdamW", "learning_rate": 0.0001, "weight_decay": 0.0001,
            "max_epochs": 20, "early_stopping_patience": 5,
            "checkpoint_selector": "validation_macro_auprc",
            "loss": "bce_with_logits", "patient_batch": 8,
            "gradient_accumulation": 1, "amp": True, "gradient_clip_norm": 1.0,
            "scheduler": "reduce_on_plateau",
            "scheduler_metric": "validation_macro_auprc",
            "scheduler_factor": 0.5, "scheduler_patience": 2,
            "threshold_policy": "fixed_0.5",
        },
    }
    base.update(kw)
    return base


def test_orchestrator_single_fold_overall_status_pass(tmp_path: Path) -> None:
    from p1.training.orchestrator import run_formal_experiment

    e = run_formal_experiment(
        out_root=tmp_path,
        folds=[0],
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **_runner_deps(),
    )
    assert e.overall_status == "PASS"
    assert e.folds_requested == [0]
    assert len(e.per_fold) == 1
    assert e.per_fold[0].fold == 0


def test_orchestrator_writes_per_fold_artifacts(tmp_path: Path) -> None:
    from p1.training.orchestrator import run_formal_experiment

    e = run_formal_experiment(
        out_root=tmp_path,
        folds=[0],
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **_runner_deps(),
    )
    fold0 = tmp_path / "fold_0"
    assert (fold0 / "fold_receipt.json").exists()
    assert (fold0 / "best_checkpoint.pth").exists()
    assert e.per_fold[0].status == "PASS"


def test_orchestrator_continues_after_blocked_fold(tmp_path: Path) -> None:
    """folds=[0,1] with fold 0 BLOCKED → all folds still ran."""
    from p1.training import formal_fold_runner as fr
    from p1.training.orchestrator import run_formal_experiment

    calls: list[int] = []

    real_run = fr.run_formal_fold

    def _spy(**kw: Any) -> Any:
        calls.append(kw["fold"])
        if kw.get("fold") == 0:
            # Return a BLOCKED-shaped receipt without invoking the real runner.
            from p1.training.receipts import FoldReceipt
            r = FoldReceipt(status="BLOCKED", best_epoch=-1, best_metric=None,
                            error_class="nan_loss", error_message="sim",
                            error_epoch=0, error_batch=0, fold=0,
                            started_at="t0", finished_at="t1", duration_s=0.0,
                            config_hash="c", frozen_inputs={})
            # Also write a fake receipt.json so the experiment loop can read it.
            (kw["out_dir"] / "fold_0").mkdir(parents=True, exist_ok=True)
            from p1.training.formal_fold_runner import _atomic_write_json
            _atomic_write_json(kw["out_dir"] / "fold_0" / "fold_receipt.json", r.to_dict())
            return r
        return real_run(**kw)

    fr.run_formal_fold = _spy  # type: ignore[assignment]
    try:
        e = run_formal_experiment(
            out_root=tmp_path,
            folds=[0, 1, 2],
            manifest_pids={1, 2, 3, 4},
            split_df=FakeFoldAssignmentLoader().load(),
            fold_df=FakeFoldAssignmentLoader().load(),
            **_runner_deps(),
        )
    finally:
        fr.run_formal_fold = real_run  # type: ignore[assignment]

    assert len(calls) == 3
    assert e.overall_status == "BLOCKED"
    assert len(e.per_fold) == 3