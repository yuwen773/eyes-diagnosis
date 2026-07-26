"""P2-02A T2 subprocess watchdog tests.

Tests run real subprocesses via `sys.executable -u -c "..."` and an
injectable FakeTerminator. No mocks for Popen or file I/O. CPU-only.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from p1.stability.schema import STAGE_NAMES
from p1.stability.watchdog import (
    HeartbeatEvent,
    parse_heartbeat_line,
)


# ---------------------------------------------------------------------------
# Test 1: parse_heartbeat_line (pure function, no I/O)
# ---------------------------------------------------------------------------


def test_parse_heartbeat_line_returns_none_for_non_heartbeat() -> None:
    assert parse_heartbeat_line("hello world") is None
    assert parse_heartbeat_line("") is None
    assert parse_heartbeat_line("STAGE forward") is None
    assert parse_heartbeat_line("STAGE forward STARTED") is None


def test_parse_heartbeat_line_returns_event_for_start_and_pass() -> None:
    e1 = parse_heartbeat_line("STAGE forward START")
    assert e1 == HeartbeatEvent(stage="forward", kind="START")
    e2 = parse_heartbeat_line("STAGE optimizer_step PASS")
    assert e2 == HeartbeatEvent(stage="optimizer_step", kind="PASS")
def test_parse_heartbeat_line_raises_for_unknown_stage() -> None:
    with pytest.raises(ValueError, match="unknown stage"):
        parse_heartbeat_line("STAGE does_not_exist START")


from p1.stability.watchdog import (
    FakeTerminator,
    RealTerminator,
    Terminator,
    WatchConfig,
)


# ---------------------------------------------------------------------------
# Test 2: WatchConfig + Terminator
# ---------------------------------------------------------------------------


def test_watchconfig_defaults_match_design() -> None:
    """Verify WatchConfig uses the design timeout defaults."""
    c = WatchConfig()
    assert c.process_timeout_seconds == 300.0
    assert c.heartbeat_timeout_seconds == 90.0
    assert c.poll_interval_seconds == 0.1


def test_fake_terminator_records_pids() -> None:
    """Verify FakeTerminator records every terminated process ID."""
    ft = FakeTerminator()
    ft.terminate(1234)
    ft.terminate(5678)
    assert ft.pids == [1234, 5678]


from p1.stability.watchdog import (
    SubprocessRunner,
    WatchResult,
)


# ---------------------------------------------------------------------------
# Helpers for the subprocess tests (used by Tasks 3-5).
# ---------------------------------------------------------------------------


def _child_program(script: str) -> str:
    """Wrap a Python snippet in -c with a hard timeout guard.

    The probe never appears here; these helpers exist to simulate the
    probe's stdout/stderr/exit-code behaviour deterministically.
    """
    guard = "import sys, signal\n"
    guard += "signal.signal(signal.SIGTERM, signal.default_int_handler)\n"
    return guard + textwrap.dedent(script)


def _write_child_program(path: Path, body: str) -> None:
    """Write the child program to a temp .py file (Popen-friendly)."""
    path.write_text(_child_program(body), encoding="utf-8")


def _make_well_behaved_child(path: Path) -> None:
    """A child that prints 9 STAGE START + 9 STAGE PASS, writes a JSON,
    and exits 0. Used by gate 1 (happy path)."""
    body = '''
        from p1.stability.schema import STAGE_NAMES
        from pathlib import Path
        import json, sys
        for s in STAGE_NAMES:
            print(f"STAGE {s} START", flush=True)
            print(f"STAGE {s} PASS", flush=True)
        out = Path(sys.argv[1]) / "A.json"
        out.write_text(json.dumps({
            "protocol": {},
            "cell": {"label": "A", "config": {}},
            "setup": {},
            "records": [],
            "failed_stage": None,
            "all_pass": True,
        }) + "\\n", encoding="utf-8")
        '''
    _write_child_program(path, body)


# ---------------------------------------------------------------------------
# Test 3: WatchResult + SubprocessRunner (happy path + kill path).
# ---------------------------------------------------------------------------


def test_subprocess_runner_happy_path_passes(tmp_path: Path) -> None:
    child = tmp_path / "child.py"
    _make_well_behaved_child(child)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=WatchConfig(
            process_timeout_seconds=10.0,
            heartbeat_timeout_seconds=5.0,
            poll_interval_seconds=0.05,
        ),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    assert isinstance(result, WatchResult)
    assert result.cell_label == "A"
    assert result.verdict == "PASS"
    assert result.killed is False
    assert result.timed_out is False
    assert result.last_heartbeat_stage == "optimizer_step"
    assert result.exit_code == 0
    assert result.partial_json is True
    assert (cell_dir / "A.json").exists()


def test_subprocess_runner_writes_stdout_and_stderr_logs(tmp_path: Path) -> None:
    """Gate 7: stdout and stderr go to independent files under out_dir."""
    child = tmp_path / "child.py"
    _make_well_behaved_child(child)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=WatchConfig(
            process_timeout_seconds=10.0,
            heartbeat_timeout_seconds=5.0,
            poll_interval_seconds=0.05,
        ),
        terminator=FakeTerminator(),
    )
    runner.run()
    stdout_log = cell_dir / "A.stdout.log"
    stderr_log = cell_dir / "A.stderr.log"
    assert stdout_log.exists()
    assert stderr_log.exists()
    stdout_text = stdout_log.read_text(encoding="utf-8")
    assert "STAGE forward START" in stdout_text
    assert "STAGE optimizer_step PASS" in stdout_text


def test_subprocess_runner_terminator_called_with_pid_on_timeout(
    tmp_path: Path,
) -> None:
    """Gate 4 + 6: child infinite-sleeps; FakeTerminator records the pid."""
    child = tmp_path / "child.py"
    body = '''
        print("STAGE forward START", flush=True)
        import time
        time.sleep(60)
        '''
    _write_child_program(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    fake = FakeTerminator()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=WatchConfig(
            process_timeout_seconds=30.0,
            heartbeat_timeout_seconds=0.5,
            poll_interval_seconds=0.05,
        ),
        terminator=fake,
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.timed_out is True
    assert result.killed is True
    assert result.last_heartbeat_stage == "forward"
    assert fake.pids, "FakeTerminator was never called"
    assert len(fake.pids) == 1
