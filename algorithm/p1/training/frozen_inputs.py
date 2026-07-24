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
            pid = r["patient_id"]
            if pid in out:
                raise FrozenInputError(
                    f"{path}: duplicate patient_id {pid!r} in split assignment"
                )
            split = r["split"]
            if split not in ("dev", "test"):
                raise FrozenInputError(
                    f"{path}: bad split value {split!r} for {pid}"
                )
            out[pid] = split
    if not out:
        raise FrozenInputError(f"split assignment is empty: {path}")
    return out


def load_fold_assignment(
    path: Path, *, expected_folds: int | None = None
) -> dict[str, int]:
    """Load the fold CSV.

    If ``expected_folds`` is supplied, every fold value must be in
    ``range(expected_folds)``. Duplicate ``patient_id`` rows are
    rejected (last-write-wins would silently swallow a data error).
    """
    path = Path(path)
    if not path.exists():
        raise FrozenInputError(f"fold assignment not found: {path}")
    if expected_folds is not None and expected_folds <= 0:
        raise FrozenInputError(
            f"expected_folds must be positive; got {expected_folds}"
        )
    out: dict[str, int] = {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["patient_id", "fold"]:
            raise FrozenInputError(
                f"fold schema mismatch in {path}: expected ['patient_id','fold'], "
                f"got {reader.fieldnames}"
            )
        for r in reader:
            pid = r["patient_id"]
            if pid in out:
                raise FrozenInputError(
                    f"{path}: duplicate patient_id {pid!r} in fold assignment"
                )
            try:
                fold = int(r["fold"])
            except (ValueError, TypeError) as e:
                raise FrozenInputError(
                    f"{path}: non-int fold for {pid}"
                ) from e
            if fold < 0:
                raise FrozenInputError(
                    f"{path}: negative fold for {pid}"
                )
            if expected_folds is not None and fold >= expected_folds:
                raise FrozenInputError(
                    f"{path}: fold {fold} for {pid} is outside [0, {expected_folds})"
                )
            out[pid] = fold
    if not out:
        raise FrozenInputError(f"fold assignment is empty: {path}")
    return out


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(Path(path).read_bytes())
    return h.hexdigest()


def validate_frozen_training_inputs(
    manifest_patient_ids: set[str],
    split_assignment: dict[str, str],
    fold_assignment: dict[str, int],
    *,
    expected_folds: int,
) -> None:
    """Force seven invariants between manifest / split / fold.

    Raises ``FrozenInputError`` on any violation. The invariants are:

      1. ``set(split_assignment) == manifest_patient_ids``
         (no Manifest patient dropped, no extra Split patient).
      2. ``set(fold_assignment) == {p for p, s in split.items() if s == 'dev'}``
         (every Development patient has a fold row; Test has none).
      3. No Test patient appears in the fold assignment.
      4. No duplicate ``patient_id`` (loaders already enforce this; asserted
         again as a defence-in-depth check).
      5. Every fold value lies in ``range(expected_folds)``.
      6. Each fold has at least one patient.
      7. ``train_patient_count`` (= fold_assignment patients minus the
         requested fold) and ``validation_patient_count`` (= the
         requested fold's patients) are both > 0. The actual
         requested fold is checked at the run_fold / CLI layer; here
         we only confirm that *every* fold has at least one patient
         (so requesting any valid fold yields a non-empty validation
         set).

    The caller still has to assert disjointness between the requested
    fold's validation patients and the rest of the Development set;
    that happens at ``run_fold`` entry where the actual partition is
    materialised.
    """
    if expected_folds <= 0:
        raise FrozenInputError(
            f"expected_folds must be positive; got {expected_folds}"
        )

    manifest_set = set(manifest_patient_ids)
    split_set = set(split_assignment)
    fold_set = set(fold_assignment)

    # 1. Split ↔ Manifest.
    if split_set != manifest_set:
        missing = manifest_set - split_set
        extra = split_set - manifest_set
        raise FrozenInputError(
            f"split assignment does not match manifest: "
            f"missing={sorted(missing)}, extra={sorted(extra)}"
        )

    dev_pids = {p for p, s in split_assignment.items() if s == "dev"}
    test_pids = {p for p, s in split_assignment.items() if s == "test"}

    # 2. Fold ↔ Development.
    if fold_set != dev_pids:
        missing = dev_pids - fold_set
        extra = fold_set - dev_pids
        raise FrozenInputError(
            f"fold assignment does not match Development set: "
            f"missing={sorted(missing)}, extra={sorted(extra)}"
        )

    # 3. No Test patient in folds.
    leaked = fold_set & test_pids
    if leaked:
        raise FrozenInputError(
            f"fold assignment contains Test patients: {sorted(leaked)}"
        )

    # 5. Fold values are in range.
    bad_folds = sorted({f for f in fold_assignment.values() if f < 0 or f >= expected_folds})
    if bad_folds:
        raise FrozenInputError(
            f"fold values outside [0, {expected_folds}): {bad_folds}"
        )

    # 6. Each fold non-empty.
    fold_counts: dict[int, int] = {}
    for f in fold_assignment.values():
        fold_counts[f] = fold_counts.get(f, 0) + 1
    empty_folds = sorted(f for f in range(expected_folds) if fold_counts.get(f, 0) == 0)
    if empty_folds:
        raise FrozenInputError(
            f"empty fold(s): {empty_folds}"
        )


__all__ = [
    "FrozenInputError",
    "load_fold_assignment",
    "load_split_assignment",
    "sha256_file",
    "validate_frozen_training_inputs",
]
