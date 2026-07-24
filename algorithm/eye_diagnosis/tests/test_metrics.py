import numpy as np
from sklearn.metrics import roc_auc_score

from eye_diagnosis.metrics import per_class_metrics


def test_perfect_predictions_have_unit_metrics():
    n, c = 40, 4
    labels = np.array([i % c for i in range(n)])
    probs = np.eye(c)[labels].astype(np.float32)
    metrics = per_class_metrics(probs, labels)
    assert metrics.shape[0] == c
    for _, row in metrics.iterrows():
        assert row["sensitivity"] == 1.0
        assert row["specificity"] == 1.0
        assert row["f1"] == 1.0
        if row["support"] > 0:
            assert row["auroc"] == 1.0 or np.isnan(row["auroc"])


def test_handles_missing_class():
    # labels only have class 0; one prediction is class 1 → class 1 row should
    # exist with NaN AUROC (only one class present in labels means AUROC undefined).
    labels = np.array([0, 0, 0])
    probs = np.array([[0.9, 0.1], [0.8, 0.2], [0.4, 0.6]])
    metrics = per_class_metrics(probs, labels)
    nan_row = metrics[metrics["label"] == 1].iloc[0]
    assert np.isnan(nan_row["auroc"])