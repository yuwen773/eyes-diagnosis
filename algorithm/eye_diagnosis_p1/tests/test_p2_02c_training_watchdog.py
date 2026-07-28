"""Tests for algorithm/p1/training/training_watchdog.py (data classes only).

Subprocess-runner tests live in this file (Task 2 extends the same module).
This file covers: heartbeat parser, WatchConfig defaults, Terminator
protocol, RealTerminator, WatchResult.
"""
from __future__ import annotations

from pathlib import Path

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


def test_real_terminator_terminate_does_not_raise_on_unknown_pid() -> None:
    # RealTerminator must swallow ProcessLookupError / non-zero taskkill
    # exits; the runner relies on terminate() being total.
    from p1.training.training_watchdog import RealTerminator
    RealTerminator().terminate(2**30)  # likely-not-a-pid