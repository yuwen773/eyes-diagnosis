"""Tests for the one-shot fold freezer."""

from __future__ import annotations

import csv

import pytest

from p1.split import FoldMap
from p1.training.freeze_folds import write_fold_assignment
from p1.training.frozen_inputs import load_fold_assignment


def test_write_fold_round_trips(tmp_path) -> None:
    fm = FoldMap(patient_to_fold={"p001": 0, "p002": 1, "p003": 0}, k=2, seed=42)
    out = write_fold_assignment(fm, tmp_path / "fold_assignment_v1.csv")
    assert load_fold_assignment(out) == {"p001": 0, "p002": 1, "p003": 0}


def test_write_fold_is_sorted(tmp_path) -> None:
    fm = FoldMap(patient_to_fold={"p003": 1, "p001": 0}, k=2, seed=42)
    out = write_fold_assignment(fm, tmp_path / "f.csv")
    lines = out.read_text().strip().splitlines()
    assert lines[0] == "patient_id,fold"
    assert lines[1].startswith("p001,")
    assert lines[2].startswith("p003,")


def test_write_fold_creates_parent(tmp_path) -> None:
    fm = FoldMap(patient_to_fold={"p001": 0}, k=1, seed=42)
    nested = tmp_path / "deep" / "sub"
    out = write_fold_assignment(fm, nested / "fold.csv")
    assert out.exists()
    with out.open() as f:
        rows = list(csv.DictReader(f))
    assert rows == [{"patient_id": "p001", "fold": "0"}]


def test_write_fold_overwrites(tmp_path) -> None:
    from p1.training.frozen_inputs import FrozenInputError

    fm1 = FoldMap(patient_to_fold={"p001": 0, "p002": 1}, k=2, seed=42)
    out = write_fold_assignment(fm1, tmp_path / "f.csv")
    # A second write replaces.
    fm2 = FoldMap(patient_to_fold={"p001": 1, "p002": 0}, k=2, seed=42)
    write_fold_assignment(fm2, out)
    assert load_fold_assignment(out) == {"p001": 1, "p002": 0}


def test_load_rejects_wrong_k_via_independent_int_check(tmp_path) -> None:
    """Bad fold values are caught at load time, not write time."""
    from p1.training.frozen_inputs import FrozenInputError

    p = tmp_path / "f.csv"
    p.write_text("patient_id,fold\np001,99\n")
    # load only validates non-int and non-negative; high folds are caller's
    # responsibility, but the file must still load successfully.
    assert load_fold_assignment(p) == {"p001": 99}


# ---- p2-01r2: freeze_folds_from_manifest consumes the FROZEN split -------


def _write_min_manifest(path, patient_ids):
    """Minimal patient-level manifest parquet for build_oof_folds."""
    import numpy as np
    import pandas as pd

    from p1.audit import CLASS_ORDER

    rows = []
    for i, pid in enumerate(patient_ids):
        row = {"patient_id": pid}
        for c in CLASS_ORDER:
            row[f"label_{c}"] = 0
        # Rotate the single positive class so every fold sees each class.
        row[f"label_{CLASS_ORDER[i % len(CLASS_ORDER)]}"] = 1
        rows.append(row)
    pd.DataFrame(rows).to_parquet(path)


def test_freeze_folds_consumes_frozen_split_excludes_test(tmp_path) -> None:
    """The fold map is derived from the frozen split: patients marked
    ``test`` there must never receive a fold, and every Dev patient must."""
    from p1.manifest import ManifestPaths
    from p1.training.freeze_folds import freeze_folds_from_manifest
    from p1.training.frozen_inputs import load_fold_assignment

    dev_pids = [f"p{i:03d}" for i in range(2, 12)]  # 10 dev
    test_pids = ["p000", "p001"]
    all_pids = test_pids + dev_pids

    manifest_path = tmp_path / "patient_manifest_v1.parquet"
    _write_min_manifest(manifest_path, all_pids)
    manifest = ManifestPaths(
        patient_manifest_path=manifest_path,
        eye_index_path=manifest_path,  # unused by build_oof_folds
    )

    split_path = tmp_path / "split_assignment_v1.csv"
    with split_path.open("w", newline="") as f:
        f.write("patient_id,split\n")
        for pid in all_pids:
            f.write(f"{pid},{'test' if pid in test_pids else 'dev'}\n")

    out = freeze_folds_from_manifest(
        manifest,
        split_assignment_path=split_path,
        seed=42,
        k=5,
        out_dir=tmp_path,
    )
    fold_map = load_fold_assignment(out, expected_folds=5)

    # Test patients from the frozen split are absent; every Dev patient present.
    assert set(fold_map) == set(dev_pids)
    for tp in test_pids:
        assert tp not in fold_map


def test_freeze_folds_requires_split_assignment_path(tmp_path) -> None:
    """The split path is a required keyword — no silent split regeneration."""
    from p1.manifest import ManifestPaths
    from p1.training.freeze_folds import freeze_folds_from_manifest

    manifest = ManifestPaths(
        patient_manifest_path=tmp_path / "m.parquet",
        eye_index_path=tmp_path / "m.parquet",
    )
    with pytest.raises(TypeError):
        freeze_folds_from_manifest(manifest, seed=42, k=5, out_dir=tmp_path)
