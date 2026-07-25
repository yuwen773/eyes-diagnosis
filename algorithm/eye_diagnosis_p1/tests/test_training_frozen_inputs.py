"""Tests for frozen split/fold loaders + sha256_file helper."""

from __future__ import annotations

from pathlib import Path

from p1.training.frozen_inputs import (
    FrozenInputError,
    load_fold_assignment,
    load_split_assignment,
    sha256_file,
)


def _write(p: Path, text: str) -> Path:
    p.write_text(text)
    return p


def test_load_split_ok(tmp_path: Path) -> None:
    p = _write(tmp_path / "s.csv", "patient_id,split\np001,dev\np002,test\n")
    assert load_split_assignment(p) == {"p001": "dev", "p002": "test"}


def test_load_split_rejects_unknown_value(tmp_path: Path) -> None:
    p = _write(tmp_path / "s.csv", "patient_id,split\np001,train\n")
    import pytest

    with pytest.raises(FrozenInputError):
        load_split_assignment(p)


def test_load_split_rejects_missing_file(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(FrozenInputError):
        load_split_assignment(tmp_path / "does_not_exist.csv")


def test_load_split_rejects_bad_schema(tmp_path: Path) -> None:
    import pytest

    p = _write(tmp_path / "s.csv", "pid,s\np001,dev\n")
    with pytest.raises(FrozenInputError):
        load_split_assignment(p)


def test_load_fold_ok(tmp_path: Path) -> None:
    p = _write(tmp_path / "f.csv", "patient_id,fold\np001,0\np002,3\n")
    assert load_fold_assignment(p) == {"p001": 0, "p002": 3}


def test_load_fold_rejects_non_int(tmp_path: Path) -> None:
    import pytest

    p = _write(tmp_path / "f.csv", "patient_id,fold\np001,x\n")
    with pytest.raises(FrozenInputError):
        load_fold_assignment(p)


def test_load_fold_rejects_negative(tmp_path: Path) -> None:
    import pytest

    p = _write(tmp_path / "f.csv", "patient_id,fold\np001,-1\n")
    with pytest.raises(FrozenInputError):
        load_fold_assignment(p)


def test_load_fold_rejects_missing_file(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(FrozenInputError):
        load_fold_assignment(tmp_path / "missing.csv")


def test_load_fold_rejects_bad_schema(tmp_path: Path) -> None:
    import pytest

    p = _write(tmp_path / "f.csv", "pid,f\np001,0\n")
    with pytest.raises(FrozenInputError):
        load_fold_assignment(p)


def test_sha256_file_stable(tmp_path: Path) -> None:
    p = _write(tmp_path / "a.txt", "hello")
    assert (
        sha256_file(p)
        == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )


def test_sha256_file_changes_with_content(tmp_path: Path) -> None:
    a = _write(tmp_path / "a.txt", "hello")
    b = _write(tmp_path / "b.txt", "world")
    assert sha256_file(a) != sha256_file(b)


def test_load_split_rejects_empty(tmp_path: Path) -> None:
    import pytest

    # Header-only file: well-formed schema, zero rows.
    p = _write(tmp_path / "s.csv", "patient_id,split\n")
    with pytest.raises(FrozenInputError):
        load_split_assignment(p)


def test_load_fold_rejects_empty(tmp_path: Path) -> None:
    import pytest

    p = _write(tmp_path / "f.csv", "patient_id,fold\n")
    with pytest.raises(FrozenInputError):
        load_fold_assignment(p)
