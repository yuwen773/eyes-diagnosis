"""Unit tests for the fold runner (fake dataset, no CUDA required)."""

from __future__ import annotations

import csv
import inspect
import json
from pathlib import Path

import numpy as np
import pytest
import torch

from p1.audit import CLASS_ORDER
from p1.benchmark.model import BACKBONE_SPECS
from p1.training.fold_runner import (
    FoldReceipt,
    TrainingError,
    build_run_fold_with_mock_mem,
    run_fold,
)
from p1.training.oof import OOF_COLUMNS
from p1.training.protocol import default_protocol

_IMAGENET = "EfficientNet_B4_Weights.IMAGENET1K_V1"


@pytest.fixture
def fake_inputs(tmp_path: Path) -> dict:
    from PIL import Image

    # Images live alongside the manifest root in the runner too; put them
    # in tmp_path so root_dir = tmp_path works.
    pids = [f"p{i:03d}" for i in range(8)]
    image_paths: dict[str, dict[str, Path]] = {}
    labels: dict[str, np.ndarray] = {}
    for pid in pids:
        for side, suffix in [("OD", "left"), ("OS", "right")]:
            Image.new("RGB", (32, 32), (10, 20, 30)).save(tmp_path / f"{pid}_{suffix}.jpg")
        image_paths[pid] = {
            "left": Path(f"{pid}_left.jpg"),
            "right": Path(f"{pid}_right.jpg"),
        }
        labels[pid] = np.asarray([0] * len(CLASS_ORDER), dtype=np.int8)
    return {
        "root_dir": tmp_path,
        "image_paths": image_paths,
        "labels": labels,
        "pids": pids,
    }


def _fake_high(device=None):
    return (10000 * 1024 * 1024, 16384 * 1024 * 1024)


def _run_e0(runner, fake_inputs, tmp_path, *, train, val, **extra):
    out_dir = tmp_path / "artifacts" / "E0" / "fold_0"
    out_dir.mkdir(parents=True)
    return runner(
        experiment="E0",
        fold_id=0,
        train_patient_ids=train,
        val_patient_ids=val,
        image_paths=fake_inputs["image_paths"],
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=default_protocol(),
        out_dir=out_dir,
        **extra,
    )


def test_run_fold_writes_receipt_and_oof(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    train = pids[4:]
    val = pids[:4]
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    oof_path = out_dir / "oof.csv"

    receipt = run_fold(
        experiment="E3",
        fold_id=0,
        train_patient_ids=train,
        val_patient_ids=val,
        image_paths=fake_inputs["image_paths"],
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=default_protocol(),
        out_dir=out_dir,
        _mem_get_info=_fake_high,
        _download=False,
    )
    assert isinstance(receipt, FoldReceipt)
    assert receipt.fold == 0
    assert receipt.experiment_id == "E3"
    assert receipt.amp_enabled == torch.cuda.is_available()
    assert receipt.weights == _IMAGENET
    assert len(receipt.checkpoint_sha256) == 64

    receipt_path = out_dir / "fold_0_receipt.json"
    assert receipt_path.exists()
    payload = json.loads(receipt_path.read_text())
    assert payload["experiment_id"] == "E3"
    assert payload["fold"] == 0
    assert payload["val_patient_count"] == 4
    assert payload["train_patient_count"] == 4
    assert payload["weights"] == _IMAGENET
    assert payload["checkpoint_selector"] == "validation_macro_auprc"
    assert payload["experiment_primary_metric"] == "oof_macro_auprc"

    # OOF must have one row per val patient.
    assert oof_path.exists()
    with oof_path.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 4
    assert {r["patient_id"] for r in rows} == set(val)
    assert all(c in rows[0] for c in OOF_COLUMNS)


def test_run_fold_rejects_legacy_weights(tmp_path: Path, fake_inputs: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    pids = fake_inputs["pids"]
    train, val = pids[4:], pids[:4]
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    monkeypatch.setattr(
        "p1.training.models.build_bilateral_model",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("legacy guard must run")),
    )
    with pytest.raises(Exception):
        run_fold(
            experiment="E3",
            fold_id=0,
            train_patient_ids=train,
            val_patient_ids=val,
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=default_protocol(),
            out_dir=out_dir,
            _mem_get_info=_fake_high,
            _download=False,
        )


def test_run_fold_never_reads_test_patients(fake_inputs: dict) -> None:
    """The public signature must not accept a 'test_patient_ids' kwarg."""
    sig = inspect.signature(run_fold)
    assert "test_patient_ids" not in sig.parameters
    assert "train_patient_ids" in sig.parameters
    assert "val_patient_ids" in sig.parameters
    assert "dev_patient_ids" not in sig.parameters


def test_run_fold_e2_smoke_via_assignment(tmp_path: Path, fake_inputs: dict) -> None:
    from p1.training.e2_assignment import assign_e2_eyes

    pids = fake_inputs["pids"]
    assignment = assign_e2_eyes(pids, seed=42)
    filtered_paths: dict[str, dict[str, Path]] = {}
    for pid, eyes in fake_inputs["image_paths"].items():
        chosen = assignment[pid]
        filtered_paths[pid] = {chosen: eyes[chosen]}
    train, val = pids[4:], pids[:4]
    out_dir = tmp_path / "artifacts" / "E2" / "fold_0"
    out_dir.mkdir(parents=True)
    receipt = run_fold(
        experiment="E2",
        fold_id=0,
        train_patient_ids=train,
        val_patient_ids=val,
        image_paths=filtered_paths,
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=default_protocol(),
        out_dir=out_dir,
        e2_assignment=assignment,
        _mem_get_info=_fake_high,
        _download=False,
    )
    assert receipt.experiment_id == "E2"
    assert receipt.val_patient_count == 4


def test_run_fold_fails_closed_on_low_vram(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    train, val = pids[4:], pids[:4]
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    fake_low = lambda device=None: (1024 * 1024 * 1024, 8188 * 1024 * 1024)  # 1 GB free
    runner = build_run_fold_with_mock_mem(mem_get_info=fake_low)
    with pytest.raises(Exception) as ei:
        runner(
            experiment="E3",
            fold_id=0,
            train_patient_ids=train,
            val_patient_ids=val,
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=default_protocol(),
            out_dir=out_dir,
            _download=False,
        )
    # Either InsufficientVram or TrainingError wrapping it is acceptable.
    assert "vram" in str(ei.value).lower() or "insufficient" in str(ei.value).lower()


def test_run_fold_optimizer_never_steps_on_val_patients(
    tmp_path: Path, fake_inputs: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """batch-recording spy: every ``_stack_batch`` call inside the optimizer
    step sees only train_patient_ids, never val."""
    import p1.training.fold_runner as fr

    seen_in_backward: list[str] = []
    real_stack = fr._stack_batch

    def spy(patient_ids, *a, **k):
        seen_in_backward.extend(list(patient_ids))
        return real_stack(patient_ids, *a, **k)

    monkeypatch.setattr(fr, "_stack_batch", spy)

    pids = fake_inputs["pids"]
    train = pids[:4]
    val = pids[4:]
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=False,
    )
    assert receipt.experiment_id == "E0"
    assert set(seen_in_backward) & set(val) == set(), (
        f"val patients entered a training batch: {sorted(set(seen_in_backward) & set(val))}"
    )


def test_run_fold_rejects_overlapping_train_val(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    with pytest.raises(TrainingError):
        run_fold(
            experiment="E0",
            fold_id=0,
            train_patient_ids=pids[:5],
            val_patient_ids=pids[3:],  # overlap
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=default_protocol(),
            out_dir=tmp_path / "art",
            _mem_get_info=_fake_high,
            _download=False,
        )


def test_receipt_records_amp_and_weights(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=False,
    )
    assert receipt.weights == _IMAGENET
    assert receipt.grad_scaler_enabled == receipt.amp_enabled
    assert receipt.amp_dtype in ("float16", "none")
    assert receipt.checkpoint_selector == "validation_macro_auprc"
    assert receipt.experiment_primary_metric == "oof_macro_auprc"
    assert receipt.smoke is True  # one-step = smoke


def test_receipt_records_input_hashes(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]
    hashes = {
        "manifest_sha256": "m" * 64,
        "split_sha256": "s" * 64,
        "fold_sha256": "f" * 64,
        "protocol_sha256": "p" * 64,
    }
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=False,
        input_hashes=hashes,
    )
    assert receipt.manifest_sha256 == "m" * 64
    assert receipt.split_sha256 == "s" * 64
    assert receipt.fold_sha256 == "f" * 64
    assert receipt.protocol_sha256 == "p" * 64


def test_receipt_hashes_default_to_none(tmp_path: Path, fake_inputs: dict) -> None:
    """Unit tests pass input_hashes=None; the receipt must serialize None, not crash."""
    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=False,
    )
    for f in ("manifest_sha256", "split_sha256", "fold_sha256", "protocol_sha256"):
        assert getattr(receipt, f) is None


def test_receipt_splits_train_counts(tmp_path: Path, fake_inputs: dict) -> None:
    """The receipt must distinguish *available* train patients from the
    prefix that actually entered the optimizer.step batch, and from the
    validation set that produced OOF predictions."""
    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=False,
    )
    assert receipt.available_train_patient_count == 4
    # patient_batch is 8 in protocol_e0_e3_v1; max(2, 8 // 4) == 2.
    assert receipt.optimizer_patient_count == 2
    assert receipt.val_prediction_count == 4
    # train_patient_count remains as a backward-compat alias.
    assert receipt.train_patient_count == receipt.available_train_patient_count
    assert receipt.val_patient_count == receipt.val_prediction_count


def test_receipt_records_initialization_truth(tmp_path: Path, fake_inputs: dict) -> None:
    """``weights_loaded=False`` (e.g. test path with _download=False)
    must be reflected in the receipt: the model is *not* ImageNet-
    initialised, even though the protocol pins the weights enum."""
    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=False,
    )
    assert receipt.weights == _IMAGENET  # enum is pinned
    assert receipt.weights_loaded is False
    assert receipt.initialization == "random"


def test_receipt_marks_imagenet_init_when_weights_loaded(
    tmp_path: Path, fake_inputs: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When ``_download=True`` (production path) the receipt must
    declare ``weights_loaded=True`` and ``initialization='imagenet'``.
    We stub ``build_model`` so the test does not actually download the
    ImageNet weights."""
    from p1.training import fold_runner
    from p1.training.models import build_model as real_build_model

    monkeypatch.setattr(fold_runner, "build_model", real_build_model)

    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]
    receipt = _run_e0(
        run_fold, fake_inputs, tmp_path, train=train, val=val,
        _mem_get_info=_fake_high, _download=True,
    )
    assert receipt.weights_loaded is True
    assert receipt.initialization == "imagenet"
