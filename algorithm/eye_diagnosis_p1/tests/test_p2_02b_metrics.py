"""Tests for algorithm/p1/training/metrics.py."""
from __future__ import annotations

import numpy as np
import pytest
from sklearn.metrics import average_precision_score

from p1.training.metrics import MetricsDict, compute_full_metrics


def _toy_y_true_y_proba() -> tuple[np.ndarray, np.ndarray]:
    """8-class synthetic: 4 patients, classes 0 & 1 have positives."""
    y_true = np.array(
        [
            [1, 0, 0, 0, 0, 0, 0, 0],
            [1, 0, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0, 0],
        ],
        dtype=np.float64,
    )
    y_proba = np.array(
        [
            [0.9, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.8, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.1, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.2, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ],
        dtype=np.float64,
    )
    return y_true, y_proba


def test_compute_full_metrics_returns_full_field_set() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    expected_fields = {
        "schema_version", "num_samples", "threshold",
        "macro_auprc", "micro_auprc",
        "macro_auroc", "micro_auroc",
        "macro_f1", "micro_f1",
        "per_class_auprc", "per_class_auroc",
        "per_class_precision", "per_class_recall", "per_class_f1",
        "per_class_support_pos", "per_class_support_neg",
        "skipped_classes",
    }
    assert expected_fields.issubset(set(m.to_dict().keys()))


def test_zero_positive_class_is_skipped() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    assert set(m.skipped_classes) == {2, 3, 4, 5, 6, 7}
    for c in m.skipped_classes:
        assert m.per_class_auprc[c] is None
        assert m.per_class_auroc[c] is None
    expected = float(np.mean([m.per_class_auprc[0], m.per_class_auprc[1]]))
    assert m.macro_auprc == pytest.approx(expected, rel=1e-9)


def test_macro_auprc_matches_sklearn_per_class() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    per_class_ap = []
    for c in range(8):
        if y_true[:, c].sum() == 0:
            continue
        per_class_ap.append(average_precision_score(y_true[:, c], y_proba[:, c]))
    assert m.macro_auprc == pytest.approx(float(np.mean(per_class_ap)), rel=1e-9)


def test_threshold_0_5_precision_recall_match_manual() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    assert m.per_class_precision[0] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_recall[0] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_f1[0] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_support_pos[0] == 2
    assert m.per_class_support_neg[0] == 2
    assert m.per_class_precision[1] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_recall[1] == pytest.approx(1.0, rel=1e-9)


def test_metrics_dict_to_dict_roundtrip() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)
    d = m.to_dict()
    m2 = MetricsDict.from_dict(d)
    assert m2.macro_auprc == m.macro_auprc
    assert m2.skipped_classes == m.skipped_classes
    assert m2.per_class_auprc == m.per_class_auprc