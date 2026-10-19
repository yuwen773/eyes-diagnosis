from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd
from sklearn.metrics import (
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


def per_class_metrics(probs: np.ndarray, labels: np.ndarray) -> pd.DataFrame:
    if probs.ndim != 2:
        raise ValueError("probs must be 2-D")
    preds = probs.argmax(axis=1)
    classes = sorted(set(labels.tolist()) | set(preds.tolist()))
    cm = confusion_matrix(labels, preds, labels=classes)
    rows: List[Dict[str, float]] = []
    for idx, label in enumerate(classes):
        tp = cm[idx, idx]
        fn = cm[idx, :].sum() - tp
        fp = cm[:, idx].sum() - tp
        tn = cm.sum() - tp - fn - fp
        sensitivity = float(tp / (tp + fn)) if (tp + fn) else float("nan")
        specificity = float(tn / (tn + fp)) if (tn + fp) else float("nan")
        f1 = float(f1_score(labels == label, preds == label, zero_division=0))
        support = int((labels == label).sum())
        try:
            auroc = float(roc_auc_score((labels == label).astype(int), probs[:, label]))
        except ValueError:
            auroc = float("nan")
        rows.append(
            {
                "label": label,
                "sensitivity": sensitivity,
                "specificity": specificity,
                "f1": f1,
                "auroc": auroc,
                "support": support,
            }
        )
    return pd.DataFrame(rows)