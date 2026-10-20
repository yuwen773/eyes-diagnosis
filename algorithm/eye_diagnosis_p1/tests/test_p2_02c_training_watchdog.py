"""Tests for algorithm/p1/training/training_watchdog.py (data classes only).

Subprocess-runner tests live in this file (Task 2 extends the same module).
This file covers: heartbeat parser, WatchConfig defaults, Terminator
protocol, RealTerminator, WatchResult.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest


def test_parse_heartbeat_line_epoch_start() -> None:
    from p1.training.training_watchdog import HeartbeatEvent, parse_heartbeat_line
    ev = parse_heartbeat_line("HEARTBEAT EPOCH 0 START\n")
    assert ev == HeartbeatEvent(kind="EPOCH", epoch=0, status="START")


def test_parse_heartbeat_line_epoch_pass() -> None:
    from p1.training.training_watchdog import HeartbeatEvent, parse_heartbeat_line
    ev = parse_heartbeat_line("HEARTBEAT EPOCH 3 PASS")
    assert ev == HeartbeatEvent(kind="EPOCH", epoch=3, status="PASS")


def test_parse_heartbeat_line_checkpoint_saved() -> None:
    from p1.training.training_watchdog import HeartbeatEvent, parse_heartbeat_line
    ev = parse_heartbeat_line("HEARTBEAT CHECKPOINT_SAVED fold_0/best_checkpoint.pth")
    assert ev == HeartbeatEvent(kind="CHECKPOINT",
                                checkpoint_path="fold_0/best_checkpoint.pth")


def test_parse_heartbeat_line_rejects_stage_vocabulary() -> None:
    from p1.training.training_watchdog import parse_heartbeat_line
    # T2 STAGE vocabulary is intentionally NOT accepted (training pipeline
    # has its own vocabulary; coupling would entangle the two pipelines).
    assert parse_heartbeat_line("STAGE warmup START") is None


def test_parse_heartbeat_line_rejects_malformed() -> None:
    from p1.training.training_watchdog import parse_heartbeat_line
    assert parse_heartbeat_line("HEARTBEAT EPOCH -1 START") is None
    assert parse_heartbeat_line("HEARTBEAT EPOCH 0 FROBNICATE") is None
    assert parse_heartbeat_line("not a heartbeat line at all") is None
    assert parse_heartbeat_line("") is None


def test_parse_heartbeat_line_tolerates_trailing_whitespace() -> None:
    from p1.training.training_watchdog import HeartbeatEvent, parse_heartbeat_line
    ev = parse_heartbeat_line("   HEARTBEAT EPOCH 1 PASS   \n")
    assert ev == HeartbeatEvent(kind="EPOCH", epoch=1, status="PASS")


def test_watch_config_defaults_match_frozen_t2() -> None:
    from p1.training.training_watchdog import WatchConfig
    cfg = WatchConfig()
    assert cfg.process_timeout_seconds == 300.0
    assert cfg.heartbeat_timeout_seconds == 90.0
    assert cfg.poll_interval_seconds == 0.1


def test_watch_config_is_frozen() -> None:
    from p1.training.training_watchdog import WatchConfig
    cfg = WatchConfig()
    with pytest.raises(Exception):  # FrozenInstanceError or AttributeError
        cfg.process_timeout_seconds = 1.0  # type: ignore[misc]


def test_real_terminator_terminate_does_not_raise_on_unknown_pid(
    monkeypatch,
) -> None:
    """terminate() is total: every OS-level failure is swallowed.

    This must not signal a real process. An earlier version called
    ``terminate(2**30)`` directly, which on POSIX resolves to
    ``os.killpg(os.getpgid(2**30), SIGTERM)`` — a live signal to whatever
    group happens to own that pid. On a CI runner that can take down the
    runner itself, which is exactly what happened: the pytest step was
    cancelled twice at the same point. The failure modes are injected
    instead of provoked.
    """
    import errno
    from p1.training.training_watchdog import RealTerminator

    terminator = RealTerminator()

    for exc in (
        ProcessLookupError(errno.ESRCH, "no such process"),
        PermissionError(errno.EPERM, "not permitted"),
        OSError(errno.EINVAL, "invalid argument"),
    ):
        def _boom(*_a, _exc=exc, **_k):
            raise _exc

        # Patch the seam, not os: os.getpgid does not exist on Windows.
        monkeypatch.setattr(
            RealTerminator, "_signal_process_group", staticmethod(_boom)
        )
        # Must not raise for any of them.
        terminator.terminate(123456)


# --- runner tests (Task 2) -------------------------------------------------


class _RecordingTerminator:
    """Test Terminator that records calls and never actually kills."""

    def __init__(self) -> None:
        self.calls: list[int] = []

    def terminate(self, pid: int) -> None:
        self.calls.append(pid)


def _run_child(script: str, *, out_dir: Path,
               config: "WatchConfig | None" = None) -> "WatchResult":
    """Spawn `python -u -c <script>` with the runner and return the result."""
    from p1.training.training_watchdog import (
        RealTerminator, SubprocessRunner, WatchConfig,
    )
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", "-c", script],
        out_dir=out_dir,
        cell_label="fold0",
        config=config or WatchConfig(),
        terminator=RealTerminator(),
    )
    return runner.run()


def test_subprocess_runner_exit_zero_returns_pass(tmp_path: Path) -> None:
    from p1.training.training_watchdog import WatchResult
    out = tmp_path / "out"; out.mkdir()
    result = _run_child("print('HEARTBEAT EPOCH 0 START'); print('done')", out_dir=out)
    assert result.verdict == "PASS"
    assert result.error_class is None
    assert result.exit_code == 0
    assert result.killed is False
    assert result.timed_out is False
    assert result.last_heartbeat_epoch == 0
    assert (out / ".stdout.log").exists()
    assert (out / ".stderr.log").exists()


def test_subprocess_runner_exit_nonzero_returns_blocked(tmp_path: Path) -> None:
    out = tmp_path / "out"; out.mkdir()
    result = _run_child("import sys; sys.exit(7)", out_dir=out)
    assert result.verdict == "BLOCKED"
    assert result.error_class == "nonzero_exit"
    assert result.exit_code == 7
    assert result.killed is False
    assert result.timed_out is False


def test_subprocess_runner_heartbeat_stale_returns_timeout(tmp_path: Path) -> None:
    """Child emits one EPOCH START then sleeps past heartbeat_timeout → TIMEOUT."""
    from p1.training.training_watchdog import (
        RealTerminator, SubprocessRunner, WatchConfig,
    )
    out = tmp_path / "out"; out.mkdir()
    cfg = WatchConfig(process_timeout_seconds=30.0,
                      heartbeat_timeout_seconds=0.5,
                      poll_interval_seconds=0.05)
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", "-c",
             "print('HEARTBEAT EPOCH 0 START'); import time; time.sleep(5)"],
        out_dir=out, cell_label="fold0", config=cfg,
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.error_class == "heartbeat_stale"
    assert result.killed is True
    assert result.timed_out is True
    assert result.last_heartbeat_epoch == 0


def test_subprocess_runner_process_timeout_returns_timeout(tmp_path: Path) -> None:
    """Child never emits a heartbeat → process_timeout, not heartbeat_stale."""
    from p1.training.training_watchdog import (
        RealTerminator, SubprocessRunner, WatchConfig,
    )
    out = tmp_path / "out"; out.mkdir()
    cfg = WatchConfig(process_timeout_seconds=1.5,
                      heartbeat_timeout_seconds=10.0,  # never trips
                      poll_interval_seconds=0.05)
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", "-c", "import time; time.sleep(10)"],
        out_dir=out, cell_label="fold0", config=cfg,
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.error_class == "process_timeout"
    assert result.killed is True
    assert result.last_heartbeat_epoch is None  # no EPOCH was ever seen


def test_subprocess_runner_records_last_checkpoint(tmp_path: Path) -> None:
    out = tmp_path / "out"; out.mkdir()
    script = (
        "print('HEARTBEAT EPOCH 0 START')\n"
        "print('HEARTBEAT CHECKPOINT_SAVED fold_0/best_checkpoint.pth')\n"
        "print('done')\n"
    )
    result = _run_child(script, out_dir=out)
    assert result.verdict == "PASS"
    assert result.last_checkpoint == "fold_0/best_checkpoint.pth"


def test_subprocess_runner_stderr_tail_is_last_4kb(tmp_path: Path) -> None:
    """stderr_tail is the last 4 KB of .stderr.log (not the whole file)."""
    out = tmp_path / "out"; out.mkdir()
    big = "x" * 8192 + "TAIL_MARKER"
    result = _run_child(
        f"import sys; sys.stderr.write({big!r}); sys.stderr.flush()",
        out_dir=out,
    )
    assert result.verdict == "PASS"
    assert "TAIL_MARKER" in result.stderr_tail
    # Tail is capped at 4 KB.
    assert len(result.stderr_tail.encode("utf-8")) <= 4096


def test_subprocess_runner_uses_injected_terminator(tmp_path: Path) -> None:
    """If the heartbeat times out, the injected Terminator is invoked."""
    from p1.training.training_watchdog import (
        SubprocessRunner, WatchConfig,
    )
    out = tmp_path / "out"; out.mkdir()
    term = _RecordingTerminator()
    cfg = WatchConfig(process_timeout_seconds=30.0,
                      heartbeat_timeout_seconds=0.5,
                      poll_interval_seconds=0.05)
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", "-c",
             "print('HEARTBEAT EPOCH 0 START'); import time; time.sleep(5)"],
        out_dir=out, cell_label="fold0", config=cfg, terminator=term,
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert len(term.calls) == 1


def test_run_subprocess_helper_uses_defaults(tmp_path: Path) -> None:
    from p1.training.training_watchdog import run_subprocess
    out = tmp_path / "out"; out.mkdir()
    result = run_subprocess(
        [sys.executable, "-u", "-c", "print('done')"],
        out_dir=out, cell_label="fold0",
    )
    assert result.verdict == "PASS"