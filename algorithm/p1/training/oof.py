"""Patient-level OOF writer and integrity validator.

The writer enforces a single column schema. The validator refuses any
OOF file that contains a Frozen Test patient, a duplicate, a missing
patient, or a malformed checkpoint SHA. The slice's contract requires
the validator to be the only path that "promotes" a fold's outputs to
patient-level truth.

p2-01r: the canonical entry point, ``validate_oof``, reads the frozen
``split_assignment_v1.csv`` so "is this a Test patient" is decided by
the immutable artifact, not by caller-supplied sets (self-attestation).

p2-01r2: ``validate_oof`` now requires an explicit ``mode`` argument:

  - ``smoke_subset`` — current fold's OOF may be a subset (smoke only).
    Requires ``fold_id`` + ``fold_assignment_path`` so the allowed
    patients are scoped to that fold; an unscoped subset is rejected.
  - ``complete_fold`` — OOF must contain EXACTLY the patients assigned
    to ``fold_id`` in the frozen fold map, no more, no less, and each
    row's ``fold`` column must match ``fold_id``. Requires both
    ``fold_id`` and ``fold_assignment_path``.
  - ``complete_development`` — OOF must contain EXACTLY every
    Development patient once; each row's ``fold`` column must match
    the frozen fold map. Requires ``fold_assignment_path`` and must
    NOT be given ``fold_id`` (completeness spans all folds).

Every mode also rejects any patient absent from the frozen split
entirely (neither Dev nor Test), so a fabricated or stale patient ID
cannot slip through unnoticed.

There is no implicit "be lenient" mode. The CI test gate, the recipe
runner, and the multi-fold orchestrator each pick the mode that
matches their claim.
"""

from __future__ import annotations

import csv
import re
from enum import Enum
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


class OofMode(str, Enum):
    SMOKE_SUBSET = "smoke_subset"
    COMPLETE_FOLD = "complete_fold"
    COMPLETE_DEVELOPMENT = "complete_development"


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

    Kept for unit tests that don't need the frozen file. Production
    callers must use ``validate_oof`` with an explicit ``mode``.
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
    mode: OofMode | str,
    fold_id: Optional[int] = None,
    fold_assignment_path: Optional[Path] = None,
) -> dict:
    """Frozen-split validator with explicit completeness mode.

    Parameters
    ----------
    path:
        Path to the OOF CSV to validate.
    split_assignment_path:
        Path to ``split_assignment_v1.csv``. Required.
    mode:
        One of ``OofMode.SMOKE_SUBSET`` / ``COMPLETE_FOLD`` /
        ``COMPLETE_DEVELOPMENT``. A string is also accepted.
    fold_id, fold_assignment_path:
        Fold constraint. ``COMPLETE_FOLD`` and ``SMOKE_SUBSET`` require
        both. ``COMPLETE_DEVELOPMENT`` requires ``fold_assignment_path``
        (to verify each row's ``fold`` column) and rejects ``fold_id``.
    """
    if isinstance(mode, str):
        try:
            mode = OofMode(mode)
        except ValueError as e:
            raise OofIntegrityError(
                f"invalid mode {mode!r}; expected one of "
                f"{[m.value for m in OofMode]}"
            ) from e

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

    split = load_split_assignment(split_assignment_path)
    dev_patients = {pid for pid, s in split.items() if s == "dev"}
    test_patients = {pid for pid, s in split.items() if s == "test"}

    # Required-ness per mode (fail-closed; no lenient fallbacks).
    if mode is OofMode.COMPLETE_FOLD:
        # fold_id + fold_assignment_path must both be present.
        if fold_id is None or fold_assignment_path is None:
            raise OofIntegrityError(
                "COMPLETE_FOLD requires both fold_id and fold_assignment_path"
            )
    elif mode is OofMode.SMOKE_SUBSET:
        # A smoke subset is only meaningful when scoped to a fold: without a
        # fold scope we cannot tell a legitimate subset from an arbitrary set
        # of patients. Require both, fail-closed.
        if fold_id is None or fold_assignment_path is None:
            raise OofIntegrityError(
                "SMOKE_SUBSET requires both fold_id and fold_assignment_path"
            )
    elif mode is OofMode.COMPLETE_DEVELOPMENT:
        # Development completeness spans all folds, so a single fold_id is
        # meaningless here; the fold map is still required so each row's
        # fold column can be verified against the frozen assignment.
        if fold_assignment_path is None:
            raise OofIntegrityError(
                "COMPLETE_DEVELOPMENT requires fold_assignment_path"
            )
        if fold_id is not None:
            raise OofIntegrityError(
                "COMPLETE_DEVELOPMENT must not be given fold_id"
            )

    folds: dict[str, int] = {}
    if fold_assignment_path is not None:
        folds = load_fold_assignment(fold_assignment_path)
        if mode is OofMode.COMPLETE_DEVELOPMENT:
            # Every Dev patient must have a fold row.
            missing = dev_patients - set(folds)
            if missing:
                raise OofIntegrityError(
                    f"fold assignment missing Dev patients: {sorted(missing)[:5]}"
                )
            leaked = set(folds) - dev_patients
            if leaked:
                raise OofIntegrityError(
                    f"fold assignment contains non-Dev patients: {sorted(leaked)[:5]}"
                )

    seen: set[str] = set()
    duplicates: set[str] = set()
    leaked_test: set[str] = set()
    bad_sha_rows: list[str] = []
    bad_fold_rows: list[str] = []
    for r in rows:
        pid = r["patient_id"]
        if pid in seen:
            duplicates.add(pid)
        seen.add(pid)
        if pid in test_patients:
            leaked_test.add(pid)
        if not _SHA_RE.match(r["checkpoint_sha256"]):
            bad_sha_rows.append(pid)
        if folds and r["fold"] != "":
            try:
                row_fold = int(r["fold"])
            except (ValueError, TypeError) as e:
                raise OofIntegrityError(
                    f"OOF {path}: row {pid} fold={r['fold']!r} is not an int"
                ) from e
            if pid in folds and row_fold != folds[pid]:
                bad_fold_rows.append(pid)

    # Universal checks (any mode).
    if duplicates:
        raise OofIntegrityError(f"OOF {path}: duplicate patient rows: {sorted(duplicates)[:5]}")
    if leaked_test:
        raise OofIntegrityError(
            f"OOF {path}: contains Test patients: {sorted(leaked_test)[:5]}"
        )
    # No patient may appear that is absent from the frozen split entirely.
    # ``leaked_test`` only covers patients explicitly marked Test; a patient
    # ID that exists in neither the Dev nor the Test partition is a data
    # error (typo, stale export, or fabricated row) and must be rejected in
    # every mode, including smoke_subset.
    unknown_patients = seen - set(split)
    if unknown_patients:
        raise OofIntegrityError(
            f"OOF {path}: contains patients absent from frozen split: "
            f"{sorted(unknown_patients)[:5]}"
        )
    if bad_sha_rows:
        raise OofIntegrityError(
            f"OOF {path}: invalid checkpoint_sha256 for patients (first 5): "
            f"{bad_sha_rows[:5]}"
        )
    if bad_fold_rows:
        raise OofIntegrityError(
            f"OOF {path}: row.fold != frozen fold for {len(bad_fold_rows)} "
            f"patients (first 5): {bad_fold_rows[:5]}"
        )

    if mode is OofMode.SMOKE_SUBSET:
        # No completeness requirement. Just basic structure + no leaks.
        # If a fold scope was supplied, every seen patient must be in it.
        if fold_id is not None and folds:
            allowed = {p for p, f in folds.items() if f == fold_id}
            extras = seen - allowed
            if extras:
                raise OofIntegrityError(
                    f"OOF {path} (smoke_subset): contains patients outside "
                    f"fold {fold_id}: {sorted(extras)[:5]}"
                )

    elif mode is OofMode.COMPLETE_FOLD:
        assert fold_id is not None and folds is not None
        allowed = {p for p, f in folds.items() if f == fold_id}
        missing = allowed - seen
        extras = seen - allowed
        if missing or extras:
            raise OofIntegrityError(
                f"OOF {path} (complete_fold): missing={sorted(missing)[:5]} "
                f"extras={sorted(extras)[:5]} (missing={len(missing)} "
                f"extras={len(extras)})"
            )

    elif mode is OofMode.COMPLETE_DEVELOPMENT:
        missing = dev_patients - seen
        extras = seen - dev_patients
        if missing or extras:
            raise OofIntegrityError(
                f"OOF {path} (complete_development): missing="
                f"{sorted(missing)[:5]} extras={sorted(extras)[:5]} "
                f"(missing={len(missing)} extras={len(extras)})"
            )
    else:
        raise OofIntegrityError(f"unknown mode: {mode!r}")

    return {
        "n_rows": len(rows),
        "n_unique_patients": len(seen),
        "mode": mode.value,
        "fold_id": fold_id,
    }


__all__ = [
    "OOF_COLUMNS",
    "OofIntegrityError",
    "OofMode",
    "OofWriter",
    "validate_oof",
    "validate_oof_with_sets",
]   # noqa: E501