"""Tests for algorithm/p1/training/cli_formal.py."""
from __future__ import annotations

from typing import Any

import pandas as _pd
import pytest

from eye_diagnosis_p1.tests.fakes import FakeProtocolLoader

_FAKE_PROTOCOL_LOADER = FakeProtocolLoader(override={"patient_batch": 2})


def _argv(extra: list[str] | None = None) -> list[str]:
    base = [
        "--experiment", "E3",
        "--seed", "42",
        "--out-dir", "/tmp/cli_formal_test",
        "--max-epochs", "2",
        "--patience", "1",
        "--protocol", "/tmp/protocol.json",
        "--manifest", "/tmp/manifest.parquet",
        "--split-assignment", "/tmp/split.csv",
        "--fold-assignment", "/tmp/fold.csv",
        "--image-root", "/tmp/images",
    ]
    if extra:
        base.extend(extra)
    return base


def _patch_loaders_and_adapters(monkeypatch: pytest.MonkeyPatch, cli_formal: Any) -> None:
    """Patch artifact loaders + real adapters so main() runs without I/O or GPU."""
    monkeypatch.setattr(cli_formal, "load_p202a_protocol", lambda p: _FAKE_PROTOCOL_LOADER.load())
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
    monkeypatch.setattr(cli_formal, "build_real_torch_adapter", lambda: object())
    monkeypatch.setattr(
        cli_formal, "build_real_model_factory",
        lambda *, experiment, weights, device: (object(), {"meta": "fake"}),
    )
    monkeypatch.setattr(
        cli_formal, "build_real_dataloader_factory",
        lambda **kw: (lambda *, dataset, batch_size, num_workers,
                      pin_memory, split=None, fold=None: object()),
    )
    monkeypatch.setattr(cli_formal, "make_real_optimizer_factory",
                       lambda: (lambda m: object()))


def test_cli_main_returns_int(monkeypatch: pytest.MonkeyPatch) -> None:
    """main() returns an int exit code; the default invocation invokes the real path."""
    from p1.training import cli_formal

    _patch_loaders_and_adapters(monkeypatch, cli_formal)

    captured: dict[str, Any] = {}

    def _fake_run(**kw: Any) -> Any:
        captured.update(kw)
        from p1.training.receipts import ExperimentReceipt
        return ExperimentReceipt(
            experiment="E3", seed=42,
            folds_requested=[0], per_fold=[], overall_status="PASS",
        )

    monkeypatch.setattr(cli_formal, "run_formal_experiment", _fake_run)

    argv = _argv(["--fold", "0"])  # explicit single fold
    rc = cli_formal.main(argv)
    assert rc in (0, 1, 2)
    assert captured["folds"] == [0]


def test_cli_main_defaults_to_fold_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec: ``--fold`` is optional and defaults to ``[0]``."""
    from p1.training import cli_formal

    _patch_loaders_and_adapters(monkeypatch, cli_formal)

    captured: dict[str, Any] = {}

    def _fake_run(**kw: Any) -> Any:
        captured.update(kw)
        from p1.training.receipts import ExperimentReceipt
        return ExperimentReceipt(
            experiment="E3", seed=42,
            folds_requested=[0], per_fold=[], overall_status="PASS",
        )

    monkeypatch.setattr(cli_formal, "run_formal_experiment", _fake_run)

    rc = cli_formal.main(_argv())  # no --fold
    assert rc in (0, 1, 2)
    assert captured["folds"] == [0]


def test_cli_main_returns_int_for_multi_fold(monkeypatch: pytest.MonkeyPatch) -> None:
    from p1.training import cli_formal

    _patch_loaders_and_adapters(monkeypatch, cli_formal)

    captured: dict[str, Any] = {}

    def _fake_run(**kw: Any) -> Any:
        captured.update(kw)
        from p1.training.receipts import ExperimentReceipt
        return ExperimentReceipt(
            experiment="E3", seed=42,
            folds_requested=[0, 1], per_fold=[], overall_status="PASS",
        )

    monkeypatch.setattr(cli_formal, "run_formal_experiment", _fake_run)

    argv = _argv(["--fold", "0", "--fold", "1"])
    rc = cli_formal.main(argv)
    assert rc in (0, 1, 2)
    assert captured["folds"] == [0, 1]


def test_cli_exit_codes_match_overall_status() -> None:
    from p1.training.cli_formal import _exit_code_for
    from p1.training.receipts import ExperimentReceipt

    pass_r = ExperimentReceipt(overall_status="PASS", per_fold=[])
    blocked_r = ExperimentReceipt(overall_status="BLOCKED", per_fold=[])
    pf_r = ExperimentReceipt(overall_status="FAILED_PREFLIGHT", per_fold=[])
    assert _exit_code_for(pass_r) == 0
    assert _exit_code_for(blocked_r) == 1
    assert _exit_code_for(pf_r) == 2