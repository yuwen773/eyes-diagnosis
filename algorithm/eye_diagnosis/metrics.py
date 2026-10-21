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
    """逐类别计算 sensitivity / specificity / F1 / AUROC / support。

    ``probs`` 的列是类别**稠密 id**：第 ``label`` 列就是类别 ``label`` 的概率。
    这里刻意不做列到 label 的映射表——调用方必须保证列序与 label 取值一致，
    否则 ``probs[:, label]`` 会静默取错列（或在 1 起始的 label 上 IndexError）。
    """
    if probs.ndim != 2:
        raise ValueError("probs must be 2-D")
    labels_array = np.asarray(labels)
    observed = set(labels_array.tolist())
    if observed and max(observed) >= probs.shape[1]:
        raise ValueError(
            f"labels exceed probability columns: max label {max(observed)} "
            f"but probs has only {probs.shape[1]} columns; "
            "probs columns must be dense class ids"
        )
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