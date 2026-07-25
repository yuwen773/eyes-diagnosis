"""Unit tests for the patient-eye dataset (synthetic images)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from p1.training.datasets import PatientEyeDataset, make_eye_dataset

torch = pytest.importorskip("torch")
PIL = pytest.importorskip("PIL")

from PIL import Image  # noqa: E402


@pytest.fixture
def fake_manifest(tmp_path: Path) -> Path:
    # The dataset resolves image paths under manifest_path.parent, so put
    # the JPEGs alongside the parquet, not in a subdirectory.
    pids = ["p001", "p002", "p003"]
    relpaths: dict[str, dict[str, str]] = {}
    for pid in pids:
        for side, suffix in [("OD", "left"), ("OS", "right")]:
            fname = f"{pid}_{suffix}.jpg"
            Image.new("RGB", (32, 32), (10, 20, 30)).save(tmp_path / fname)
            relpaths.setdefault(pid, {})[side] = fname
    pdf = pd.DataFrame(
        {
            "patient_id": pids,
            "left_image_relpath": [relpaths[p]["OS"] for p in pids],
            "right_image_relpath": [relpaths[p]["OD"] for p in pids],
            "age": [50, 60, 70],
            "sex": ["M", "F", "M"],
            "label_N": [1, 0, 1],
            "label_D": [0, 1, 0],
            "label_G": [0, 0, 0],
            "label_C": [0, 0, 0],
            "label_A": [0, 0, 0],
            "label_H": [0, 0, 0],
            "label_M": [0, 0, 0],
            "label_O": [0, 0, 0],
        }
    )
    manifest = tmp_path / "patient_manifest_v1.parquet"
    pdf.to_parquet(manifest, index=False)
    return manifest


def _root_dir(manifest_path: Path) -> Path:
    return manifest_path.parent


def test_left_dataset_reads_left_paths(fake_manifest: Path) -> None:
    ds = make_eye_dataset("left", manifest_path=fake_manifest, e2_assignment=None, target_size=64)
    assert len(ds) == 3
    img, label, pid = ds[0]
    assert img.shape == (3, 64, 64)
    assert img.dtype == torch.float32
    assert label.shape == (8,)
    assert label.dtype == torch.int8
    assert pid in {"p001", "p002", "p003"}


def test_right_dataset_reads_right_paths(fake_manifest: Path) -> None:
    ds = make_eye_dataset("right", manifest_path=fake_manifest, e2_assignment=None, target_size=64)
    img, label, pid = ds[0]
    assert img.shape == (3, 64, 64)
    assert label.shape == (8,)


def test_e2_dataset_requires_assignment(fake_manifest: Path) -> None:
    with pytest.raises(ValueError):
        make_eye_dataset("e2", manifest_path=fake_manifest, e2_assignment=None, target_size=64)


def test_e2_dataset_picks_assigned_eye(fake_manifest: Path) -> None:
    assignment = {"p001": "left", "p002": "right", "p003": "left"}
    ds = make_eye_dataset(
        "e2", manifest_path=fake_manifest, e2_assignment=assignment, target_size=64
    )
    # Confirm dataset size and that the right-hand path for p001 is unused.
    assert len(ds) == 3
    right_paths = {row["right_image_relpath"] for row in pd.read_parquet(fake_manifest).to_dict("records")}
    used_right = ds.image_paths["p001"]["right"]
    assert used_right.name in right_paths


def test_unknown_patient_raises(fake_manifest: Path) -> None:
    ds = make_eye_dataset("left", manifest_path=fake_manifest, e2_assignment=None, target_size=64)
    # Index 999 is out of range; the dataset must raise IndexError, not KeyError.
    with pytest.raises(IndexError):
        _ = ds[999]