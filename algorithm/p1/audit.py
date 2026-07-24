"""Source-data audit for the P1 baseline.

The source dataset is a read-only directory containing:

- ``Traning_Dataset.xlsx`` (sic, intentionally misspelled) — a workbook with
  one row per patient. Required columns:

  - ``ID`` — integer patient identifier.
  - ``Patient Age`` — integer age.
  - ``Patient Sex`` — ``Male`` / ``Female`` (other source values preserved).
  - ``Left-Fundus`` — JPEG filename for the left eye (OS), e.g. ``42_left.jpg``.
  - ``Right-Fundus`` — JPEG filename for the right eye (OD), e.g. ``42_right.jpg``.
  - ``Left-Diagnostic Keywords`` / ``Right-Diagnostic Keywords`` — raw text.
  - ``N`` / ``D`` / ``G`` / ``C`` / ``A`` / ``H`` / ``M`` / ``O`` — eight
    binary columns giving the patient-level multilabel targets directly.

- ``Training_Dataset/`` — one JPEG per (patient × laterality), filenames as
  referenced in the workbook.

This module exposes a single public function, :func:`read_source_manifest`,
that performs a *fail-closed* audit of the source directory and returns a
:data:`SourceManifest` carrying one :class:`EyeRow` per (patient × eye) plus
the patient-level label vector (taken from the workbook's eight binary
columns).

Failure modes (must raise, never silently skip):

- Missing workbook or missing images directory.
- Missing required columns in the workbook.
- Any workbook row whose left/right JPEG path does not exist on disk.
- Any workbook row whose patient is missing one eye.
- Any extra AppleDouble ``._*`` file or un-referenced real JPEG inside
  ``Training_Dataset/`` (the directory must be in 1:1 correspondence with the
  workbook rows).
- Any label column holding a value outside ``{0, 1}``.
- Any duplicate ``ID`` in the workbook.

The audit is *read-only*: it never copies, moves, or modifies files under
``eye_data_root``.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


# Class order is part of the public contract. Index ``i`` corresponds to the
# i-th label in any vector returned by this module.
CLASS_ORDER: tuple[str, ...] = (
    "N",  # Normal
    "D",  # Diabetes
    "G",  # Glaucoma
    "C",  # Cataract
    "A",  # AMD (age-related macular degeneration)
    "H",  # Hypertension
    "M",  # Myopia
    "O",  # Other
)


_REQUIRED_COLUMNS = (
    "ID",
    "Patient Age",
    "Patient Sex",
    "Left-Fundus",
    "Right-Fundus",
    "Left-Diagnostic Keywords",
    "Right-Diagnostic Keywords",
    *CLASS_ORDER,
)


# Laterality convention: OS = oculus sinister = left eye; OD = oculus dexter = right eye.
_LEFT_LATERALITY = "OS"
_RIGHT_LATERALITY = "OD"


class AppleDoubleFileError(ValueError):
    """Raised when a Mac OS AppleDouble ``._*`` file is found in the images dir."""


class UnreferencedImageError(ValueError):
    """Raised when an image exists in the images dir that the workbook doesn't reference."""


@dataclass(frozen=True)
class EyeRow:
    """One row of the audited source manifest: a single eye image."""

    patient_id: str
    laterality: str  # "OD" or "OS"
    relative_path: str  # POSIX-style, relative to eye_data_root
    age: int
    sex: str
    diagnostic_keywords: str
    labels: tuple[int, ...]  # length == len(CLASS_ORDER), values in {0, 1}


@dataclass(frozen=True)
class SourceManifest:
    """Audited, patient-level multilabel manifest."""

    eye_rows: tuple[EyeRow, ...]
    workbook_sha256: str
    images_dir_sha256: str

    @property
    def patient_ids(self) -> tuple[str, ...]:
        seen: list[str] = []
        for row in self.eye_rows:
            if row.patient_id not in seen:
                seen.append(row.patient_id)
        return tuple(seen)

    def labels_for(self, patient_id: str) -> tuple[int, ...]:
        for row in self.eye_rows:
            if row.patient_id == patient_id:
                return row.labels
        raise KeyError(patient_id)


def _read_workbook(eye_data_root: Path) -> tuple[pd.DataFrame, str]:
    workbook = eye_data_root / "Traning_Dataset.xlsx"
    if not workbook.is_file():
        raise FileNotFoundError(f"missing workbook: {workbook}")
    sha = hashlib.sha256(workbook.read_bytes()).hexdigest()
    df = pd.read_excel(workbook)

    missing = [c for c in _REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"workbook is missing required columns: {missing}")

    return df, sha


def _audit_images_dir(
    images_dir: Path, expected_filenames: set[str]
) -> str:
    """Verify every expected JPEG is present and no AppleDouble / extra files exist.

    Returns the SHA-256 of the directory's file list (sorted, relative) for
    reproducibility anchoring.
    """
    if not images_dir.is_dir():
        raise FileNotFoundError(f"missing images directory: {images_dir}")

    actual = sorted(p.name for p in images_dir.iterdir() if p.is_file())

    for name in actual:
        if name.startswith("._"):
            raise AppleDoubleFileError(
                f"Mac OS AppleDouble metadata file detected in {images_dir}: "
                f"{name!r} (not a real JPEG; ignore or delete the parent copy)"
            )

    actual_set = set(actual)
    missing = expected_filenames - actual_set
    if missing:
        raise FileNotFoundError(
            f"images directory missing workbook-referenced files: {sorted(missing)}"
        )
    extra = actual_set - expected_filenames
    if extra:
        raise UnreferencedImageError(
            f"images directory contains files not referenced by the workbook: "
            f"{sorted(extra)}"
        )

    return hashlib.sha256(
        "\n".join(actual).encode("utf-8")
    ).hexdigest()


def _eye_rows_from_workbook(df: pd.DataFrame, images_dir: Path) -> tuple[EyeRow, ...]:
    out: list[EyeRow] = []
    seen_ids: set[str] = set()
    expected_filenames: set[str] = set()

    for _, raw in df.iterrows():
        pid_raw = raw["ID"]
        if pd.isna(pid_raw):
            raise ValueError("workbook row with missing ID")
        pid = str(int(pid_raw))
        if pid in seen_ids:
            raise ValueError(f"duplicate patient ID in workbook: {pid}")
        seen_ids.add(pid)

        age_raw = raw["Patient Age"]
        if pd.isna(age_raw):
            raise ValueError(f"patient {pid}: missing age")
        age = int(age_raw)

        sex = str(raw["Patient Sex"]).strip()
        if not sex:
            raise ValueError(f"patient {pid}: missing sex")

        left_filename = str(raw["Left-Fundus"]).strip()
        right_filename = str(raw["Right-Fundus"]).strip()
        if not left_filename or not right_filename:
            raise ValueError(f"patient {pid}: missing Left-Fundus or Right-Fundus")

        # Filename must not look like AppleDouble itself.
        for fname in (left_filename, right_filename):
            if fname.startswith("._"):
                raise AppleDoubleFileError(
                    f"patient {pid}: workbook references AppleDouble file {fname!r}"
                )
            if "/" in fname or "\\" in fname:
                raise ValueError(
                    f"patient {pid}: filename {fname!r} must not contain path separators"
                )

        expected_filenames.add(left_filename)
        expected_filenames.add(right_filename)

        # Labels from the workbook's eight binary columns.
        labels = []
        for cls in CLASS_ORDER:
            v = raw[cls]
            if pd.isna(v):
                raise ValueError(f"patient {pid}: label {cls} is missing")
            iv = int(v)
            if iv not in (0, 1):
                raise ValueError(
                    f"patient {pid}: label {cls}={iv} not in {{0, 1}}"
                )
            labels.append(iv)
        labels_t = tuple(labels)

        left_kw = str(raw.get("Left-Diagnostic Keywords", "") or "")
        right_kw = str(raw.get("Right-Diagnostic Keywords", "") or "")

        # OS = left eye; OD = right eye
        out.append(EyeRow(
            patient_id=pid,
            laterality=_LEFT_LATERALITY,
            relative_path=f"Training_Dataset/{left_filename}",
            age=age,
            sex=sex,
            diagnostic_keywords=left_kw,
            labels=labels_t,
        ))
        out.append(EyeRow(
            patient_id=pid,
            laterality=_RIGHT_LATERALITY,
            relative_path=f"Training_Dataset/{right_filename}",
            age=age,
            sex=sex,
            diagnostic_keywords=right_kw,
            labels=labels_t,
        ))

    return tuple(out)


def read_source_manifest(eye_data_root: Path) -> SourceManifest:
    """Audit ``eye_data_root`` and return a :class:`SourceManifest`.

    Parameters
    ----------
    eye_data_root:
        Path to the source dataset directory. Must contain
        ``Traning_Dataset.xlsx`` and ``Training_Dataset/``.

    Returns
    -------
    SourceManifest
        One :class:`EyeRow` per (patient × eye), with patient-level labels
        taken from the workbook's eight binary columns.

    Raises
    ------
    FileNotFoundError
        If the workbook, images directory, or any referenced JPEG is missing.
    AppleDoubleFileError
        If a Mac OS AppleDouble ``._*`` file is found in the images dir.
    UnreferencedImageError
        If the images dir contains files not referenced by the workbook.
    ValueError
        On malformed workbook (missing columns, missing IDs, duplicate IDs,
        missing fields, label values outside ``{0, 1}``, etc.).
    """
    eye_data_root = Path(eye_data_root)
    df, wb_sha = _read_workbook(eye_data_root)
    eye_rows = _eye_rows_from_workbook(df, eye_data_root)

    expected = {Path(r.relative_path).name for r in eye_rows}
    images_dir = eye_data_root / "Training_Dataset"
    images_sha = _audit_images_dir(images_dir, expected)

    return SourceManifest(
        eye_rows=eye_rows,
        workbook_sha256=wb_sha,
        images_dir_sha256=images_sha,
    )