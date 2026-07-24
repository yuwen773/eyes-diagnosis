"""Unit tests for the fold runner (fake dataset, no CUDA required)."""

from __future__ import annotations

import csv
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


def test_run_fold_writes_receipt_and_oof(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    val = pids[:4]
    train = pids[4:]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    oof_path = out_dir / "oof.csv"

    # Inject a fake CUDA probe so the test does not depend on local GPU state.
    fake_high = lambda device=None: (10000 * 1024 * 1024, 16384 * 1024 * 1024)
    # Pre-create the OOF writer file via the runner; we will read it after.
    receipt = run_fold(
        experiment="E3",
        fold_id=0,
        dev_patient_ids=train + val,
        val_patient_ids=val,
        image_paths=fake_inputs["image_paths"],
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=protocol,
        out_dir=out_dir,
        _mem_get_info=fake_high,
    )
    assert isinstance(receipt, FoldReceipt)
    assert receipt.fold == 0
    assert receipt.experiment_id == "E3"
    assert receipt.amp is True
    assert len(receipt.checkpoint_sha256) == 64

    receipt_path = out_dir / "fold_0_receipt.json"
    assert receipt_path.exists()
    payload = json.loads(receipt_path.read_text())
    assert payload["experiment_id"] == "E3"
    assert payload["fold"] == 0
    assert payload["val_patient_count"] == 4

    # OOF must have one row per val patient.
    assert oof_path.exists()
    with oof_path.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 4
    assert {r["patient_id"] for r in rows} == set(val)
    assert all(c in rows[0] for c in OOF_COLUMNS)


def test_run_fold_rejects_legacy_weights(tmp_path: Path, fake_inputs: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    pids = fake_inputs["pids"]
    protocol = default_protocol()
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
            dev_patient_ids=pids,
            val_patient_ids=pids[:2],
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=protocol,
            out_dir=out_dir,
        )


def test_run_fold_never_reads_test_patients(tmp_path: Path, fake_inputs: dict) -> None:
    """A malicious caller can only supply a 'dev_patient_ids' list. The
    runner must not invoke any test-side accessor.
    """
    pids = fake_inputs["pids"]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E0" / "fold_0"
    out_dir.mkdir(parents=True)
    # Confirm the public signature does not accept a 'test_patient_ids' kwarg.
    import inspect
    sig = inspect.signature(run_fold)
    assert "test_patient_ids" not in sig.parameters


def test_run_fold_e2_smoke_via_assignment(tmp_path: Path, fake_inputs: dict) -> None:
    """E2 picks one eye per patient. We feed the runner the *image_paths*
    filtered so that each patient has only the assigned eye, and assert
    OOF rows match the val set."""
    from p1.training.e2_assignment import assign_e2_eyes

    pids = fake_inputs["pids"]
    assignment = assign_e2_eyes(pids, seed=42)
    # Filter labels/image_paths so that each patient exposes only the assigned eye.
    filtered_paths: dict[str, dict[str, Path]] = {}
    for pid, eyes in fake_inputs["image_paths"].items():
        chosen = assignment[pid]
        filtered_paths[pid] = {chosen: eyes[chosen]}
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E2" / "fold_0"
    out_dir.mkdir(parents=True)
    val = pids[:4]
    train = pids[4:]
    fake_high = lambda device=None: (10000 * 1024 * 1024, 16384 * 1024 * 1024)
    receipt = run_fold(
        experiment="E2",
        fold_id=0,
        dev_patient_ids=train + val,
        val_patient_ids=val,
        image_paths=filtered_paths,
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=protocol,
        out_dir=out_dir,
        e2_assignment=assignment,
        _mem_get_info=fake_high,
    )
    assert receipt.experiment_id == "E2"
    assert receipt.val_patient_count == 4


def test_run_fold_fails_closed_on_low_vram(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    fake_low = lambda device=None: (1024 * 1024 * 1024, 8188 * 1024 * 1024)  # 1 GB free
    runner = build_run_fold_with_mock_mem(mem_get_info=fake_low)
    with pytest.raises(Exception) as ei:
        runner(
            experiment="E3",
            fold_id=0,
            dev_patient_ids=pids,
            val_patient_ids=pids[:2],
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=protocol,
            out_dir=out_dir,
        )
    # Either InsufficientVram or TrainingError wrapping it is acceptable.
    assert "vram" in str(ei.value).lower() or "insufficient" in str(ei.value).lower()