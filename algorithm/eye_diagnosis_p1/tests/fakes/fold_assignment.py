"""Fake fold/split artifacts mirroring the real frozen data model.

The real model has two separate artifacts:

* ``split_assignment`` — ``patient_id, split`` where ``split`` is
  ``dev`` / ``test`` (a whole-patient hold-out, not train/val).
* ``fold_assignment`` — ``patient_id, fold`` for Development patients only.

"train" and "val" are therefore *derived* per fold: ``val`` is the fold's
own patients, ``train`` is every other Development patient. These fakes
keep that shape so tests exercise the same partitioning the GPU run does.

Five Development patients, one per fold, so every fold has a non-empty
validation set (the frozen validator rejects empty folds).
"""
from __future__ import annotations

import pandas as pd

PATIENT_IDS: tuple[int, ...] = (1, 2, 3, 4, 5)


def _build_folds() -> pd.DataFrame:
    # Each patient belongs to exactly one fold; one patient per fold.
    rows: list[dict[str, object]] = [
        {"patient_id": pid, "fold": pid - 1} for pid in PATIENT_IDS
    ]
    return pd.DataFrame(rows)


def _build_splits() -> pd.DataFrame:
    # Every fake patient is Development; none are Test.
    return pd.DataFrame(
        {"patient_id": list(PATIENT_IDS), "split": ["dev"] * len(PATIENT_IDS)}
    )


def fold_split(fold: int) -> dict[str, set[int]]:
    """Return the ``{"train": ..., "val": ...}`` partition for ``fold``."""
    val = {fold + 1}
    return {"train": set(PATIENT_IDS) - val, "val": val}


class FakeFoldAssignmentLoader:
    """Returns the ``patient_id, fold`` artifact."""

    def __init__(self) -> None:
        self._df = _build_folds()

    def load(self) -> pd.DataFrame:
        # Returned df is intentionally not copied — callers must not mutate.
        return self._df


class FakeSplitAssignmentLoader:
    """Returns the ``patient_id, split`` artifact (dev/test hold-out)."""

    def __init__(self) -> None:
        self._df = _build_splits()

    def load(self) -> pd.DataFrame:
        return self._df
