"""Tests for algorithm/p1/training/fold0_smoke.py.

Drives the orchestrator end-to-end with a fake SubprocessRunner so the
test exercises preflight -> subprocess -> reload -> report without a GPU.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


# --- helpers ----------------------------------------------------------------


class _FakePreflightResult:
    def __init__(self, ok: bool, reason: str | None = None) -> None:
        self.ok = ok; self.reason = reason


class _FakePreflightFail:
    ok = False; reason = "insufficient_vram"


def _install_pass_preflight(monkeypatch, fold0_smoke) -> None:
    monkeypatch.setattr(fold0_smoke, "build_real_torch_adapter", lambda: object())
    monkeypatch.setattr(
        fold0_smoke, "run_preflight",
        lambda cfg, adapter: _FakePreflightResult(ok=True),
    )
    monkeypatch.setattr(
        fold0_smoke, "load_p202a_protocol",
        lambda p: {"schema_version": "p2-02a-v1"},
    )


def _install_fail_preflight(monkeypatch, fold0_smoke) -> None:
    monkeypatch.setattr(fold0_smoke, "build_real_torch_adapter", lambda: object())
    monkeypatch.setattr(
        fold0_smoke, "run_preflight",
        lambda cfg, adapter: _FakePreflightFail(),
    )
    monkeypatch.setattr(
        fold0_smoke, "load_p202a_protocol",
        lambda p: {"schema_version": "p2-02a-v1"},
    )


def _install_pass_subprocess(monkeypatch, fold0_smoke,
                             *, write_nine_artifacts: bool = True,
                             verdict: str = "PASS",
                             error_class=None) -> None:
    from p1.training.training_watchdog import WatchResult
    result = WatchResult(
        cell_label="fold0", verdict=verdict, error_class=error_class,
        last_heartbeat_epoch=0, last_checkpoint="fold_0/best_checkpoint.pth",
        exit_code=0, killed=False, timed_out=False,
        stderr_tail="", elapsed_seconds=1.0,
    )
    monkeypatch.setattr(
        fold0_smoke, "run_subprocess",
        lambda cmd, out_dir, *, cell_label="fold0", config=None, terminator=None: result,
    )

    if write_nine_artifacts:
        from p1.training.training_watchdog import WatchResult
        def _write_artifacts(cmd, out_dir, *, cell_label="fold0", config=None, terminator=None):
            fold0 = out_dir / "fold_0"
            fold0.mkdir(parents=True, exist_ok=True)
            for name in ("protocol.json", "environment.json",
                         "training_log.jsonl", "best_checkpoint.sha256",
                         "validation_predictions.csv", "oof.csv",
                         "metrics.json", "fold_receipt.json"):
                (fold0 / name).write_text("{}", encoding="utf-8")
            # Minimal valid best_checkpoint.pth + sidecar
            from p1.training.checkpoint import save_checkpoint, sha256_file
            from torch import nn
            model = nn.Linear(2, 1)
            ckpt_path = fold0 / "best_checkpoint.pth"
            save_checkpoint(
                {k: v.detach().clone() for k, v in model.state_dict().items()},
                metadata={"schema_version": "p2-02b-v1", "fold": 0,
                          "epoch": 0, "best_metric": 0.0,
                          "config_hash": "abcd",
                          "saved_at": "2026-07-28T00:00:00Z"},
                path=ckpt_path,
            )
            (fold0 / "best_checkpoint.sha256").write_text(
                sha256_file(ckpt_path) + "\n", encoding="utf-8"
            )
            result = WatchResult(
                cell_label=cell_label, verdict="PASS", error_class=None,
                last_heartbeat_epoch=0,
                last_checkpoint="fold_0/best_checkpoint.pth",
                exit_code=0, killed=False, timed_out=False,
                stderr_tail="", elapsed_seconds=1.0,
            )
            return result
        monkeypatch.setattr(fold0_smoke, "run_subprocess", _write_artifacts)


# --- tests ------------------------------------------------------------------


def _base_argv(tmp_path: Path) -> list[str]:
    return [
        "--protocol", "/tmp/protocol.json",
        "--manifest", "/tmp/manifest.parquet",
        "--split-assignment", "/tmp/split.csv",
        "--fold-assignment", "/tmp/fold.csv",
        "--image-root", "/tmp/images",
        "--out-dir", str(tmp_path),
        "--max-epochs", "1",
        "--patience", "1",
    ]


def test_fold0_smoke_preflight_fail_returns_2(monkeypatch, tmp_path: Path) -> None:
    from p1.training import fold0_smoke
    _install_fail_preflight(monkeypatch, fold0_smoke)
    rc = fold0_smoke.main(_base_argv(tmp_path))
    assert rc == 2
    report = json.loads((tmp_path / "fold0_smoke_report.json").read_text())
    assert report["verdict"] == "BLOCKED"
    assert report["error_class"] == "preflight"


def test_fold0_smoke_subprocess_blocked_returns_1(monkeypatch, tmp_path: Path) -> None:
    from p1.training import fold0_smoke
    _install_pass_preflight(monkeypatch, fold0_smoke)
    _install_pass_subprocess(monkeypatch, fold0_smoke,
                             write_nine_artifacts=False,
                             verdict="BLOCKED", error_class="nonzero_exit")
    rc = fold0_smoke.main(_base_argv(tmp_path))
    assert rc == 1
    report = json.loads((tmp_path / "fold0_smoke_report.json").read_text())
    assert report["verdict"] == "BLOCKED"
    assert report["error_class"] == "nonzero_exit"
    assert "reload_verification" not in report


def test_fold0_smoke_full_pass_returns_0(monkeypatch, tmp_path: Path) -> None:
    from p1.training import fold0_smoke
    _install_pass_preflight(monkeypatch, fold0_smoke)
    _install_pass_subprocess(monkeypatch, fold0_smoke)  # writes 9 artifacts
    rc = fold0_smoke.main(_base_argv(tmp_path))
    assert rc == 0
    report = json.loads((tmp_path / "fold0_smoke_report.json").read_text())
    assert report["verdict"] == "PASS"
    assert report["artifact_tree_complete"] is True
    assert report["reload_verification"]["ok"] is True
    assert report["reload_verification"]["sha256_match"] is True
    assert report["reload_verification"]["state_dict_identical"] is True


def test_fold0_smoke_reload_mismatch_returns_1(monkeypatch, tmp_path: Path) -> None:
    """Subprocess reports PASS but reload_verify raises ReloadError
    (simulated by writing a checkpoint with a stale sha256 sidecar).
    """
    from p1.training import fold0_smoke
    _install_pass_preflight(monkeypatch, fold0_smoke)
    # Manually populate the 9 artifacts so the sidecar path exists;
    # _install_pass_subprocess only installs the mock (it doesn't run it).
    fold0 = tmp_path / "fold_0"
    fold0.mkdir(parents=True, exist_ok=True)
    for name in ("protocol.json", "environment.json",
                 "training_log.jsonl", "best_checkpoint.sha256",
                 "validation_predictions.csv", "oof.csv",
                 "metrics.json", "fold_receipt.json"):
        (fold0 / name).write_text("{}", encoding="utf-8")
    from p1.training.checkpoint import save_checkpoint, sha256_file
    from torch import nn
    ckpt = fold0 / "best_checkpoint.pth"
    save_checkpoint(
        {k: v.detach().clone() for k, v in nn.Linear(2, 1).state_dict().items()},
        metadata={"schema_version": "p2-02b-v1", "fold": 0,
                  "epoch": 0, "best_metric": 0.0, "config_hash": "abcd",
                  "saved_at": "2026-07-28T00:00:00Z"},
        path=ckpt,
    )
    (fold0 / "best_checkpoint.sha256").write_text(
        sha256_file(ckpt) + "\n", encoding="utf-8"
    )
    # Now install the mock so main() still sees PASS and runs reload_verify.
    _install_pass_subprocess(monkeypatch, fold0_smoke, write_nine_artifacts=False)
    # Then corrupt the sidecar to force reload mismatch.
    (fold0 / "best_checkpoint.sha256").write_text("0" * 64 + "\n")

    rc = fold0_smoke.main(_base_argv(tmp_path))
    assert rc == 1
    report = json.loads((tmp_path / "fold0_smoke_report.json").read_text())
    assert report["verdict"] == "BLOCKED"
    assert report["error_class"] == "reload_mismatch"


def test_fold0_smoke_report_schema_version(monkeypatch, tmp_path: Path) -> None:
    from p1.training import fold0_smoke
    _install_pass_preflight(monkeypatch, fold0_smoke)
    _install_pass_subprocess(monkeypatch, fold0_smoke)
    fold0_smoke.main(_base_argv(tmp_path))
    report = json.loads((tmp_path / "fold0_smoke_report.json").read_text())
    assert report["schema_version"] == "p2-02c-v1"