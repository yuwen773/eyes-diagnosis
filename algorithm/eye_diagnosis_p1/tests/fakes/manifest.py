"""FakeManifestLoader — deterministic 4-patient manifest for fixture runs."""
from __future__ import annotations

import pandas as pd

# 4 patients × 2 eyes = 8 rows; 8 disease classes (multi-label).
# pids 1, 2 → class 0 positive; pids 3, 4 → class 1 positive.
# Classes 2..7 have 0 positives — exercises the skip-empty-class branch
# in metrics.py.
_NUM_CLASSES = 8
_FROZEN_LABELS: dict[int, dict[int, int]] = {
    1: {0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
    2: {0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
    3: {0: 0, 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
    4: {0: 0, 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
}


def _build_manifest() -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for pid, labels in _FROZEN_LABELS.items():
        for side in ("left", "right"):
            row: dict[str, object] = {
                "patient_id": pid,
                "side": side,
                "relpath": f"Training_Dataset/{pid}_{side}.jpg",
            }
            for c in range(_NUM_CLASSES):
                row[f"label_class_{c}"] = labels[c]
            rows.append(row)
    return pd.DataFrame(rows)


class FakeManifestLoader:
    """Returns a deterministic 4-patient manifest with 8-class multi-label."""

    def __init__(self) -> None:
        self._df = _build_manifest()

    def load(self) -> pd.DataFrame:
        # Returned df is intentionally not copied — callers must not mutate.
        return self._df