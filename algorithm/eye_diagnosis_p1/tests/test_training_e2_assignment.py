"""Unit tests for deterministic E2 eye assignment."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from p1.training.e2_assignment import (
    E2AssignmentError,
    E2AssignmentMismatch,
    assign_e2_eyes,
    read_e2_assignment,
    write_e2_assignment,
)


def test_assign_is_deterministic_for_same_seed() -> None:
    pids = [f"p{i:04d}" for i in range(50)]
    a = assign_e2_eyes(pids, seed=42)
    b = assign_e2_eyes(pids, seed=42)
    assert a == b
    assert set(a) == set(pids)
    assert all(eye in {"left", "right"} for eye in a.values())


def test_assign_changes_with_seed() -> None:
    pids = [f"p{i:04d}" for i in range(50)]
    a = assign_e2_eyes(pids, seed=42)
    b = assign_e2_eyes(pids, seed=43)
    assert a != b


def test_left_right_balance_within_one_percent() -> None:
    pids = [f"p{i:05d}" for i in range(2452)]
    mapping = assign_e2_eyes(pids, seed=42)
    n_left = sum(1 for v in mapping.values() if v == "left")
    n_right = len(mapping) - n_left
    expected = len(pids) / 2
    assert abs(n_left - expected) / expected < 0.01
    assert abs(n_right - expected) / expected < 0.01


def test_write_and_read_round_trip(tmp_path: Path) -> None:
    pids = ["p001", "p002", "p003"]
    mapping = assign_e2_eyes(pids, seed=42)
    path = write_e2_assignment(mapping, seed=42, out_path=tmp_path / "e2.csv")
    assert path.exists()
    loaded = read_e2_assignment(path)
    assert loaded == mapping


def test_write_is_sorted_by_patient_id(tmp_path: Path) -> None:
    pids = ["p003", "p001", "p002"]
    mapping = assign_e2_eyes(pids, seed=42)
    path = write_e2_assignment(mapping, seed=42, out_path=tmp_path / "e2.csv")
    rows = list(csv.DictReader(path.open()))
    assert [r["patient_id"] for r in rows] == sorted(pids)


def test_read_raises_on_seed_mismatch(tmp_path: Path) -> None:
    pids = ["p001", "p002"]
    mapping = assign_e2_eyes(pids, seed=42)
    path = write_e2_assignment(mapping, seed=42, out_path=tmp_path / "e2.csv")
    # Tamper: change a row's eye
    rows = list(csv.DictReader(path.open()))
    rows[0]["eye"] = "right" if rows[0]["eye"] == "left" else "left"
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["patient_id", "eye", "seed"])
        w.writeheader()
        w.writerows(rows)
    with pytest.raises((E2AssignmentError, E2AssignmentMismatch, AssertionError, KeyError)):
        read_e2_assignment(path)


def test_assign_rejects_empty_input() -> None:
    with pytest.raises(E2AssignmentError):
        assign_e2_eyes([], seed=42)