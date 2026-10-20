"""The four spec §7.3 contracts that had no test on this branch.

Each one guards a claim the P2-02C smoke run depends on:

* ``test_config_hash_changes_when_protocol_byte_changes`` — the receipt's
  ``config_hash`` must actually identify the protocol, or two different
  protocols produce receipts that look identical.
* ``test_oof_row_count_equals_validation_size`` — OOF rows must match the
  validation set, not the batch count.
* ``test_train_val_disjoint_in_oof`` — OOF patient ids come from the val
  side, and never intersect the training patients. This is the assertion
  that would have caught the "both loaders read the same rows" defect.
* ``test_no_cuda_preflight_fails`` — no CUDA means FAILED_PREFLIGHT, a
  receipt on disk, and no epoch loop entered.

The first three drive the real epoch loop and are marked ``gpu``. The last
one asserts the *absence* of a GPU, so it deliberately runs on CPU runners
too — that is where it matters most.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from eye_diagnosis_p1.tests.fakes import (
    FakeFoldAssignmentLoader,
    FakeModelFactory,
    FakeProtocolLoader,
    FakeSplitAssignmentLoader,
    FakeTorchAdapter,
    FoldAwareDataLoaderFactory,
    fold_split,
)


def _deps(**kw):
    cfg = FakeProtocolLoader(override={"patient_batch": 2}).load()
    base = {
        "torch_adapter": FakeTorchAdapter(),
        "model_factory": FakeModelFactory(seed=42),
        "data_factory": FoldAwareDataLoaderFactory(num_batches=1),
        "cfg": cfg,
        "experiment": "E3",
        "fold": 0,
        "seed": 42,
        "max_epochs": 1,
        "patience": 1,
    }
    base.update(kw)
    return base


def _run(tmp_path: Path, **kw):
    from p1.training.formal_fold_runner import run_formal_fold

    return run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4, 5},
        split_df=FakeSplitAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **_deps(**kw),
    )


def _read_oof(fold_dir: Path) -> list[dict]:
    with (fold_dir / "oof.csv").open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


# --- pure-function halves (CPU-safe) ----------------------------------------
# The three tests below need a CUDA device. The pieces they rest on are pure,
# so they get their own CPU-runnable tests: CI then still catches a regression
# in fold selection or protocol hashing, just not the end-to-end wiring.


def test_validation_pids_selects_only_this_folds_dev_patients() -> None:
    """val = this fold's patients, and only Development ones."""
    import pandas as pd

    from p1.training.formal_fold_runner import _validation_pids

    split_df = pd.DataFrame({
        "patient_id": [1, 2, 3, 4, 5, 6],
        "split": ["dev", "dev", "dev", "dev", "dev", "test"],
    })
    fold_df = pd.DataFrame({
        "patient_id": [1, 2, 3, 4, 5],
        "fold": [0, 0, 1, 2, 3],
    })

    assert _validation_pids(split_df, fold_df, 0) == ["1", "2"]
    assert _validation_pids(split_df, fold_df, 1) == ["3"]
    # Patient 6 is Test: it has no fold row, so it can never appear.
    assert "6" not in _validation_pids(split_df, fold_df, 0)


def test_validation_pids_accepts_int_and_str_keyed_artifacts() -> None:
    """The loaders may hand back either key type; both must resolve."""
    from p1.training.formal_fold_runner import _validation_pids

    split_str = {"1": "dev", "2": "dev"}
    fold_int = {1: 0, 2: 1}
    fold_str = {"1": 0, "2": 1}

    assert _validation_pids(split_str, fold_int, 0) == ["1"]
    assert _validation_pids(split_str, fold_str, 1) == ["2"]


def test_config_hash_is_order_insensitive_and_value_sensitive() -> None:
    """Canonical JSON: key order must not matter, a value change must."""
    from p1.training.formal_fold_runner import _config_hash_of

    a = {"learning_rate": 1e-4, "patient_batch": 8}
    b = {"patient_batch": 8, "learning_rate": 1e-4}
    c = {"learning_rate": 1e-4, "patient_batch": 4}

    assert _config_hash_of(a) == _config_hash_of(b)
    assert _config_hash_of(a) != _config_hash_of(c)


@pytest.mark.gpu
def test_config_hash_changes_when_protocol_byte_changes(tmp_path: Path) -> None:
    """Flipping one protocol value must change ``config_hash`` end to end."""
    from p1.training.formal_fold_runner import _config_hash_of

    base_cfg = FakeProtocolLoader(override={"patient_batch": 2}).load()
    other_cfg = FakeProtocolLoader(override={"patient_batch": 3}).load()
    assert _config_hash_of(base_cfg) != _config_hash_of(other_cfg)

    r1 = _run(tmp_path / "a", cfg=base_cfg)
    r2 = _run(tmp_path / "b", cfg=other_cfg)

    assert r1.config_hash != r2.config_hash
    # The hash in the receipt is the hash of the protocol the fold ran under,
    # so the two hashes on disk differ in the same way.
    on_disk_1 = json.loads((tmp_path / "a" / "fold_0" / "fold_receipt.json").read_text())
    on_disk_2 = json.loads((tmp_path / "b" / "fold_0" / "fold_receipt.json").read_text())
    assert on_disk_1["config_hash"] == r1.config_hash
    assert on_disk_2["config_hash"] == r2.config_hash
    assert on_disk_1["config_hash"] != on_disk_2["config_hash"]


@pytest.mark.gpu
def test_oof_row_count_equals_validation_size(tmp_path: Path) -> None:
    """One OOF row per validation patient — not per batch."""
    receipt = _run(tmp_path)
    assert receipt.status == "PASS", receipt.error_message

    rows = _read_oof(tmp_path / "fold_0")
    expected_val = fold_split(0)["val"]
    assert len(rows) == len(expected_val), (
        f"oof.csv has {len(rows)} rows, validation set has {len(expected_val)}"
    )


@pytest.mark.gpu
def test_train_val_disjoint_in_oof(tmp_path: Path) -> None:
    """OOF ids ⊆ fold-0 validation patients, and never intersect train."""
    _run(tmp_path)

    oof_pids = {int(r["patient_id"]) for r in _read_oof(tmp_path / "fold_0")}
    partition = fold_split(0)

    assert oof_pids, "oof.csv is empty"
    assert oof_pids <= partition["val"], (
        f"OOF contains non-validation patients: {oof_pids - partition['val']}"
    )
    assert oof_pids & partition["train"] == set(), (
        f"OOF contains training patients: {oof_pids & partition['train']}"
    )


def test_no_cuda_preflight_fails(tmp_path: Path, monkeypatch) -> None:
    """No CUDA -> FAILED_PREFLIGHT, receipt written, epoch loop never entered."""
    import torch

    from p1.training import formal_fold_runner as ffr

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)

    entered = {"epoch_loop": False}
    real_train = ffr.train_one_epoch

    def _spy(**kw):
        entered["epoch_loop"] = True
        return real_train(**kw)

    monkeypatch.setattr(ffr, "train_one_epoch", _spy)

    receipt = _run(tmp_path)

    assert receipt.status == "FAILED_PREFLIGHT"
    assert receipt.error_class == "preflight"
    assert "no_cuda" in (receipt.error_message or "")
    assert receipt.best_epoch == -1
    assert receipt.best_metric is None
    assert receipt.checkpoint_sha256 is None
    assert entered["epoch_loop"] is False, "preflight gate let the epoch loop start"

    fold_dir = tmp_path / "fold_0"
    assert (fold_dir / "fold_receipt.json").exists(), (
        "spec §6.2: FAILED_PREFLIGHT must still leave a fold_receipt.json"
    )
    on_disk = json.loads((fold_dir / "fold_receipt.json").read_text())
    assert on_disk["status"] == "FAILED_PREFLIGHT"
    assert on_disk["error_class"] == "preflight"
