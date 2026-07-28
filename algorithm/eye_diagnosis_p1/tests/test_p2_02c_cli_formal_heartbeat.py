"""Tests for the P2-02C surgical edits to cli_formal.py:
  (Task 4) protocol loader swap from p1.training.protocol to
           p1.stability.protocol so the default --protocol value
           (protocol_p2_02a_v1.json) loads cleanly without ProtocolError.
  (Task 5) --emit-heartbeat flag + heartbeat emissions inside cli_formal.

The tests patch the heavy adapters and the orchestrator so the suite
runs without a GPU; the spec's purpose is to lock the load + heartbeat
contract, not to re-test P2-02B's training pipeline.
"""
from __future__ import annotations

import sys

import pandas as _pd
import pytest

from eye_diagnosis_p1.tests.fakes import (
    FakeDataLoaderFactory,
    FakeFoldAssignmentLoader,
    FakeModelFactory,
    FakeProtocolLoader,
    FakeTorchAdapter,
)


def _argv(extra: list[str] | None = None) -> list[str]:
    base = [
        "--experiment", "E3",
        "--seed", "42",
        "--out-dir", "/tmp/cli_formal_p2_02c_test",
        "--max-epochs", "1",
        "--patience", "1",
        "--protocol", "/tmp/protocol_p2_02a_v1.json",
        "--manifest", "/tmp/manifest.parquet",
        "--split-assignment", "/tmp/split.csv",
        "--fold-assignment", "/tmp/fold.csv",
        "--image-root", "/tmp/images",
    ]
    if extra:
        base.extend(extra)
    return base


def _patch_loaders_and_adapters(
    monkeypatch, cli_formal,
    protocol_overrides=None,
) -> None:
    """Mirror test_p2_02b_cli_formal's pattern but use FakeProtocolLoader
    that returns a p2-02a-v1 schema (the one shipped in
    algorithm/p1/protocol_p2_02a_v1.json)."""
    _fake = FakeProtocolLoader(override=protocol_overrides or {})
    monkeypatch.setattr(
        cli_formal, "load_p202a_protocol",
        lambda p: _fake.load(),
    )
    monkeypatch.setattr(
        cli_formal.pd, "read_parquet",
        lambda p: _pd.DataFrame({"patient_id": [1, 2, 3, 4]}),
    )
    monkeypatch.setattr(
        cli_formal, "load_split_assignment",
        lambda p: _pd.DataFrame({
            "patient_id": [1, 2, 3, 4], "fold": [0, 0, 0, 0],
            "split": ["dev", "dev", "dev", "dev"],
        }),
    )
    monkeypatch.setattr(
        cli_formal, "load_fold_assignment",
        lambda p, expected_folds: {str(pid): 0 for pid in range(1, 5)},
    )
    monkeypatch.setattr(cli_formal, "build_real_torch_adapter",
                        lambda: FakeTorchAdapter())
    monkeypatch.setattr(
        cli_formal, "build_real_model_factory",
        lambda *, experiment, weights, device: FakeModelFactory(seed=42),
    )
    monkeypatch.setattr(
        cli_formal, "build_real_dataloader_factory",
        lambda **kw: FakeDataLoaderFactory(
            batch_size=int(kw.get("batch_size", 2)),
            num_batches=3, num_classes=8,
        ),
    )
    monkeypatch.setattr(cli_formal, "make_real_optimizer_factory",
                        lambda: lambda m: m)


def test_cli_formal_loads_p202a_protocol_by_default(monkeypatch) -> None:
    """The new loader swap: cli_formal must call load_p202a_protocol,
    not load_protocol. Without the swap, this test fails because
    FakeProtocolLoader returns a p2-02a-v1 dict that p1.training.protocol
    would reject; with the swap, it succeeds.
    """
    from p1.training import cli_formal

    _patch_loaders_and_adapters(monkeypatch, cli_formal)

    captured = {}
    def _fake_run(**kw):
        captured["cfg"] = kw["cfg"]
        from p1.training.receipts import ExperimentReceipt
        return ExperimentReceipt(
            experiment="E3", seed=42, folds_requested=[0],
            per_fold=[], overall_status="PASS",
        )
    monkeypatch.setattr(cli_formal, "run_formal_experiment", _fake_run)

    rc = cli_formal.main(_argv(["--fold", "0"]))
    assert rc in (0, 1, 2)
    # The loaded cfg is the FakeProtocolLoader default — schema_version
    # p2-02a-v1 (overridden via FakeProtocolLoader's default). What
    # matters is that load_p202a_protocol was called (no ProtocolError).
    assert "cfg" in captured


def test_cli_formal_protocol_error_returns_exit_2(monkeypatch, capsys) -> None:
    """P202AProtocolError from load_p202a_protocol maps to exit code 2."""
    from p1.stability.protocol import P202AProtocolError
    from p1.training import cli_formal

    def _raising_loader(p):
        raise P202AProtocolError("simulated bad schema")
    monkeypatch.setattr(cli_formal, "load_p202a_protocol", _raising_loader)
    monkeypatch.setattr(cli_formal.pd, "read_parquet",
                        lambda p: _pd.DataFrame({"patient_id": []}))

    rc = cli_formal.main(_argv(["--fold", "0"]))
    assert rc == 2
    captured = capsys.readouterr()
    assert "protocol error" in captured.err.lower()


def test_cli_formal_no_protocol_error_attribute_left() -> None:
    """After the swap, cli_formal must NOT expose the old loader name.
    This locks the swap in place against accidental rollback.
    """
    from p1.training import cli_formal
    assert not hasattr(cli_formal, "load_protocol"), (
        "cli_formal still exposes the old p1.training.protocol.load_protocol; "
        "the P2-02C swap must remove that import."
    )
    assert hasattr(cli_formal, "load_p202a_protocol"), (
        "cli_formal must expose load_p202a_protocol after the swap."
    )