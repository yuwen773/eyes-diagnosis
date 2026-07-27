"""P2-02B receipt dataclasses.

``FoldReceipt`` is written per fold as ``fold_receipt.json``.
``ExperimentReceipt`` aggregates per-fold receipts for the orchestrator
output (P2-03). Both are pure data — no I/O — so they live in their own
module to avoid circular imports between runner and orchestrator.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FoldReceipt:
    schema_version: str = "p2-02b-v1"
    fold: int = 0
    experiment: str = "E3"
    seed: int = 42
    status: str = "PASS"  # 'PASS' | 'BLOCKED' | 'FAILED_PREFLIGHT'
    best_epoch: int = -1
    best_metric: float | None = None
    best_metric_name: str = "validation_macro_auprc"
    total_epochs_run: int = 0
    early_stopped: bool = False
    started_at: str = ""
    finished_at: str = ""
    duration_s: float = 0.0
    config_hash: str = ""
    checkpoint_sha256: str | None = None
    error_class: str | None = None
    error_message: str | None = None
    error_epoch: int | None = None
    error_batch: int | None = None
    frozen_inputs: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "fold": self.fold,
            "experiment": self.experiment,
            "seed": self.seed,
            "status": self.status,
            "best_epoch": self.best_epoch,
            "best_metric": self.best_metric,
            "best_metric_name": self.best_metric_name,
            "total_epochs_run": self.total_epochs_run,
            "early_stopped": self.early_stopped,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_s": self.duration_s,
            "config_hash": self.config_hash,
            "checkpoint_sha256": self.checkpoint_sha256,
            "error_class": self.error_class,
            "error_message": self.error_message,
            "error_epoch": self.error_epoch,
            "error_batch": self.error_batch,
            "frozen_inputs": dict(self.frozen_inputs),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "FoldReceipt":
        return cls(
            schema_version=d.get("schema_version", "p2-02b-v1"),
            fold=int(d.get("fold", 0)),
            experiment=str(d.get("experiment", "E3")),
            seed=int(d.get("seed", 42)),
            status=str(d.get("status", "PASS")),
            best_epoch=int(d.get("best_epoch", -1)),
            best_metric=d.get("best_metric"),
            best_metric_name=str(d.get("best_metric_name", "validation_macro_auprc")),
            total_epochs_run=int(d.get("total_epochs_run", 0)),
            early_stopped=bool(d.get("early_stopped", False)),
            started_at=str(d.get("started_at", "")),
            finished_at=str(d.get("finished_at", "")),
            duration_s=float(d.get("duration_s", 0.0)),
            config_hash=str(d.get("config_hash", "")),
            checkpoint_sha256=d.get("checkpoint_sha256"),
            error_class=d.get("error_class"),
            error_message=d.get("error_message"),
            error_epoch=d.get("error_epoch"),
            error_batch=d.get("error_batch"),
            frozen_inputs=dict(d.get("frozen_inputs", {})),
        )


@dataclass
class ExperimentReceipt:
    schema_version: str = "p2-02b-v1"
    experiment: str = "E3"
    seed: int = 42
    folds_requested: list[int] = field(default_factory=list)
    per_fold: list[FoldReceipt] = field(default_factory=list)
    overall_status: str = "PASS"  # 'PASS' | 'BLOCKED' | 'FAILED_PREFLIGHT'

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "experiment": self.experiment,
            "seed": self.seed,
            "folds_requested": list(self.folds_requested),
            "per_fold": [r.to_dict() for r in self.per_fold],
            "overall_status": self.overall_status,
        }


__all__ = ["FoldReceipt", "ExperimentReceipt"]


def _smoke() -> None:  # pragma: no cover
    """Manual sanity check."""
    r = FoldReceipt(fold=0, best_epoch=3, best_metric=0.42)
    print(r.to_dict())


if __name__ == "__main__":  # pragma: no cover
    _smoke()