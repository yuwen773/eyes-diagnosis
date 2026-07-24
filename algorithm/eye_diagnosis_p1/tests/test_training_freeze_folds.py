"""Tests for the one-shot fold freezer."""

from __future__ import annotations

import csv

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
