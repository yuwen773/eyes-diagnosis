"""P2-02B multi-fold orchestrator.

Wraps ``run_formal_fold`` for each fold in ``folds_requested``. NEVER
short-circuits: every requested fold is run regardless of per-fold BLOCKED
status, so the per-experiment gate (P2-03) can inspect all 5 fold receipts
in one pass.

P2-02B calls with ``folds=[0]``; P2-03 will pass ``folds=[0,1,2,3,4]``.
"""
from __future__ import annotations

import p1.training.formal_fold_runner as _ffr
from pathlib import Path
from typing import Any

import pandas as pd

from p1.training.formal_fold_runner import _atomic_write_json
from p1.training.receipts import ExperimentReceipt


def run_formal_experiment(
    *,
    out_root: Path,
    folds: list[int],
    manifest_pids: set[int],
    split_df: pd.DataFrame,
    fold_df: pd.DataFrame,
    cfg: dict[str, Any],
    torch_adapter: Any,
    model_factory: Any,
    data_factory: Any,
    experiment: str = "E3",
    seed: int = 42,
    max_epochs: int | None = None,
    patience: int | None = None,
) -> ExperimentReceipt:
    """Run ``run_formal_fold`` for every fold in ``folds``; never short-circuit."""
    out_root.mkdir(parents=True, exist_ok=True)
    per_fold = []
    for fold in folds:
        # Use module-attribute lookup so tests can monkey-patch
        # ``formal_fold_runner.run_formal_fold`` and have it propagate.
        r = _ffr.run_formal_fold(
            out_dir=out_root,
            manifest_pids=manifest_pids,
            split_df=split_df,
            fold_df=fold_df,
            cfg=cfg,
            torch_adapter=torch_adapter,
            model_factory=model_factory,
            data_factory=data_factory,
            fold=fold,
            experiment=experiment,
            seed=seed,
            max_epochs=max_epochs,
            patience=patience,
        )
        per_fold.append(r)

    if any(r.status == "BLOCKED" for r in per_fold):
        overall = "BLOCKED"
    elif any(r.status == "FAILED_PREFLIGHT" for r in per_fold):
        overall = "FAILED_PREFLIGHT"
    else:
        overall = "PASS"

    experiment_receipt = ExperimentReceipt(
        schema_version="p2-02b-v1",
        experiment=experiment,
        seed=seed,
        folds_requested=list(folds),
        per_fold=per_fold,
        overall_status=overall,
    )

    # Top-level experiment_receipt.json (always written).
    _atomic_write_json(
        out_root / "experiment_receipt.json",
        experiment_receipt.to_dict(),
    )
    return experiment_receipt


__all__ = ["run_formal_experiment"]