"""P2-02A T2 subprocess watchdog — SLOW integration tests.

Every test here spawns a real subprocess via ``sys.executable`` and
exercises the poll / heartbeat / kill / reap machinery for real. The
whole module is marked ``slow`` so the normal CI ``python`` job
(``-m "not slow"``) skips it; the dedicated ``watchdog`` CI job runs it
in full on Linux, where the POSIX process-group behaviour is real.

No mocks for Popen or file I/O. The FakeTerminator is a pass-through
ledger used only where we assert *that* a kill was requested; real-reap
and process-group gates use the RealTerminator so the OS actually does
the killing.

POSIX-only gates (process groups, SIGKILL exit codes) skip on Windows.
"""
from __future__ import annotations

import json
import os
import signal
import sys
import textwrap
import time
from pathlib import Path

import pytest

from p1.stability.schema import STAGE_NAMES
from p1.stability.watchdog import (
    FakeTerminator,
    RealTerminator,
    SubprocessRunner,
    WatchConfig,
    WatchResult,
)
from p1.stability.watchdog_cli import main as watchdog_main


pytestmark = pytest.mark.slow


_POSIX_ONLY = pytest.mark.skipif(
    sys.platform == "win32",
    reason="POSIX process-group / signal semantics (os.getpgid/killpg/SIGKILL)",
)


# ---------------------------------------------------------------------------
# Child-program helpers.
# ---------------------------------------------------------------------------


def _write_guarded_child(path: Path, body: str) -> None:
    """Write a child whose SIGTERM raises KeyboardInterrupt (so a graceful
    SIGTERM terminates it promptly). Used by the happy/partial/timeout
    fixtures that do not test SIGTERM-ignoring behaviour."""
    guard = (
        "import sys, signal\n"
        "signal.signal(signal.SIGTERM, signal.default_int_handler)\n"
    )
    path.write_text(guard + textwrap.dedent(body), encoding="utf-8")


def _write_raw_child(path: Path, body: str) -> None:
    """Write a child with no signal guard — the test controls signals."""
    path.write_text(textwrap.dedent(body), encoding="utf-8")


def _make_well_behaved_child(path: Path) -> None:
    """Prints 9 STAGE START + 9 STAGE PASS, writes A.json, exits 0."""
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
    _write_guarded_child(path, body)


def _fast_config(**overrides: float) -> WatchConfig:
    base = dict(
        process_timeout_seconds=10.0,
        heartbeat_timeout_seconds=5.0,
        poll_interval_seconds=0.05,
        terminate_grace_seconds=1.0,
        kill_grace_seconds=2.0,
    )
    base.update(overrides)
    return WatchConfig(**base)


# ---------------------------------------------------------------------------
# Happy path + logging (gates 1, 7).
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
        config=_fast_config(),
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
    """Gate 7: stdout and stderr go to independent files, and the stderr
    log + stderr_tail carry the child's actual stderr content."""
    child = tmp_path / "child.py"
    body = '''
        from p1.stability.schema import STAGE_NAMES
        from pathlib import Path
        import json, sys
        for s in STAGE_NAMES:
            print(f"STAGE {s} START", flush=True)
            print(f"STAGE {s} PASS", flush=True)
        sys.stderr.write("child-diagnostic-line ZZZ\\n")
        sys.stderr.flush()
        out = Path(sys.argv[1]) / "A.json"
        out.write_text(json.dumps({
            "protocol": {}, "cell": {"label": "A", "config": {}}, "setup": {},
            "records": [], "failed_stage": None, "all_pass": True,
        }) + "\\n", encoding="utf-8")
        '''
    _write_guarded_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    stdout_log = cell_dir / "A.stdout.log"
    stderr_log = cell_dir / "A.stderr.log"
    assert stdout_log.exists()
    assert stderr_log.exists()
    stdout_text = stdout_log.read_text(encoding="utf-8")
    assert "STAGE forward START" in stdout_text
    assert "STAGE optimizer_step PASS" in stdout_text
    # Gate 7 stderr assertion (previously missing).
    stderr_text = stderr_log.read_text(encoding="utf-8")
    assert "child-diagnostic-line ZZZ" in stderr_text
    assert "child-diagnostic-line ZZZ" in result.stderr_tail


# ---------------------------------------------------------------------------
# Kill path + reaping (gates 4, 5, 6, 8 + new reap gates).
# ---------------------------------------------------------------------------


def test_terminator_called_and_escalated_on_heartbeat_timeout(tmp_path: Path) -> None:
    """Gate 4/6: heartbeat timeout requests terminate; because the Fake
    never actually kills, the runner escalates to kill too."""
    child = tmp_path / "child.py"
    _write_guarded_child(child, 'print("STAGE forward START", flush=True)\nimport time\ntime.sleep(3)\n')
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    fake = FakeTerminator()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(
            heartbeat_timeout_seconds=0.5,
            terminate_grace_seconds=0.5,
            kill_grace_seconds=0.5,
        ),
        terminator=fake,
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.timed_out is True
    assert result.killed is True
    assert result.last_heartbeat_stage == "forward"
    assert fake.pids and len(fake.pids) == 1
    # Fake never kills the child, so the runner escalated to kill().
    assert fake.killed_pids == fake.pids


def test_runner_reaps_child_on_heartbeat_timeout(tmp_path: Path) -> None:
    """New gate: with a RealTerminator the runner returns only after the
    child is actually dead — exit_code is non-None, not a wait timeout."""
    child = tmp_path / "child.py"
    _write_guarded_child(child, 'print("STAGE forward START", flush=True)\nimport time\ntime.sleep(120)\n')
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(
            heartbeat_timeout_seconds=0.5,
            process_timeout_seconds=100.0,
        ),
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.killed is True
    assert result.timed_out is True
    assert result.exit_code is not None, "child was not reaped before run() returned"


def test_process_timeout_sets_killed_and_reaps(tmp_path: Path) -> None:
    """New gate: the process-wide timeout branch sets killed=True (not just
    timed_out) and reaps the child. Heartbeat is kept fresh so only the
    process timeout can fire."""
    child = tmp_path / "child.py"
    _write_guarded_child(child, 'print("STAGE forward START", flush=True)\nimport time\ntime.sleep(120)\n')
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(
            process_timeout_seconds=1.0,
            heartbeat_timeout_seconds=100.0,
        ),
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.timed_out is True
    assert result.killed is True
    assert result.verdict == "TIMEOUT"
    assert result.exit_code is not None


def test_subprocess_runner_records_forward_as_last_heartbeat_on_timeout(
    tmp_path: Path,
) -> None:
    """Gate 5: child prints STAGE forward START then sleeps past heartbeat."""
    child = tmp_path / "child.py"
    _write_guarded_child(child, 'print("STAGE forward START", flush=True)\nimport time\ntime.sleep(120)\n')
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(heartbeat_timeout_seconds=0.5),
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.last_heartbeat_stage == "forward"


def test_subprocess_runner_preserves_partial_json_after_kill(tmp_path: Path) -> None:
    """Gate 8: child writes a JSON, then sleeps; the watchdog kills on
    heartbeat timeout and never overwrites the report."""
    child = tmp_path / "child.py"
    body = '''
        from pathlib import Path
        import json, sys, time
        out = Path(sys.argv[1]) / "A.json"
        out.write_text(json.dumps({
            "protocol": {}, "cell": {"label": "A", "config": {}}, "setup": {},
            "records": [], "failed_stage": None, "all_pass": True,
        }) + "\\n", encoding="utf-8")
        print("STAGE forward START", flush=True)
        time.sleep(120)
        '''
    _write_guarded_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    expected_json = (
        json.dumps({
            "protocol": {}, "cell": {"label": "A", "config": {}}, "setup": {},
            "records": [], "failed_stage": None, "all_pass": True,
        })
        + "\n"
    )
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(heartbeat_timeout_seconds=0.5),
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.verdict == "TIMEOUT"
    assert result.killed is True
    assert (cell_dir / "A.json").read_text(encoding="utf-8") == expected_json


# ---------------------------------------------------------------------------
# Error-path classification (gates 2, 3).
# ---------------------------------------------------------------------------


def test_subprocess_runner_classifies_stderr_only_failure_as_other_error(
    tmp_path: Path,
) -> None:
    """Gate 2: child writes a CUDA error to stderr and exits 1 with no JSON.

    Per spec section 5 the JSON's exception_message is the source of
    truth for decide(); a stderr-only failure with no JSON is
    OTHER_ERROR by design. This pins that path."""
    child = tmp_path / "child.py"
    body = '''
        print("STAGE forward START", flush=True)
        import sys
        sys.stderr.write("RuntimeError: cudnn status not initialized\\n")
        sys.exit(1)
        '''
    _write_guarded_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    assert result.verdict == "OTHER_ERROR"
    assert result.timed_out is False
    assert result.last_heartbeat_stage == "forward"
    assert "cudnn" in result.stderr_tail


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
            "protocol": {}, "cell": {"label": "A", "config": {}}, "setup": {},
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
    _write_guarded_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(),
        terminator=FakeTerminator(),
    )
    result = runner.run()
    assert result.partial_json is True
    assert result.verdict == "DATA_ERROR"
    assert result.failed_stage == "dataloader_create"


# ---------------------------------------------------------------------------
# watchdog_cli serial matrix (gates 9, 10).
# ---------------------------------------------------------------------------


def _write_two_cell_harness(path: Path, second_cell_sleep: float) -> None:
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
                "protocol": {{}}, "cell": {{"label": cell, "config": {{}}}},
                "setup": {{}}, "records": [], "failed_stage": None, "all_pass": True,
            }}) + "\\n", encoding="utf-8")
            for _ in range(10):
                print("STAGE forward PASS", flush=True)
                time.sleep(0.1)
        '''
    _write_guarded_child(path, body)


def test_watchdog_cli_serial_matrix_with_one_timeout(tmp_path: Path) -> None:
    """Gate 9: cell A passes, cell B times out; watchdog exits 1."""
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
        "--heartbeat-timeout", "2.0",
        "--process-timeout", "30.0",
        "--terminate-grace", "1.0",
        "--kill-grace", "2.0",
    ])
    assert rc == 1
    summary_path = cell_dir / "_watchdog_summary.json"
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["A"]["verdict"] == "PASS"
    assert summary["B"]["verdict"] == "TIMEOUT"


def test_watchdog_cli_serial_matrix_runs_not_parallel(tmp_path: Path) -> None:
    """Gate 10: 2 cells x ~1s each, serial. Total >= 1.5s proves serial."""
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
    assert elapsed >= 1.5, f"elapsed {elapsed:.2f}s suggests parallel execution"


# ---------------------------------------------------------------------------
# POSIX process-group isolation gates (the root-cause regression suite).
# These are the gates that prove killpg targets only the child's tree and
# never the watchdog's own process group (pytest / the CI shell).
# ---------------------------------------------------------------------------


@_POSIX_ONLY
def test_posix_child_starts_in_its_own_process_group(tmp_path: Path) -> None:
    """The child must be its own group leader (pgid == pid). Without
    start_new_session the child would inherit pytest's group and killpg
    would reach pytest."""
    child = tmp_path / "child.py"
    body = '''
        import os, sys
        from pathlib import Path
        out = Path(sys.argv[1])
        (out / "pgid.txt").write_text(f"{os.getpid()} {os.getpgid(0)}\\n", encoding="utf-8")
        '''
    _write_raw_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(),
        terminator=FakeTerminator(),
    )
    runner.run()
    pid_str, pgid_str = (cell_dir / "pgid.txt").read_text().split()
    assert pid_str == pgid_str, "child is not its own process-group leader"
    assert int(pgid_str) != os.getpgid(0), "child shares pytest's process group"


@_POSIX_ONLY
def test_posix_group_kill_hits_whole_tree_but_not_pytest(tmp_path: Path) -> None:
    """RealTerminator kills the child *and* its grandchild (same new
    group) while pytest — in a different group — survives to run the
    assertions."""
    child = tmp_path / "child.py"
    body = '''
        import os, sys, time, subprocess
        from pathlib import Path
        out = Path(sys.argv[1])
        gc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        (out / "ids.txt").write_text(
            f"{os.getpid()} {os.getpgid(0)} {gc.pid}\\n", encoding="utf-8")
        print("STAGE forward START", flush=True)
        time.sleep(120)
        '''
    _write_raw_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(
            heartbeat_timeout_seconds=0.5,
            terminate_grace_seconds=1.0,
            kill_grace_seconds=2.0,
        ),
        terminator=RealTerminator(),
    )
    result = runner.run()
    pid, pgid, gc_pid = (int(x) for x in (cell_dir / "ids.txt").read_text().split())
    # pytest survived (we are executing) and the child had its own group.
    assert pgid == pid
    assert pgid != os.getpgid(0)
    assert result.exit_code is not None
    # The grandchild (same group) was also killed.
    deadline = time.monotonic() + 5.0
    grandchild_alive = True
    while time.monotonic() < deadline:
        try:
            os.kill(gc_pid, 0)
            time.sleep(0.1)
        except ProcessLookupError:
            grandchild_alive = False
            break
    assert grandchild_alive is False, "grandchild survived the process-group kill"


@_POSIX_ONLY
def test_posix_sigterm_ignoring_child_is_force_killed(tmp_path: Path) -> None:
    """A child that ignores SIGTERM must be escalated to SIGKILL; its
    exit code is -SIGKILL, proving the forced kill happened."""
    child = tmp_path / "child.py"
    body = '''
        import os, sys, signal, time
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        from pathlib import Path
        (Path(sys.argv[1]) / "started.txt").write_text("1", encoding="utf-8")
        print("STAGE forward START", flush=True)
        time.sleep(120)
        '''
    _write_raw_child(child, body)
    cell_dir = tmp_path / "out"
    cell_dir.mkdir()
    runner = SubprocessRunner(
        cmd=[sys.executable, "-u", str(child), str(cell_dir)],
        out_dir=cell_dir,
        cell_label="A",
        config=_fast_config(
            heartbeat_timeout_seconds=0.5,
            terminate_grace_seconds=1.0,
            kill_grace_seconds=3.0,
        ),
        terminator=RealTerminator(),
    )
    result = runner.run()
    assert result.killed is True
    assert result.exit_code is not None
    assert result.exit_code == -signal.SIGKILL
