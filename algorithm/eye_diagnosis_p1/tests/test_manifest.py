"""Tests for the patient-level manifest (refactored seam 2 of P1).

The patient-level manifest is the only fact-table for training, split,
OOF, metrics, and bootstrap. It carries one row per patient with both
image paths side by side and the 8-class label vector.

The eye-level index is a separate, optional artifact used only for file
auditing (e.g. counting AppleDouble files per patient). Training code
must never read the eye-level index.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import pytest

from p1.audit import EyeRow, SourceManifest
from p1.manifest import build_patient_manifest, build_eye_index, ManifestPaths


# Required patient-manifest schema is part of the public contract.
PATIENT_REQUIRED_COLUMNS = (
    "patient_id",
    "left_image_relpath",
    "right_image_relpath",
    "age",
    "sex",
    "label_N",
    "label_D",
    "label_G",
    "label_C",
    "label_A",
    "label_H",
    "label_M",
    "label_O",
)

EYE_INDEX_REQUIRED_COLUMNS = (
    "patient_id",
    "laterality",
    "image_relpath",
)


def _row(pid: str, lat: str, labels: tuple[int, ...]) -> EyeRow:
    return EyeRow(
        patient_id=pid,
        laterality=lat,
        relative_path=f"Training_Dataset/{pid}_{lat}.jpg",
        age=60,
        sex="M",
        diagnostic_keywords="",
        labels=labels,
    )


def _fake_source(rows: list[EyeRow]) -> SourceManifest:
    return SourceManifest(
        eye_rows=tuple(rows),
        workbook_sha256="x" * 64,
        images_dir_sha256="y" * 64,
    )


def test_patient_manifest_writes_patient_manifest_file(tmp_path: Path) -> None:
    src = _fake_source([_row("P001", "OD", (0,) * 8), _row("P001", "OS", (0,) * 8)])
    paths = build_patient_manifest(src, out_dir=tmp_path)
    assert paths.patient_manifest_path == tmp_path / "patient_manifest_v1.parquet"
    assert paths.patient_manifest_path.is_file()


def test_patient_manifest_writes_eye_index_file(tmp_path: Path) -> None:
    src = _fake_source([_row("P001", "OD", (0,) * 8), _row("P001", "OS", (0,) * 8)])
    paths = build_patient_manifest(src, out_dir=tmp_path)
    assert paths.eye_index_path == tmp_path / "eye_index_v1.parquet"
    assert paths.eye_index_path.is_file()


def test_patient_manifest_schema_is_complete(tmp_path: Path) -> None:
    src = _fake_source([_row("P001", "OD", (0,) * 8), _row("P001", "OS", (0,) * 8)])
    paths = build_patient_manifest(src, out_dir=tmp_path)
    table = pq.read_table(paths.patient_manifest_path)
    assert set(table.column_names) >= set(PATIENT_REQUIRED_COLUMNS)


def test_patient_manifest_one_row_per_patient(tmp_path: Path) -> None:
    rows = []
    for pid in ("P001", "P002", "P003"):
        rows.append(_row(pid, "OD", (0,) * 8))
        rows.append(_row(pid, "OS", (0,) * 8))
    src = _fake_source(rows)
    paths = build_patient_manifest(src, out_dir=tmp_path)
    df = pd.read_parquet(paths.patient_manifest_path)
    assert len(df) == 3
    assert set(df["patient_id"]) == {"P001", "P002", "P003"}


def test_patient_manifest_carries_both_eye_paths(tmp_path: Path) -> None:
    src = _fake_source(
        [
            _row("P001", "OD", (0,) * 8),
            _row("P001", "OS", (0,) * 8),
        ]
    )
    paths = build_patient_manifest(src, out_dir=tmp_path)
    df = pd.read_parquet(paths.patient_manifest_path)
    row = df.iloc[0]
    assert row["left_image_relpath"].endswith("_OD.jpg")
    assert row["right_image_relpath"].endswith("_OS.jpg")


def test_patient_manifest_rejects_missing_eye(tmp_path: Path) -> None:
    """A patient with only one eye in the source must be rejected, not silently dropped.

    Silently dropping would change label counts and bias the split.
    """
    src = _fake_source([_row("P001", "OD", (0,) * 8)])  # only OD
    with pytest.raises(ValueError):
        build_patient_manifest(src, out_dir=tmp_path)


def test_patient_manifest_rejects_duplicate_patient(tmp_path: Path) -> None:
    """Even if a patient somehow appears twice, the manifest must reject."""
    src = _fake_source(
        [
            _row("P001", "OD", (0,) * 8),
            _row("P001", "OS", (0,) * 8),
            _row("P001", "OD", (0,) * 8),  # duplicate OD
        ]
    )
    with pytest.raises(ValueError):
        build_patient_manifest(src, out_dir=tmp_path)


def test_patient_manifest_label_columns_are_int8_zero_or_one(tmp_path: Path) -> None:
    rows = [
        _row("P001", "OD", (1, 0, 0, 0, 0, 0, 0, 0)),
        _row("P001", "OS", (1, 0, 0, 0, 0, 0, 0, 0)),
        _row("P002", "OD", (0, 1, 0, 0, 0, 0, 0, 0)),
        _row("P002", "OS", (0, 1, 0, 0, 0, 0, 0, 0)),
    ]
    paths = build_patient_manifest(_fake_source(rows), out_dir=tmp_path)
    df = pd.read_parquet(paths.patient_manifest_path)
    for col in (c for c in PATIENT_REQUIRED_COLUMNS if c.startswith("label_")):
        assert df[col].dtype == "int8"
        assert set(df[col].unique()).issubset({0, 1})


def test_eye_index_has_one_row_per_eye(tmp_path: Path) -> None:
    rows = []
    for pid in ("P001", "P002"):
        rows.append(_row(pid, "OD", (0,) * 8))
        rows.append(_row(pid, "OS", (0,) * 8))
    paths = build_patient_manifest(_fake_source(rows), out_dir=tmp_path)
    df = pd.read_parquet(paths.eye_index_path)
    assert len(df) == 4
    assert set(df.columns) >= set(EYE_INDEX_REQUIRED_COLUMNS)


def test_patient_manifest_does_not_duplicate_patient_facts(tmp_path: Path) -> None:
    """The single source of truth is patient-level. Each patient appears once.

    Training, split, OOF, metrics, and bootstrap must read this file. The
    eye-index file is for auditing only and must NOT be used as a training
    fact-table (this test asserts that contract by checking row count).
    """
    rows = []
    for pid in ("P001", "P002", "P003", "P004"):
        rows.append(_row(pid, "OD", (0,) * 8))
        rows.append(_row(pid, "OS", (0,) * 8))
    paths = build_patient_manifest(_fake_source(rows), out_dir=tmp_path)
    pdf = pd.read_parquet(paths.patient_manifest_path)
    edf = pd.read_parquet(paths.eye_index_path)
    assert len(pdf) == 4  # patient-level
    assert len(edf) == 8  # eye-level for auditing only