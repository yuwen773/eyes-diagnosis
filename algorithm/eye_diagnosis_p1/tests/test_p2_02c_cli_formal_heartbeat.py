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


# --- heartbeat tests (Task 5) ----------------------------------------------


def _make_pass_receipt(folds):
    from p1.training.receipts import ExperimentReceipt
    return ExperimentReceipt(
        experiment="E3", seed=42, folds_requested=list(folds),
        per_fold=[], overall_status="PASS",
    )


def _capture_cli_formal_stdout(monkeypatch, argv: list[str]) -> int:
    """Run cli_formal.main(argv) with everything monkey-patched; return rc."""
    from p1.training import cli_formal
    _patch_loaders_and_adapters(monkeypatch, cli_formal)
    monkeypatch.setattr(
        cli_formal, "run_formal_experiment",
        lambda **kw: _make_pass_receipt(kw.get("folds", [0])),
    )
    return cli_formal.main(argv)


def test_cli_formal_default_emits_no_heartbeat_lines(monkeypatch, capsys) -> None:
    argv = _argv(["--fold", "0"])  # no --emit-heartbeat
    rc = _capture_cli_formal_stdout(monkeypatch, argv)
    assert rc == 0
    out = capsys.readouterr().out
    assert "HEARTBEAT" not in out, (
        f"default mode must not emit heartbeats; got: {out!r}"
    )


def test_cli_formal_with_emit_heartbeat_flag(monkeypatch) -> None:
    """With --emit-heartbeat, cli_formal should propagate the flag down to
    formal_fold_runner.run_formal_fold via the orchestrator."""
    from p1.training import cli_formal, orchestrator
    _patch_loaders_and_adapters(monkeypatch, cli_formal)
    captured: dict = {}
    def _capture_run_formal_fold(**kw):
        captured["emit_heartbeat"] = kw.get("emit_heartbeat", False)
        # Synthesize a single FoldReceipt and write the 9 artifacts so the
        # orchestrator-level runner has something to enumerate.
        from p1.training.receipts import FoldReceipt
        out_root = kw["out_dir"]
        out_root.mkdir(parents=True, exist_ok=True)
        fold_dir = out_root / "fold_0"; fold_dir.mkdir(parents=True, exist_ok=True)
        r = FoldReceipt(status="PASS", best_epoch=0, best_metric=0.5,
                        fold=0, started_at="t0", finished_at="t1",
                        duration_s=0.0, config_hash="c", frozen_inputs={})
        from p1.training.formal_fold_runner import _atomic_write_json
        _atomic_write_json(fold_dir / "fold_receipt.json", r.to_dict())
        return r
    # Patch the symbol that orchestrator imported:
    monkeypatch.setattr(orchestrator.formal_fold_runner, "run_formal_fold",
                        _capture_run_formal_fold)
    monkeypatch.setattr(
        cli_formal, "run_formal_experiment",
        lambda **kw: orchestrator.run_formal_experiment(**kw),
    )

    rc = cli_formal.main(_argv(["--fold", "0", "--emit-heartbeat"]))
    assert rc in (0, 1, 2)
    assert captured.get("emit_heartbeat") is True, (
        "cli_formal must forward --emit-heartbeat to run_formal_fold via "
        "orchestrator.run_formal_experiment; orchestrator must forward to "
        "formal_fold_runner.run_formal_fold."
    )


def test_run_formal_fold_emits_heartbeats_in_order(tmp_path, monkeypatch, capsys) -> None:
    """Direct unit test of formal_fold_runner.run_formal_fold emission.

    We mock train_one_epoch / evaluate / save_checkpoint / the OOF writer
    to produce a tiny 1-epoch loop, and assert stdout contains exactly:
      HEARTBEAT EPOCH 0 START
      HEARTBEAT EPOCH 0 PASS
      HEARTBEAT CHECKPOINT_SAVED <path>
    in that order.
    """
    from p1.training import formal_fold_runner as ffr
    from p1.training.engine import EpochStats, ValStats
    from eye_diagnosis_p1.tests.fakes import FakeModelFactory

    monkeypatch.setattr(ffr, "train_one_epoch",
                        lambda **kw: EpochStats(loss=0.1, num_batches=1,
                                                num_samples=2, gpu_step_ms=1.0))
    monkeypatch.setattr(ffr, "evaluate",
                        lambda **kw: ValStats(loss=0.2, macro_auprc=0.5,
                                              num_batches=1, num_samples=2))
    monkeypatch.setattr(ffr, "save_checkpoint", lambda state_dict, metadata, path: None)
    monkeypatch.setattr(ffr, "_atomic_write_json", lambda *a, **kw: None)
    monkeypatch.setattr(ffr, "_atomic_write_csv", lambda *a, **kw: None)
    monkeypatch.setattr(ffr, "compute_full_metrics",
                        lambda y_true, y_proba, threshold: {"macro_auprc": 0.5})

    # Add cfg fields that run_formal_fold reads unconditionally.
    cfg = {
        "schema_version": "p2-02a-v1",
        "learning_rate": 1e-4,
        "weight_decay": 1e-4,
        "scheduler_factor": 0.5,
        "scheduler_patience": 2,
        "early_stopping_patience": 1,
        "max_epochs": 1,
        "patient_batch": 2,
        "amp": True,
        "threshold_policy": "fixed_0.5",
    }

    receipt = ffr.run_formal_fold(
        out_dir=tmp_path, manifest_pids={1, 2, 3, 4},
        split_df=_pd.DataFrame({"patient_id": [1, 2]}),
        fold_df=_pd.DataFrame({"patient_id": [1, 2], "fold": [0, 0]}),
        cfg=cfg,
        torch_adapter=object(),
        model_factory=FakeModelFactory(seed=42),
        data_factory=lambda **kw: object(),
        fold=0, experiment="E3", seed=42, max_epochs=1, patience=1,
        emit_heartbeat=True,
    )

    out = capsys.readouterr().out
    e0_start = out.index("HEARTBEAT EPOCH 0 START")
    e0_pass = out.index("HEARTBEAT EPOCH 0 PASS")
    ckpt = out.index("HEARTBEAT CHECKPOINT_SAVED")
    assert e0_start < e0_pass < ckpt, (
        f"heartbeat order violated: start={e0_start}, pass={e0_pass}, "
        f"ckpt={ckpt}; full stdout={out!r}"
    )