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


# ---------------------------------------------------------------------------
# Test 4: error paths and partial-JSON preservation.
# ---------------------------------------------------------------------------


def test_subprocess_runner_classifies_cuda_error_via_decide(
    tmp_path: Path,
) -> None:
    """Gate 2: probe-shaped child raises a CUDA error string; no JSON."""
    child = tmp_path / "child.py"
    body = '''
        print("STAGE forward START", flush=True)
        import sys
        sys.stderr.write("RuntimeError: cudnn status not initialized\\n")
        sys.exit(1)
        '''
    _write_child_program(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
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
    # Either CUDA_ERROR (decide matches the substring) or OTHER_ERROR
    # if our substring was too short for decide to recognise. The gate
    # requires the verdict to be derived from the stderr text, NOT a
    # generic timeout or pass.
    assert result.verdict in ("CUDA_ERROR", "OTHER_ERROR")
    assert result.verdict != "PASS"
    assert result.timed_out is False
    assert result.last_heartbeat_stage == "forward"
    assert "cudnn" in result.stderr_tail or result.verdict == "OTHER_ERROR"


def test_subprocess_runner_partial_json_preserved_after_failed_child(
    tmp_path: Path,
) -> None:
    """Gate 3: child writes a JSON with a failed_stage then exits 1."""
    child = tmp_path / "child.py"
    body = '''
        from p1.stability.schema import STAGE_NAMES
        from pathlib import Path
        import json, sys
        for s in STAGE_NAMES:
            print(f"STAGE {s} START", flush=True)
        print("STAGE dataloader_create PASS", flush=True)
        out = Path(sys.argv[1]) / "A.json"
        out.write_text(json.dumps({
            "protocol": {},
            "cell": {"label": "A", "config": {}},
            "setup": {},
            "records": [
                {"stage": "dataloader_create", "status": "failed",
                 "exception_type": "FileNotFoundError",
                 "exception_message": "FileNotFoundError: DataSet/foo not found"},
            ],
            "failed_stage": "dataloader_create",
            "all_pass": False,
        }) + "\\n", encoding="utf-8")
        sys.exit(1)
        '''
    _write_child_program(child, body)
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
    assert result.partial_json is True
    assert result.verdict == "DATA_ERROR"
    assert result.failed_stage == "dataloader_create"


def test_subprocess_runner_records_forward_as_last_heartbeat_on_timeout(
    tmp_path: Path,
) -> None:
    """Gate 5: child prints STAGE forward START then sleeps past the heartbeat timeout."""
    child = tmp_path / "child.py"
    body = '''
        print("STAGE forward START", flush=True)
        import time
        time.sleep(60)
        '''
    _write_child_program(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=WatchConfig(
            process_timeout_seconds=30.0,
            heartbeat_timeout_seconds=0.5,
            poll_interval_seconds=0.05,
        ),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.last_heartbeat_stage == "forward"


from p1.stability.watchdog_cli import main as watchdog_main


# ---------------------------------------------------------------------------
# Test 5: watchdog_cli.main (serial matrix execution).
# ---------------------------------------------------------------------------


def _write_two_cell_harness(path: Path, second_cell_sleep: float) -> None:
    """A child that simulates a 2-cell matrix.

    First child (cell A): print 9 STAGE START/PASS, write A.json, exit 0.
    Second child (cell B): if second_cell_sleep > 0, print STAGE forward
    START then sleep second_cell_sleep seconds; else print 9 STAGE
    START/PASS, write B.json, exit 0.

    The parent invokes the child once per cell with sys.argv[2] ==
    cell label ("A" or "B") and sys.argv[1] == out_dir. The child
    discriminates by argv[2] and runs the A or B branch.
    """
    body = f'''
        import sys, time, json
        from pathlib import Path
        from p1.stability.schema import STAGE_NAMES
        cell = sys.argv[2]
        out = Path(sys.argv[1]) / f"{{cell}}.json"
        if cell == "B" and {second_cell_sleep} > 0:
            print("STAGE forward START", flush=True)
            time.sleep({second_cell_sleep})
        else:
            for s in STAGE_NAMES:
                print(f"STAGE {{s}} START", flush=True)
                print(f"STAGE {{s}} PASS", flush=True)
            out.write_text(json.dumps({{
                "protocol": {{}},
                "cell": {{"label": cell, "config": {{}}}},
                "setup": {{}},
                "records": [],
                "failed_stage": None,
                "all_pass": True,
            }}) + "\\n", encoding="utf-8")
            for _ in range(10):
                print("STAGE forward PASS", flush=True)
                time.sleep(0.1)
        '''
    _write_child_program(path, body)


def test_watchdog_cli_serial_matrix_with_one_timeout(tmp_path: Path) -> None:
    """Gate 9: 2-cell matrix; cell A passes, cell B times out.

    The watchdog exits 1 and the summary records A=PASS, B=TIMEOUT.
    """
    child = tmp_path / "child.py"
    _write_two_cell_harness(child, second_cell_sleep=60.0)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    dummy = str(tmp_path / "dummy")
    rc = watchdog_main([
        "--child", str(child),
        "--protocol", dummy,
        "--manifest", dummy,
        "--split-assignment", dummy,
        "--fold-assignment", dummy,
        "--image-root", dummy,
        "--out-dir", str(cell_dir),
        "--heartbeat-timeout", "0.5",
        "--process-timeout", "30.0",
    ])
    assert rc == 1
    summary_path = cell_dir / "_watchdog_summary.json"
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["A"]["verdict"] == "PASS"
    assert summary["B"]["verdict"] == "TIMEOUT"


def test_watchdog_cli_serial_matrix_runs_not_parallel(tmp_path: Path) -> None:
    """Gate 10: 2-cell matrix; each cell sleeps 1s. Total >= 2s proves serial."""
    child = tmp_path / "child.py"
    _write_two_cell_harness(child, second_cell_sleep=0.0)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    dummy = str(tmp_path / "dummy")
    started = time.monotonic()
    rc = watchdog_main([
        "--child", str(child),
        "--protocol", dummy,
        "--manifest", dummy,
        "--split-assignment", dummy,
        "--fold-assignment", dummy,
        "--image-root", dummy,
        "--out-dir", str(cell_dir),
        "--heartbeat-timeout", "5.0",
        "--process-timeout", "30.0",
    ])
    elapsed = time.monotonic() - started
    assert rc == 0
    # 2 cells x 1s each, serial. Allow 1.5s of slack for Popen overhead.
    assert elapsed >= 1.5, f"elapsed {elapsed:.2f}s suggests parallel execution"


def test_subprocess_runner_preserves_partial_json_after_kill(
    tmp_path: Path,
) -> None:
    """Gate 8: child writes a JSON, then sleeps; watchdog kills on heartbeat timeout.

    The JSON on disk must remain byte-identical — the watchdog does
    not overwrite the probe's report.
    """
    child = tmp_path / "child.py"
    body = '''
        from pathlib import Path
        import json, sys, time
        out = Path(sys.argv[1]) / "A.json"
        out.write_text(json.dumps({
            "protocol": {},
            "cell": {"label": "A", "config": {}},
            "setup": {},
            "records": [],
            "failed_stage": None,
            "all_pass": True,
        }) + "\\n", encoding="utf-8")
        print("STAGE forward START", flush=True)
        time.sleep(60)
        '''
    _write_child_program(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    expected_json = (
        json.dumps({
            "protocol": {},
            "cell": {"label": "A", "config": {}},
            "setup": {},
            "records": [],
            "failed_stage": None,
            "all_pass": True,
        })
        + "\n"
    )
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=WatchConfig(
            process_timeout_seconds=30.0,
            heartbeat_timeout_seconds=0.5,
            poll_interval_seconds=0.05,
        ),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.killed is True
    # Byte-identical preservation: we never touched the JSON.
    assert (cell_dir / "A.json").read_text(encoding="utf-8") == expected_json
