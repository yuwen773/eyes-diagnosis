"""Loaders for the frozen split/fold artifacts + a file hasher.

p1.split is a read-only frozen contract with no loader; the training
entry point reads these CSVs instead of regenerating the split/folds.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path


class FrozenInputError(RuntimeError):
    """A frozen split/fold artifact is missing, malformed, or invalid."""


def load_split_assignment(path: Path) -> dict[str, str]:
    path = Path(path)
    if not path.exists():
        raise FrozenInputError(f"split assignment not found: {path}")
    out: dict[str, str] = {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["patient_id", "split"]:
            raise FrozenInputError(
                f"split schema mismatch in {path}: expected ['patient_id','split'], "
                f"got {reader.fieldnames}"
            )
        for r in reader:
            split = r["split"]
            if split not in ("dev", "test"):
                raise FrozenInputError(
                    f"{path}: bad split value {split!r} for {r['patient_id']}"
                )
            out[r["patient_id"]] = split
    if not out:
        raise FrozenInputError(f"split assignment is empty: {path}")
    return out


def load_fold_assignment(path: Path) -> dict[str, int]:
    path = Path(path)
    if not path.exists():
        raise FrozenInputError(f"fold assignment not found: {path}")
    out: dict[str, int] = {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["patient_id", "fold"]:
            raise FrozenInputError(
                f"fold schema mismatch in {path}: expected ['patient_id','fold'], "
                f"got {reader.fieldnames}"
            )
        for r in reader:
            try:
                fold = int(r["fold"])
            except (ValueError, TypeError) as e:
                raise FrozenInputError(
                    f"{path}: non-int fold for {r['patient_id']}"
                ) from e
            if fold < 0:
                raise FrozenInputError(
                    f"{path}: negative fold for {r['patient_id']}"
                )
            out[r["patient_id"]] = fold
    if not out:
        raise FrozenInputError(f"fold assignment is empty: {path}")
    return out


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(Path(path).read_bytes())
    return h.hexdigest()


__all__ = [
    "FrozenInputError",
    "load_fold_assignment",
    "load_split_assignment",
    "sha256_file",
]
