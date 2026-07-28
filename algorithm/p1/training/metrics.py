"""P2-02B validation metrics — full multi-label set with skip-empty-class rule.

Locked for round 1:
    * Threshold = 0.5 (frozen ``threshold_policy: fixed_0.5``).
    * Classes with ``sum(y_true[:, c]) == 0`` are skipped for AUPRC/AUROC;
      their per-class values are ``None`` and ``skipped_classes`` records
      the index. Macro is the unweighted mean of remaining classes.
    * Precision/Recall/F1 at the threshold are computed for every class
      (no skip — denominators are non-zero even when positives == 0).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


@dataclass
class MetricsDict:
    """All metrics for a single validation pass. JSON-serializable via ``to_dict``."""

    schema_version: str = "p2-02b-v1"
    num_samples: int = 0
    threshold: float = 0.5

    macro_auprc: float = 0.0
    micro_auprc: float = 0.0
    macro_auroc: float = 0.0
    micro_auroc: float = 0.0
    macro_f1: float = 0.0
    micro_f1: float = 0.0

    per_class_auprc: list[float | None] = field(default_factory=list)
    per_class_auroc: list[float | None] = field(default_factory=list)
    per_class_precision: list[float] = field(default_factory=list)
    per_class_recall: list[float] = field(default_factory=list)
    per_class_f1: list[float] = field(default_factory=list)
    per_class_support_pos: list[int] = field(default_factory=list)
    per_class_support_neg: list[int] = field(default_factory=list)
    skipped_classes: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "num_samples": self.num_samples,
            "threshold": self.threshold,
            "macro_auprc": self.macro_auprc,
            "micro_auprc": self.micro_auprc,
            "macro_auroc": self.macro_auroc,
            "micro_auroc": self.micro_auroc,
            "macro_f1": self.macro_f1,
            "micro_f1": self.micro_f1,
            "per_class_auprc": list(self.per_class_auprc),
            "per_class_auroc": list(self.per_class_auroc),
            "per_class_precision": list(self.per_class_precision),
            "per_class_recall": list(self.per_class_recall),
            "per_class_f1": list(self.per_class_f1),
            "per_class_support_pos": list(self.per_class_support_pos),
            "per_class_support_neg": list(self.per_class_support_neg),
            "skipped_classes": list(self.skipped_classes),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MetricsDict":
        return cls(
            schema_version=d.get("schema_version", "p2-02b-v1"),
            num_samples=int(d.get("num_samples", 0)),
            threshold=float(d.get("threshold", 0.5)),
            macro_auprc=float(d.get("macro_auprc", 0.0)),
            micro_auprc=float(d.get("micro_auprc", 0.0)),
            macro_auroc=float(d.get("macro_auroc", 0.0)),
            micro_auroc=float(d.get("micro_auroc", 0.0)),
            macro_f1=float(d.get("macro_f1", 0.0)),
            micro_f1=float(d.get("micro_f1", 0.0)),
            per_class_auprc=list(d.get("per_class_auprc", [])),
            per_class_auroc=list(d.get("per_class_auroc", [])),
            per_class_precision=list(d.get("per_class_precision", [])),
            per_class_recall=list(d.get("per_class_recall", [])),
            per_class_f1=list(d.get("per_class_f1", [])),
            per_class_support_pos=list(d.get("per_class_support_pos", [])),
            per_class_support_neg=list(d.get("per_class_support_neg", [])),
            skipped_classes=list(d.get("skipped_classes", [])),
        )


def compute_full_metrics(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    *,
    threshold: float = 0.5,
) -> MetricsDict:
    """Compute the full multi-label metric set for a validation pass.

    ``y_true`` and ``y_proba`` are both ``(N, num_classes)``. Returns a
    fully populated ``MetricsDict``.
    """
    assert y_true.shape == y_proba.shape, (
        f"shape mismatch: y_true={y_true.shape}, y_proba={y_proba.shape}"
    )
    assert y_true.ndim == 2
    n, num_classes = y_true.shape

    per_class_auprc: list[float | None] = [None] * num_classes
    per_class_auroc: list[float | None] = [None] * num_classes
    skipped: list[int] = []

    ap_values: list[float] = []
    auc_values: list[float] = []
    col_sums = y_true.sum(axis=0)
    for c in range(num_classes):
        n_pos = int(col_sums[c])
        if n_pos == 0:
            skipped.append(c)
            continue
        col_true = y_true[:, c]
        col_proba = y_proba[:, c]
        ap = float(average_precision_score(col_true, col_proba))
        per_class_auprc[c] = ap
        ap_values.append(ap)
        if (n - n_pos) > 0:
            auc = float(roc_auc_score(col_true, col_proba))
            per_class_auroc[c] = auc
            auc_values.append(auc)

    y_pred = (y_proba >= threshold).astype(np.int64)
    per_class_precision = [
        float(precision_score(y_true[:, c], y_pred[:, c], zero_division=0))
        for c in range(num_classes)
    ]
    per_class_recall = [
        float(recall_score(y_true[:, c], y_pred[:, c], zero_division=0))
        for c in range(num_classes)
    ]
    per_class_f1 = [
        float(f1_score(y_true[:, c], y_pred[:, c], zero_division=0))
        for c in range(num_classes)
    ]
    per_class_support_pos = col_sums.tolist()
    per_class_support_neg = [int(n - s) for s in col_sums]

    macro_auprc = float(np.mean(ap_values)) if ap_values else 0.0
    macro_auroc = float(np.mean(auc_values)) if auc_values else 0.0
    y_true_flat = y_true.ravel()
    y_proba_flat = y_proba.ravel()
    micro_auprc = float(average_precision_score(y_true_flat, y_proba_flat))
    micro_auroc = float(roc_auc_score(y_true_flat, y_proba_flat))
    macro_f1 = float(np.mean(per_class_f1))
    micro_f1 = float(f1_score(y_true_flat, y_pred.ravel(), zero_division=0))

    return MetricsDict(
        num_samples=n,
        threshold=threshold,
        macro_auprc=macro_auprc,
        micro_auprc=micro_auprc,
        macro_auroc=macro_auroc,
        micro_auroc=micro_auroc,
        macro_f1=macro_f1,
        micro_f1=micro_f1,
        per_class_auprc=per_class_auprc,
        per_class_auroc=per_class_auroc,
        per_class_precision=per_class_precision,
        per_class_recall=per_class_recall,
        per_class_f1=per_class_f1,
        per_class_support_pos=per_class_support_pos,
        per_class_support_neg=per_class_support_neg,
        skipped_classes=sorted(skipped),
    )


__all__ = ["MetricsDict", "compute_full_metrics"]


def _smoke() -> None:  # pragma: no cover
    """Manual sanity check; not collected by pytest."""
    y_true, y_proba = (
        np.array([[1, 0], [0, 1]], dtype=np.float64),
        np.array([[0.9, 0.1], [0.2, 0.8]], dtype=np.float64),
    )
    print(compute_full_metrics(y_true, y_proba).to_dict())


if __name__ == "__main__":  # pragma: no cover
    _smoke()