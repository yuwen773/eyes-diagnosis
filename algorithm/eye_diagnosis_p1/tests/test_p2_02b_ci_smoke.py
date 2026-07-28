"""CI smoke for the P2-02B end-to-end flow.

Uses fake torch adapter (no GPU work) so it runs on any host (CPU or GPU).
Verifies:
    * cli_formal.main(argv) returns 0
    * fold_0/ contains all 9 expected files
    * fold_receipt.status == 'PASS'
    * best_checkpoint.sha256 matches re-computed hash
    * wall-clock < 60s
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import pandas as _pd
import pytest


@pytest.fixture(scope="module")
def smoke_out_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("p2_02b_smoke")


def test_cli_formal_smoke_runs_end_to_end(
    smoke_out_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run cli_formal.main(['--fold', '0', ...]) with monkey-patched loaders
    and fake adapters; verify all 9 artifacts.
    """
    from p1.training import cli_formal
    from p1.training.receipts import ExperimentReceipt
    from eye_diagnosis_p1.tests.fakes import (
        FakeDataLoaderFactory,
        FakeModelFactory,
        FakeProtocolLoader,
        FakeTorchAdapter,
    )
    _FAKE_PROTOCOL_LOADER = FakeProtocolLoader(override={"patient_batch": 2})

    # Artifact loaders
    monkeypatch.setattr(cli_formal, "load_protocol", lambda p: _FAKE_PROTOCOL_LOADER.load())
    monkeypatch.setattr(
        cli_formal.pd, "read_parquet",
        lambda p: _pd.DataFrame({"patient_id": [1, 2, 3, 4]}),
    )
    monkeypatch.setattr(
        cli_formal, "load_split_assignment",
        lambda p: _pd.DataFrame({
            "patient_id": [1, 2, 3, 4], "fold": [0, 0, 0, 0],
            "split": ["train", "train", "val", "val"],
        }),
    )
    monkeypatch.setattr(
        cli_formal, "load_fold_assignment",
        lambda p, expected_folds: {str(pid): 0 for pid in range(1, 5)},
    )

    # Real-adapter builders → fakes. build_real_model_factory itself
    # returns a ModelFactory (a callable). The CLI stores the factory and
    # passes it to the runner; the runner calls factory(experiment, ...).
    def _fake_model_factory(*, experiment, weights, device):
        return FakeModelFactory(seed=42)  # the factory; callable returns (model, meta)

    monkeypatch.setattr(cli_formal, "build_real_torch_adapter", FakeTorchAdapter)
    monkeypatch.setattr(cli_formal, "build_real_model_factory", _fake_model_factory)
    monkeypatch.setattr(
        cli_formal, "build_real_dataloader_factory",
        lambda **kw: FakeDataLoaderFactory(
            batch_size=int(kw.get("batch_size", 2)),
            num_batches=3,
            num_classes=8,
        ),
    )
    monkeypatch.setattr(cli_formal, "make_real_optimizer_factory", lambda: lambda m: m)

    t0 = time.perf_counter()
    rc = cli_formal.main([
        "--fold", "0",
        "--experiment", "E3", "--seed", "42",
        "--out-dir", str(smoke_out_dir),
        "--max-epochs", "2", "--patience", "1",
        "--protocol", "/tmp/protocol.json",
        "--manifest", "/tmp/manifest.parquet",
        "--split-assignment", "/tmp/split.csv",
        "--fold-assignment", "/tmp/fold.csv",
        "--image-root", "/tmp/images",
    ])
    elapsed = time.perf_counter() - t0

    assert rc == 0, f"cli_formal.main returned {rc}"

    fold0 = smoke_out_dir / "fold_0"
    expected_files = {
        "protocol.json", "environment.json", "training_log.jsonl",
        "best_checkpoint.pth", "best_checkpoint.sha256",
        "validation_predictions.csv", "oof.csv",
        "metrics.json", "fold_receipt.json",
    }
    actual = {p.name for p in fold0.iterdir()}
    assert expected_files.issubset(actual), f"missing: {expected_files - actual}"

    receipt = json.loads((fold0 / "fold_receipt.json").read_text())
    assert receipt["status"] == "PASS"

    recorded_sha = (fold0 / "best_checkpoint.sha256").read_text().strip()
    actual_sha = hashlib.sha256((fold0 / "best_checkpoint.pth").read_bytes()).hexdigest()
    assert recorded_sha == actual_sha

    assert elapsed < 60.0, f"smoke took {elapsed:.2f}s (>60s)"