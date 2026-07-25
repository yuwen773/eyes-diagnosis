"""Unit tests for the OOF writer and integrity validator."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from p1.training.oof import (
    OOF_COLUMNS,
    OofIntegrityError,
    OofWriter,
    validate_oof_with_sets,
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
    summary = validate_oof_with_sets(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)
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
        validate_oof_with_sets(tmp_path / "oof.csv", expected_dev_patients=dev | test, dev_patients=dev)
    assert "p_TEST" in str(ei.value) or "test" in str(ei.value).lower()


def test_validate_oof_rejects_duplicate(tmp_path: Path) -> None:
    dev = {"p001", "p002", "p003"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001"), _row("p001")])
    with pytest.raises(OofIntegrityError):
        validate_oof_with_sets(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


def test_validate_oof_rejects_missing_patient(tmp_path: Path) -> None:
    dev = {"p001", "p002", "p003"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001")])
    with pytest.raises(OofIntegrityError):
        validate_oof_with_sets(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


def test_validate_oof_rejects_bad_sha(tmp_path: Path) -> None:
    dev = {"p001"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001", sha="not-a-sha")])
    with pytest.raises(OofIntegrityError):
        validate_oof_with_sets(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


# ---- p2-01r: validate_oof uses the FROZEN split (no self-attestation) -----


def test_validate_oof_uses_frozen_split_to_reject_test_patient(tmp_path: Path) -> None:
    """Caller used to pass dev_patient_ids/excluded_test ids directly (self-attestation).
    The new frozen-split form reads the immutable split_assignment_v1.csv: any
    patient marked ``test`` there must NOT appear in the OOF, regardless of
    what the caller's sets contain."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,test\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA"), _row("pB")])  # pB is Test in the frozen split
    with pytest.raises(OofIntegrityError):
        validate_oof(
            oof, split_assignment_path=split, mode="smoke_subset",
            fold_id=0, fold_assignment_path=folds,
        )


def test_validate_oof_frozen_split_passes_for_dev_only(tmp_path: Path) -> None:
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,dev\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\npB,0\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA", fold=0), _row("pB", fold=0)])
    # smoke_subset requires an explicit fold scope; a fold-0 subset is OK.
    summary = validate_oof(
        oof, split_assignment_path=split, mode="smoke_subset",
        fold_id=0, fold_assignment_path=folds,
    )
    assert summary["n_rows"] == 2


def test_validate_oof_frozen_split_with_fold_constraint(tmp_path: Path) -> None:
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,dev\npC,dev\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\npB,1\npC,0\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA", fold=0), _row("pC", fold=0)])  # fold-0 ids only
    # smoke_subset with explicit fold scope: only fold-0 patients allowed.
    validate_oof(
        oof, split_assignment_path=split, mode="smoke_subset",
        fold_id=0, fold_assignment_path=folds,
    )
    with pytest.raises(OofIntegrityError):
        # Adding a fold-1 patient trips the fold-membership check.
        with OofWriter(tmp_path / "oof2.csv") as w:
            w.append([_row("pA", fold=0), _row("pB", fold=1)])
        validate_oof(
            tmp_path / "oof2.csv",
            split_assignment_path=split,
            mode="smoke_subset",
            fold_id=0,
            fold_assignment_path=folds,
        )


def test_validate_oof_complete_fold_mode(tmp_path: Path) -> None:
    """complete_fold must be EXACTLY the patients assigned to fold_id."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,dev\npC,dev\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\npB,1\npC,0\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA", fold=0), _row("pC", fold=0)])
    # Exactly fold-0 patients → passes.
    summary = validate_oof(
        oof, split_assignment_path=split, mode="complete_fold",
        fold_id=0, fold_assignment_path=folds,
    )
    assert summary["mode"] == "complete_fold"

    with pytest.raises(OofIntegrityError):
        # Missing pC → fails.
        with OofWriter(tmp_path / "oof_incomplete.csv") as w:
            w.append([_row("pA", fold=0)])
        validate_oof(
            tmp_path / "oof_incomplete.csv",
            split_assignment_path=split, mode="complete_fold",
            fold_id=0, fold_assignment_path=folds,
        )


def test_validate_oof_complete_development_mode(tmp_path: Path) -> None:
    """complete_development must contain every Dev patient exactly once
    and each row's fold column must match the frozen fold map."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,dev\npC,test\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\npB,1\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([
            _row("pA", fold=0),
            _row("pB", fold=1),
        ])
    summary = validate_oof(
        oof, split_assignment_path=split, mode="complete_development",
        fold_assignment_path=folds,
    )
    assert summary["mode"] == "complete_development"

    with pytest.raises(OofIntegrityError):
        # Missing pB → fails.
        with OofWriter(tmp_path / "oof_incomplete.csv") as w:
            w.append([_row("pA", fold=0)])
        validate_oof(
            tmp_path / "oof_incomplete.csv",
            split_assignment_path=split, mode="complete_development",
            fold_assignment_path=folds,
        )
    """In complete_development mode, a row whose fold column disagrees
    with the frozen fold map must be rejected."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,dev\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\npB,1\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        # pA is fold-0 per frozen map, but row claims fold=1.
        w.append([
            _row("pA", fold=1),
            _row("pB", fold=1),
        ])
    with pytest.raises(OofIntegrityError):
        validate_oof(
            oof, split_assignment_path=split, mode="complete_development",
            fold_assignment_path=folds,
        )


def test_validate_oof_requires_paired_fold_args(tmp_path: Path) -> None:
    """fold_id without fold_assignment_path (or vice versa) is rejected."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA")])
    with pytest.raises(OofIntegrityError):
        validate_oof(oof, split_assignment_path=split, mode="smoke_subset", fold_id=0)
    with pytest.raises(OofIntegrityError):
        validate_oof(
            oof, split_assignment_path=split, mode="smoke_subset",
            fold_assignment_path=tmp_path / "fold.csv",
        )


def test_validate_oof_rejects_unknown_patient(tmp_path: Path) -> None:
    """A patient absent from the frozen split entirely (neither Dev nor
    Test) must be rejected in every mode."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA", fold=0), _row("fake_unknown_patient", fold=0)])
    with pytest.raises(OofIntegrityError) as ei:
        validate_oof(
            oof, split_assignment_path=split, mode="smoke_subset",
            fold_id=0, fold_assignment_path=folds,
        )
    assert "absent from frozen split" in str(ei.value)


def test_validate_oof_smoke_subset_requires_fold_scope(tmp_path: Path) -> None:
    """smoke_subset without fold_id + fold_assignment_path is rejected."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA")])
    with pytest.raises(OofIntegrityError):
        validate_oof(oof, split_assignment_path=split, mode="smoke_subset")


def test_validate_oof_complete_development_requires_fold_assignment(tmp_path: Path) -> None:
    """complete_development without fold_assignment_path is rejected."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA", fold=0)])
    with pytest.raises(OofIntegrityError):
        validate_oof(oof, split_assignment_path=split, mode="complete_development")


def test_validate_oof_complete_development_rejects_fold_id(tmp_path: Path) -> None:
    """complete_development given a fold_id is rejected (completeness spans
    all folds, so a single fold_id is meaningless)."""
    from p1.training.oof import validate_oof

    split = tmp_path / "split.csv"
    split.write_text("patient_id,split\npA,dev\npB,dev\n")
    folds = tmp_path / "fold.csv"
    folds.write_text("patient_id,fold\npA,0\npB,1\n")
    oof = tmp_path / "oof.csv"
    with OofWriter(oof) as w:
        w.append([_row("pA", fold=0), _row("pB", fold=1)])
    with pytest.raises(OofIntegrityError):
        validate_oof(
            oof, split_assignment_path=split, mode="complete_development",
            fold_id=0, fold_assignment_path=folds,
        )


def test_validate_oof_with_sets_legacy_still_works(tmp_path: Path) -> None:
    """Legacy keyword API (self-attestation) keeps working for unit tests."""
    from p1.training.oof import validate_oof_with_sets

    dev = {"p001"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001")])
    summary = validate_oof_with_sets(
        tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev,
    )
    assert summary["n_rows"] == 1