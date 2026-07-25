"""Tests for p1.split (seams 3 & 4 of P1 baseline).

Hard invariants pinned by the frozen P1 protocol:

- Patient-level split: no patient appears in both Test and Development.
- Test is frozen at **433 patients** (2885 × 0.15, banker's-rounded).
- Development is **2452 patients** (2885 − 433).
- Split is iterative-multilabel-stratified, deterministic per seed.
- 5-fold multilabel-stratified OOF is built **only on Development**.
- Test patients never appear in any OOF fold.
- Every Development patient appears in exactly one OOF fold.
- OOF is deterministic per seed.
- Every split and every Dev fold has ≥1 positive patient per class
  (i.e. no class is entirely absent from a fold), so rare classes
  (H=77, A=161, M=174, G=215, C=211) cannot be entirely missing.
- ``split_summary_v1.json`` is written with per-split counts, rates,
  multilabel count, age stats, sex distribution, and label co-occurrence.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from p1.audit import EyeRow, SourceManifest
from p1.manifest import build_patient_manifest


CLASS_ORDER = ("N", "D", "G", "C", "A", "H", "M", "O")


def _row(pid: int, labels: tuple[int, ...]) -> tuple[EyeRow, EyeRow]:
    return (
        EyeRow(
            patient_id=str(pid),
            laterality="OS",
            relative_path=f"Training_Dataset/{pid}_left.jpg",
            age=60,
            sex="Male",
            diagnostic_keywords="",
            labels=labels,
        ),
        EyeRow(
            patient_id=str(pid),
            laterality="OD",
            relative_path=f"Training_Dataset/{pid}_right.jpg",
            age=60,
            sex="Male",
            diagnostic_keywords="",
            labels=labels,
        ),
    )


def _build_source(n_patients: int) -> SourceManifest:
    """Build a source with realistic class sparsity so stratification is meaningful.

    Distributes patients across all 8 classes with a long tail: Normal is
    common (≈40% of patients), the rest are distributed unevenly across
    the seven disease classes. Rare classes still have ≥5 patients so
    multilabel stratification can produce a non-empty test set per class.
    """
    rng = np.random.default_rng(20260501)
    # Per-class counts; sum must equal n_patients.
    counts = {
        "N": max(5, int(n_patients * 0.39)),
        "D": max(5, int(n_patients * 0.18)),
        "G": max(5, int(n_patients * 0.075)),
        "C": max(5, int(n_patients * 0.073)),
        "A": max(5, int(n_patients * 0.056)),
        "H": max(5, int(n_patients * 0.027)),
        "M": max(5, int(n_patients * 0.060)),
        "O": max(5, int(n_patients * 0.139)),
    }
    # Normalize to exactly n_patients.
    total = sum(counts.values())
    if total != n_patients:
        counts["N"] += n_patients - total

    rows: list[EyeRow] = []
    pid = 0
    for cls, count in counts.items():
        for _ in range(count):
            bits = [0] * len(CLASS_ORDER)
            bits[CLASS_ORDER.index(cls)] = 1
            # ~3% of disease patients also carry "O" (multilabel)
            if cls != "N" and cls != "O" and rng.random() < 0.03:
                bits[CLASS_ORDER.index("O")] = 1
            rows.extend(_row(pid, tuple(bits)))
            pid += 1

    return SourceManifest(
        eye_rows=tuple(rows),
        workbook_sha256="x" * 64,
        images_dir_sha256="y" * 64,
    )


# ---- Test split (Test=433 / Dev=2452 on the real dataset) ------------------


def test_split_locks_test_count_at_433_on_2885_patients(tmp_path: Path) -> None:
    """With 2885 patients and test_frac=0.15, banker's round gives 433."""
    from p1.split import assign_splits

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    assert assignment.test_count == 433
    assert assignment.dev_count == 2452


def test_split_test_count_is_deterministic_per_seed(tmp_path: Path) -> None:
    from p1.split import assign_splits

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    a = assign_splits(paths, seed=42, test_frac=0.15)
    b = assign_splits(paths, seed=42, test_frac=0.15)
    assert a.patient_to_split == b.patient_to_split
    assert a.test_count == b.test_count


def test_split_test_set_changes_with_seed(tmp_path: Path) -> None:
    from p1.split import assign_splits

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    a = assign_splits(paths, seed=42, test_frac=0.15)
    b = assign_splits(paths, seed=7, test_frac=0.15)
    assert a.test_patient_ids != b.test_patient_ids


def test_split_no_patient_appears_in_both_test_and_dev(tmp_path: Path) -> None:
    from p1.split import assign_splits

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    test_set = set(assignment.test_patient_ids)
    dev_set = set(assignment.dev_patient_ids)
    assert test_set.isdisjoint(dev_set)
    assert len(test_set) + len(dev_set) == 2885


def test_split_test_frac_must_be_in_open_interval(tmp_path: Path) -> None:
    from p1.split import assign_splits

    src = _build_source(10)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    for bad in (0.0, 1.0, -0.1, 1.5):
        with pytest.raises(ValueError):
            assign_splits(paths, seed=42, test_frac=bad)


def test_split_every_class_has_at_least_one_positive_in_test_and_dev(tmp_path: Path) -> None:
    """The whole point of multilabel stratification: no class vanishes from a split."""
    from p1.split import assign_splits

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)

    pdf = pd.read_parquet(paths.patient_manifest_path)
    label_cols = [f"label_{c}" for c in CLASS_ORDER]

    test_pids = set(assignment.test_patient_ids)
    dev_pids = set(assignment.dev_patient_ids)

    test_pos = pdf[pdf["patient_id"].isin(test_pids)][label_cols].sum()
    dev_pos = pdf[pdf["patient_id"].isin(dev_pids)][label_cols].sum()
    for cls in CLASS_ORDER:
        col = f"label_{cls}"
        assert test_pos[col] >= 1, f"class {cls} has zero positives in Test"
        assert dev_pos[col] >= 1, f"class {cls} has zero positives in Dev"


def test_split_writes_split_summary_json(tmp_path: Path) -> None:
    from p1.split import assign_splits

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assign_splits(paths, seed=42, test_frac=0.15, out_dir=tmp_path)

    summary = tmp_path / "split_summary_v1.json"
    assert summary.is_file()
    payload = json.loads(summary.read_text())
    assert payload["test_count"] == 433
    assert payload["dev_count"] == 2452
    assert "per_split" in payload
    assert "test" in payload["per_split"] and "dev" in payload["per_split"]
    assert "label_counts" in payload["per_split"]["test"]
    assert "label_rates" in payload["per_split"]["test"]
    assert "age_min" in payload["per_split"]["test"]
    assert "sex_distribution" in payload["per_split"]["test"]
    assert "label_cooccurrence" in payload
    assert payload["seed"] == 42
    assert payload["test_frac"] == 0.15
    # Every class must have ≥1 positive patient in both splits.
    for cls in CLASS_ORDER:
        assert payload["per_split"]["test"]["label_counts"][cls] >= 1
        assert payload["per_split"]["dev"]["label_counts"][cls] >= 1


# ---- OOF folds on Development ----------------------------------------------


def test_oof_every_dev_patient_appears_in_exactly_one_fold(tmp_path: Path) -> None:
    from p1.split import assign_splits, build_oof_folds

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    folds = build_oof_folds(assignment, paths, k=5, seed=42)

    seen: list[str] = []
    for fid in range(5):
        seen.extend(folds.fold_to_patients(fid))
    assert len(seen) == len(set(seen)) == 2452


def test_oof_test_patients_never_appear(tmp_path: Path) -> None:
    from p1.split import assign_splits, build_oof_folds

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    folds = build_oof_folds(assignment, paths, k=5, seed=42)

    oof_pids = set()
    for fid in range(5):
        oof_pids.update(folds.fold_to_patients(fid))
    assert set(assignment.test_patient_ids).isdisjoint(oof_pids)


def test_oof_k_must_be_positive(tmp_path: Path) -> None:
    from p1.split import assign_splits, build_oof_folds

    src = _build_source(50)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    with pytest.raises(ValueError):
        build_oof_folds(assignment, paths, k=0, seed=42)


def test_oof_k_cannot_exceed_dev_count(tmp_path: Path) -> None:
    from p1.split import assign_splits, build_oof_folds

    src = _build_source(10)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    with pytest.raises(ValueError):
        build_oof_folds(assignment, paths, k=assignment.dev_count + 1, seed=42)


def test_oof_is_deterministic_per_seed(tmp_path: Path) -> None:
    from p1.split import assign_splits, build_oof_folds

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    a = build_oof_folds(assignment, paths, k=5, seed=42)
    b = build_oof_folds(assignment, paths, k=5, seed=42)
    for fid in range(5):
        assert a.fold_to_patients(fid) == b.fold_to_patients(fid)


def test_oof_every_fold_has_at_least_one_positive_per_class(tmp_path: Path) -> None:
    """Rare classes (especially H=77) must not vanish from any fold."""
    from p1.split import assign_splits, build_oof_folds

    src = _build_source(2885)
    paths = build_patient_manifest(src, out_dir=tmp_path / "m")
    assignment = assign_splits(paths, seed=42, test_frac=0.15)
    folds = build_oof_folds(assignment, paths, k=5, seed=42)

    pdf = pd.read_parquet(paths.patient_manifest_path)
    label_cols = [f"label_{c}" for c in CLASS_ORDER]
    for fid in range(5):
        fold_pids = set(folds.fold_to_patients(fid))
        pos = pdf[pdf["patient_id"].isin(fold_pids)][label_cols].sum()
        for cls in CLASS_ORDER:
            assert pos[f"label_{cls}"] >= 1, f"fold {fid} missing class {cls}"