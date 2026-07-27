"""FakeFoldAssignmentLoader — fixed 5-fold split with 4 train / 2 val per fold."""
from __future__ import annotations

import pandas as pd

# Fixed fold 0..4 split (4 patients × 5 folds = 20 rows).
# Each fold's val set is 2 patients; train set is the other 2.
# fold 0: train {1,2}, val {3,4}
# fold 1: train {3,4}, val {1,2}
# fold 2: train {1,3}, val {2,4}
# fold 3: train {2,4}, val {1,3}
# fold 4: train {1,4}, val {2,3}
_FOLD_SPLIT: dict[int, dict[str, set[int]]] = {
    0: {"train": {1, 2}, "val": {3, 4}},
    1: {"train": {3, 4}, "val": {1, 2}},
    2: {"train": {1, 3}, "val": {2, 4}},
    3: {"train": {2, 4}, "val": {1, 3}},
    4: {"train": {1, 4}, "val": {2, 3}},
}


def _build_split() -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for pid in (1, 2, 3, 4):
        for fold in range(5):
            split = "val" if pid in _FOLD_SPLIT[fold]["val"] else "train"
            rows.append({"patient_id": pid, "fold": fold, "split": split})
    return pd.DataFrame(rows)


class FakeFoldAssignmentLoader:
    """Returns a fixed 5-fold split DataFrame with patient_id, fold, split."""

    def __init__(self) -> None:
        self._df = _build_split()

    def load(self) -> pd.DataFrame:
        return self._df.copy()

    def fold_pids(self, fold: int, split: str) -> set[int]:
        return set(
            self._df[(self._df["fold"] == fold) & (self._df["split"] == split)][
                "patient_id"
            ].tolist()
        )

    def expected_folds(self) -> int:
        return 5