"""Patient-level manifest + eye-level index for the P1 baseline.

The P1 manifest has two artifacts, both derived from a single
:class:`p1.audit.SourceManifest`:

``patient_manifest_v1.parquet``
    One row per patient. The *only* fact-table for training, split, OOF,
    metrics, and bootstrap. Carries both image paths side by side plus the
    8-class patient-level label vector.

``eye_index_v1.parquet``
    One row per (patient × laterality). For file-system auditing only —
    e.g. counting AppleDouble files per patient, validating that every
    patient has exactly two eyes. Training code must NOT read this file
    as a fact-table; doing so would double-count labels.

Both files are typed (parquet + int8 label columns). The class order is
the public contract from :mod:`p1.audit`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from p1.audit import CLASS_ORDER, SourceManifest


@dataclass(frozen=True)
class ManifestPaths:
    """Paths to the two manifest artifacts."""

    patient_manifest_path: Path
    eye_index_path: Path


@dataclass(frozen=True)
class EyeRowProxy:
    patient_id: str
    laterality: str
    relative_path: str
    age: int
    sex: str
    labels: tuple[int, ...]


def _build_patient_rows(source: SourceManifest) -> list[dict]:
    """Pivot (patient × eye) → one row per patient with both eyes' relpaths.

    Raises
    ------
    ValueError
        If any patient has zero or two entries for the same laterality, or
        if any patient is missing one of the two eyes.
    """
    by_patient: dict[str, dict[str, EyeRowProxy]] = {}
    for row in source.eye_rows:
        bucket = by_patient.setdefault(row.patient_id, {})
        if row.laterality in bucket:
            raise ValueError(
                f"patient {row.patient_id}: duplicate {row.laterality} entry"
            )
        bucket[row.laterality] = EyeRowProxy(
            patient_id=row.patient_id,
            laterality=row.laterality,
            relative_path=row.relative_path,
            age=row.age,
            sex=row.sex,
            labels=row.labels,
        )

    out: list[dict] = []
    for pid, eyes in by_patient.items():
        if set(eyes.keys()) != {"OD", "OS"}:
            raise ValueError(
                f"patient {pid}: must have both OD and OS; got {sorted(eyes)}"
            )
        od = eyes["OD"]
        os_ = eyes["OS"]
        # Sanity: age and sex must agree across the two eyes (single patient).
        if od.age != os_.age:
            raise ValueError(f"patient {pid}: age differs between OD ({od.age}) and OS ({os_.age})")
        if od.sex != os_.sex:
            raise ValueError(f"patient {pid}: sex differs between OD ({od.sex}) and OS ({os_.sex})")
        if od.labels != os_.labels:
            raise ValueError(
                f"patient {pid}: labels differ between eyes; expected patient-level multilabel"
            )
        record = {
            "patient_id": pid,
            "left_image_relpath": od.relative_path,   # OD = oculus dexter = right eye
            "right_image_relpath": os_.relative_path, # OS = oculus sinister = left eye
            "age": od.age,
            "sex": od.sex,
        }
        for cls, bit in zip(CLASS_ORDER, od.labels):
            record[f"label_{cls}"] = bit
        out.append(record)
    return out


def _build_eye_rows(source: SourceManifest) -> list[dict]:
    return [
        {
            "patient_id": row.patient_id,
            "laterality": row.laterality,
            "image_relpath": row.relative_path,
        }
        for row in source.eye_rows
    ]


def build_patient_manifest(source: SourceManifest, *, out_dir: Path) -> ManifestPaths:
    """Write both manifest artifacts and return their paths.

    Parameters
    ----------
    source:
        Audited source manifest from :func:`p1.audit.read_source_manifest`.
    out_dir:
        Directory in which to write the two parquet files. Created if missing.

    Returns
    -------
    ManifestPaths
        Paths of the two written files.

    Raises
    ------
    ValueError
        On duplicate ``(patient_id, laterality)`` pairs or patients missing
        one eye.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Patient-level fact-table
    pdf = pd.DataFrame(_build_patient_rows(source))
    label_cols = [f"label_{c}" for c in CLASS_ORDER]
    pdf[label_cols] = pdf[label_cols].astype("int8")
    pdf["age"] = pdf["age"].astype("int32")
    patient_manifest_path = out_dir / "patient_manifest_v1.parquet"
    pdf.to_parquet(patient_manifest_path, index=False)

    # Eye-level index (file auditing only)
    edf = pd.DataFrame(_build_eye_rows(source))
    eye_index_path = out_dir / "eye_index_v1.parquet"
    edf.to_parquet(eye_index_path, index=False)

    return ManifestPaths(
        patient_manifest_path=patient_manifest_path,
        eye_index_path=eye_index_path,
    )


def build_eye_index(source: SourceManifest, *, out_dir: Path) -> Path:
    """Write only the eye-level index file (for auditing).

    Prefer :func:`build_patient_manifest` for the normal case; this is
    exposed for callers that want to re-audit files without rewriting the
    patient fact-table.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    edf = pd.DataFrame(_build_eye_rows(source))
    path = out_dir / "eye_index_v1.parquet"
    edf.to_parquet(path, index=False)
    return path