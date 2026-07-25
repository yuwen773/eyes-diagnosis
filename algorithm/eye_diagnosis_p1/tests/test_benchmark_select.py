"""Tests for deterministic Dev-patient selection for the I/O benchmark.

Seam under test: ``select_dev_patients`` — given a split-assignment CSV
(``patient_id, split``) and a count ``n``, returns exactly ``n`` Dev patient
ids chosen deterministically by ``sha256(patient_id)`` ordering. Test (frozen)
patients are never eligible.

All tests use a synthetic CSV in ``tmp_path`` — no real data required.
"""

from __future__ import annotations

import hashlib

import pytest

pd = pytest.importorskip("pandas")

from p1.benchmark.select import select_dev_patients  # noqa: E402


def _write_split(tmp_path, dev_ids, test_ids):
    rows = [{"patient_id": p, "split": "dev"} for p in dev_ids]
    rows += [{"patient_id": p, "split": "test"} for p in test_ids]
    path = tmp_path / "split_assignment_v1.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_selects_exactly_n(tmp_path) -> None:
    dev = [str(i) for i in range(200)]
    test = [str(i) for i in range(1000, 1100)]
    path = _write_split(tmp_path, dev, test)
    chosen = select_dev_patients(path, n=128)
    assert len(chosen) == 128
    assert len(set(chosen)) == 128


def test_never_selects_test_patients(tmp_path) -> None:
    dev = [str(i) for i in range(200)]
    test = [str(i) for i in range(1000, 1100)]
    path = _write_split(tmp_path, dev, test)
    chosen = set(select_dev_patients(path, n=128))
    assert chosen.isdisjoint(set(test))


def test_deterministic_same_selection(tmp_path) -> None:
    dev = [str(i) for i in range(200)]
    path = _write_split(tmp_path, dev, [])
    a = select_dev_patients(path, n=64)
    b = select_dev_patients(path, n=64)
    assert a == b


def test_matches_independent_sha256_ordering(tmp_path) -> None:
    """Expected order computed independently via hashlib, not the impl."""
    dev = [str(i) for i in range(50)]
    path = _write_split(tmp_path, dev, [])
    expected = sorted(dev, key=lambda p: hashlib.sha256(p.encode("utf-8")).digest())[:16]
    assert select_dev_patients(path, n=16) == expected


def test_raises_when_not_enough_dev(tmp_path) -> None:
    dev = [str(i) for i in range(10)]
    path = _write_split(tmp_path, dev, [])
    with pytest.raises(ValueError):
        select_dev_patients(path, n=128)
