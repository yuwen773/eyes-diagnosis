"""P2-02A T2 subprocess watchdog — FAST unit tests.

This module contains ONLY pure-function / configuration / no-long-subprocess
tests. It carries no ``slow`` marker, so it runs in the normal CI ``python``
job (which invokes ``pytest ... -m "not slow"``). Every real sleep /
process-tree test lives in ``test_p2_02a_watchdog_integration.py``.

The only ``Popen`` call here is the OSError path (a missing executable),
which fails immediately and never leaves a lingering process.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from p1.stability.schema import CellVerdict
from p1.stability.watchdog import (
    FakeTerminator,
    HeartbeatEvent,
    SubprocessRunner,
    WatchConfig,
    _classify,
    _popen_isolation_kwargs,
    parse_heartbeat_line,
)


# ---------------------------------------------------------------------------
# parse_heartbeat_line (pure)
# ---------------------------------------------------------------------------


def test_parse_heartbeat_line_returns_none_for_non_heartbeat() -> None:
    assert parse_heartbeat_line("hello world") is None
    assert parse_heartbeat_line("") is None
    assert parse_heartbeat_line("STAGE forward") is None
    assert parse_heartbeat_line("STAGE forward STARTED") is None


def test_parse_heartbeat_line_returns_event_for_start_and_pass() -> None:
    assert parse_heartbeat_line("STAGE forward START") == HeartbeatEvent(
        stage="forward", kind="START"
    )
    assert parse_heartbeat_line("STAGE optimizer_step PASS") == HeartbeatEvent(
        stage="optimizer_step", kind="PASS"
    )


def test_parse_heartbeat_line_raises_for_unknown_stage() -> None:
    import pytest

    with pytest.raises(ValueError, match="unknown stage"):
        parse_heartbeat_line("STAGE does_not_exist START")


# ---------------------------------------------------------------------------
# WatchConfig + FakeTerminator
# ---------------------------------------------------------------------------


def test_watchconfig_defaults_match_design() -> None:
    c = WatchConfig()
    assert c.process_timeout_seconds == 300.0
    assert c.heartbeat_timeout_seconds == 90.0
    assert c.poll_interval_seconds == 0.1
    # New grace budgets for the two-phase reap (SIGTERM -> grace -> SIGKILL).
    assert c.terminate_grace_seconds == 10.0
    assert c.kill_grace_seconds == 5.0


def test_fake_terminator_records_terminate_and_kill_pids() -> None:
    ft = FakeTerminator()
    ft.terminate(1234)
    ft.kill(1234)
    ft.terminate(5678)
    # ``pids`` preserves the historical "graceful terminate" ledger; ``kill``
    # gets its own ledger so tests can assert the escalation happened.
    assert ft.pids == [1234, 5678]
    assert ft.killed_pids == [1234]


# ---------------------------------------------------------------------------
# _popen_isolation_kwargs — the process-group isolation contract.
# ---------------------------------------------------------------------------


def test_popen_isolation_kwargs_for_current_platform() -> None:
    kw = _popen_isolation_kwargs()
    if sys.platform == "win32":
        assert kw == {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    else:
        # start_new_session=True makes the child a session/group leader so
        # os.getpgid(child.pid) == child.pid and killpg cannot reach pytest.
        assert kw == {"start_new_session": True}


# ---------------------------------------------------------------------------
# SubprocessRunner OSError path (Popen fails immediately; no long process).
# ---------------------------------------------------------------------------


def test_run_returns_other_error_when_executable_missing(tmp_path: Path) -> None:
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=["this-executable-does-not-exist-xyzzy"],
        out_dir=cell_dir,
        cell_label="A",
        config=WatchConfig(),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    assert result.verdict == "OTHER_ERROR"
    assert result.exit_code is None
    assert result.killed is False
    assert result.timed_out is False


# ---------------------------------------------------------------------------
# _classify (pure verdict logic — temp JSON files, no subprocess).
# ---------------------------------------------------------------------------


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_classify_oom_from_json(tmp_path: Path) -> None:
    jp = tmp_path / "A.json"
    _write_json(
        jp,
        {
            "records": [
                {
                    "stage": "forward",
                    "status": "failed",
                    "exception_message": "torch.cuda.OutOfMemoryError: CUDA out of memory.",
                }
            ],
            "failed_stage": "forward",
            "all_pass": False,
        },
    )
    verdict, failed_stage, partial = _classify(
        exit_code=1,
        json_path=jp,
        last_heartbeat_stage="forward",
        timed_out=False,
        stderr_tail="",
    )
    assert verdict == CellVerdict.OOM.value
    assert failed_stage == "forward"
    assert partial is True


def test_classify_timeout_beats_pass_json(tmp_path: Path) -> None:
    """A timed-out run is TIMEOUT even if a stale all_pass JSON is on disk."""
    jp = tmp_path / "A.json"
    _write_json(jp, {"records": [], "failed_stage": None, "all_pass": True})
    verdict, _failed_stage, _partial = _classify(
        exit_code=0,
        json_path=jp,
        last_heartbeat_stage="optimizer_step",
        timed_out=True,
        stderr_tail="",
    )
    assert verdict == CellVerdict.TIMEOUT.value


def test_classify_verdict_is_always_a_valid_enum_member(tmp_path: Path) -> None:
    valid = {v.value for v in CellVerdict}
    # No JSON on disk -> OTHER_ERROR, still a valid enum member.
    verdict, _fs, partial = _classify(
        exit_code=1,
        json_path=tmp_path / "missing.json",
        last_heartbeat_stage=None,
        timed_out=False,
        stderr_tail="boom",
    )
    assert verdict in valid
    assert partial is False


# ---------------------------------------------------------------------------
# watchdog_cli command construction (pure argparse -> cmd list).
# ---------------------------------------------------------------------------


def test_invoke_probe_cmd_with_child(tmp_path: Path) -> None:
    from p1.stability.watchdog_cli import _build_argparser, _invoke_probe

    args = _build_argparser().parse_args(
        [
            "--protocol", "p",
            "--manifest", "m",
            "--split-assignment", "s",
            "--fold-assignment", "f",
            "--image-root", "i",
            "--out-dir", str(tmp_path),
            "--child", "child.py",
        ]
    )
    cell_dir = tmp_path / "A"
    cmd = _invoke_probe("A", cell_dir, args)
    assert cmd == [sys.executable, "-u", "child.py", str(cell_dir), "A"]


def test_invoke_probe_cmd_without_child(tmp_path: Path) -> None:
    from p1.stability.watchdog_cli import _build_argparser, _invoke_probe

    args = _build_argparser().parse_args(
        [
            "--protocol", "p",
            "--manifest", "m",
            "--split-assignment", "s",
            "--fold-assignment", "f",
            "--image-root", "i",
            "--out-dir", str(tmp_path),
        ]
    )
    cell_dir = tmp_path / "A"
    cmd = _invoke_probe("A", cell_dir, args)
    assert cmd[:4] == [sys.executable, "-u", "-m", "p1.stability.cli"]
    assert "--cell" in cmd
    assert cmd[cmd.index("--cell") + 1] == "A"
    assert cmd[cmd.index("--out-dir") + 1] == str(cell_dir)
