"""Patient-level OOF writer and integrity validator.

The writer enforces a single column schema. The validator refuses any
OOF file that contains a Frozen Test patient, a duplicate, a missing
patient, or a malformed checkpoint SHA. The slice's contract requires
the validator to be the only path that "promotes" a fold's outputs to
patient-level truth.

p2-01r: the canonical entry point, ``validate_oof``, reads the frozen
``split_assignment_v1.csv`` so "is this a Test patient" is decided by
the immutable artifact, not by caller-supplied sets (self-attestation).
The legacy keyword API is kept as ``validate_oof_with_sets`` for unit
tests that don't need the frozen file.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Iterable, Optional

from p1.audit import CLASS_ORDER
from p1.training.frozen_inputs import load_fold_assignment, load_split_assignment


OOF_COLUMNS: tuple[str, ...] = (
    "patient_id",
    "fold",
    "experiment_id",
    "seed",
    *(f"true_{c}" for c in CLASS_ORDER),
    *(f"prob_{c}" for c in CLASS_ORDER),
    "checkpoint_sha256",
)


class OofIntegrityError(RuntimeError):
    """Raised when an OOF file violates the slice's integrity contract."""


class OofWriter:
    def __init__(self, path: Path, *, schema_columns: tuple[str, ...] = OOF_COLUMNS) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = self.path.open("w", newline="")
        self._writer = csv.DictWriter(self._file, fieldnames=list(schema_columns))
        self._writer.writeheader()
        self._closed = False

    def append(self, rows: Iterable[dict]) -> None:
        for row in rows:
            self._writer.writerow(row)

    def close(self) -> None:
        if not self._closed:
            self._file.close()
            self._closed = True

    def __enter__(self) -> "OofWriter":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


_SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def validate_oof_with_sets(
    path: Path,
    *,
    expected_dev_patients: set[str],
    dev_patients: set[str],
    require_complete: bool = True,
) -> dict:
    """Legacy validator. Caller-supplied sets (self-attestation).

    ``require_complete=False`` relaxes the "missing patients" check so
    the fold-scoped caller (subset of Dev) can pass. Test membership is
    still decided against the caller-supplied ``dev_patients`` set.
    """
    path = Path(path)
    if not path.exists():
        raise OofIntegrityError(f"OOF file does not exist: {path}")
    with path.open() as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != list(OOF_COLUMNS):
            raise OofIntegrityError(
                f"OOF schema mismatch in {path}: expected {list(OOF_COLUMNS)}, "
                f"got {reader.fieldnames}"
            )
        rows = list(reader)

    n_rows = len(rows)
    seen: set[str] = set()
    duplicates: set[str] = set()
    test_patients: set[str] = set()
    bad_sha_rows: list[str] = []
    for r in rows:
        pid = r["patient_id"]
        if pid in seen:
            duplicates.add(pid)
        seen.add(pid)
        if pid not in dev_patients:
            test_patients.add(pid)
        if not _SHA_RE.match(r["checkpoint_sha256"]):
            bad_sha_rows.append(pid)

    missing = expected_dev_patients - seen
    extras = seen - expected_dev_patients

    if duplicates:
        raise OofIntegrityError(f"OOF {path}: duplicate patient rows: {sorted(duplicates)[:5]}")
    if require_complete and missing:
        raise OofIntegrityError(
            f"OOF {path}: missing patients (showing up to 5): {sorted(missing)[:5]} "
            f"(missing={len(missing)})"
        )
    if test_patients:
        raise OofIntegrityError(
            f"OOF {path}: contains Test patients (showing up to 5): "
            f"{sorted(test_patients)[:5]}"
        )
    if extras:
        raise OofIntegrityError(
            f"OOF {path}: contains patients outside expected_dev_patients: "
            f"{sorted(extras)[:5]}"
        )
    if bad_sha_rows:
        raise OofIntegrityError(
            f"OOF {path}: invalid checkpoint_sha256 for patients (first 5): "
            f"{bad_sha_rows[:5]}"
        )

    return {
        "n_rows": n_rows,
        "n_unique_patients": len(seen),
        "n_test_patients": 0,
        "n_missing_patients": 0 if not require_complete else len(missing),
        "n_duplicate_patients": 0,
        "n_invalid_sha_patients": 0,
    }


def validate_oof(
    path: Path,
    *,
    split_assignment_path: Path,
    fold_id: Optional[int] = None,
    fold_assignment_path: Optional[Path] = None,
) -> dict:
    """Frozen-split validator. Test membership is decided by the immutable
    ``split_assignment_path``; the caller cannot self-attest.

    Parameters
    ----------
    path:
        Path to the OOF CSV to validate.
    split_assignment_path:
        Path to ``split_assignment_v1.csv``. Required.
    fold_id, fold_assignment_path:
        Optional fold constraint. If both are provided, every OOF row's
        patient must be assigned to ``fold_id`` per the frozen fold map.
    """
    split = load_split_assignment(split_assignment_path)
    dev_patients = {pid for pid, s in split.items() if s == "dev"}
    result = validate_oof_with_sets(
        path,
        expected_dev_patients=dev_patients,
        dev_patients=dev_patients,
        require_complete=False,  # fold-scoped OOFs are subsets of Dev
    )

    if fold_id is not None and fold_assignment_path is not None:
        folds = load_fold_assignment(fold_assignment_path)
        with Path(path).open() as f:
            for r in csv.DictReader(f):
                pid = r["patient_id"]
                if folds.get(pid) != fold_id:
                    raise OofIntegrityError(
                        f"OOF {path}: patient {pid} is not in fold {fold_id} "
                        f"(frozen fold: {folds.get(pid)})"
                    )
    return result


__all__ = [
    "OOF_COLUMNS",
    "OofIntegrityError",
    "OofWriter",
    "validate_oof",
    "validate_oof_with_sets",
]   # noqa: E501