"""Unit tests for the OOF writer and integrity validator."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from p1.training.oof import (
    OOF_COLUMNS,
    OofIntegrityError,
    OofWriter,
    validate_oof,
)


def _row(pid: str, fold: int = 0, sha: str | None = None) -> dict:
    sha = sha or ("a" * 64)
    base = {
        "patient_id": pid,
        "fold": fold,
        "experiment_id": "E3",
        "seed": 42,
    }
    for c in "NDGCAHMO":
        base[f"true_{c}"] = 0
        base[f"prob_{c}"] = 0.0
    base["true_N"] = 1
    base["prob_N"] = 0.9
    base["checkpoint_sha256"] = sha
    return base


def test_oof_columns_are_exact() -> None:
    expected = (
        "patient_id", "fold", "experiment_id", "seed",
        "true_N", "true_D", "true_G", "true_C", "true_A", "true_H", "true_M", "true_O",
        "prob_N", "prob_D", "prob_G", "prob_C", "prob_A", "prob_H", "prob_M", "prob_O",
        "checkpoint_sha256",
    )
    assert OOF_COLUMNS == expected


def test_writer_writes_header_and_rows(tmp_path: Path) -> None:
    path = tmp_path / "oof.csv"
    with OofWriter(path) as w:
        w.append([_row("p001"), _row("p002")])
    with path.open() as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == list(OOF_COLUMNS)
        rows = list(reader)
    assert [r["patient_id"] for r in rows] == ["p001", "p002"]


def test_writer_appends_in_chunks(tmp_path: Path) -> None:
    path = tmp_path / "oof.csv"
    with OofWriter(path) as w:
        w.append([_row("p001")])
        w.append([_row("p002"), _row("p003")])
    with path.open() as f:
        rows = list(csv.DictReader(f))
    assert [r["patient_id"] for r in rows] == ["p001", "p002", "p003"]


def test_validate_oof_passes_for_2452_unique_dev(tmp_path: Path) -> None:
    dev = {f"p{i:04d}" for i in range(2452)}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row(pid, fold=hash(pid) % 5) for pid in sorted(dev)])
    summary = validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)
    assert summary["n_rows"] == 2452
    assert summary["n_unique_patients"] == 2452
    assert summary["n_test_patients"] == 0


def test_validate_oof_rejects_test_patient(tmp_path: Path) -> None:
    dev = {f"p{i:04d}" for i in range(10)}
    test = {"p_TEST"}
    with OofWriter(tmp_path / "oof.csv") as w:
        rows = [_row(pid) for pid in sorted(dev)]
        rows.append(_row("p_TEST"))
        w.append(rows)
    with pytest.raises(OofIntegrityError) as ei:
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev | test, dev_patients=dev)
    assert "p_TEST" in str(ei.value) or "test" in str(ei.value).lower()


def test_validate_oof_rejects_duplicate(tmp_path: Path) -> None:
    dev = {"p001", "p002", "p003"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001"), _row("p001")])
    with pytest.raises(OofIntegrityError):
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


def test_validate_oof_rejects_missing_patient(tmp_path: Path) -> None:
    dev = {"p001", "p002", "p003"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001")])
    with pytest.raises(OofIntegrityError):
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


def test_validate_oof_rejects_bad_sha(tmp_path: Path) -> None:
    dev = {"p001"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001", sha="not-a-sha")])
    with pytest.raises(OofIntegrityError):
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)