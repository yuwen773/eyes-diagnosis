"""P2-02A T2 subprocess watchdog.

Parent-process orchestrator for the 9-stage CUDA stability probe. See
``docs/superpowers/specs/2026-07-25-p2-02a-t2-watchdog-design.md`` for
the design and ``docs/superpowers/plans/2026-07-25-p2-02a-t2-watchdog.md``
for the implementation plan.

This module is the only one that owns the subprocess plumbing. The
probe itself (``p1.stability.cli``) is unchanged: it prints
``STAGE <name> START/PASS`` on stdout and writes a JSON report under
``--out-dir/<cell>.json``. The watchdog parses that heartbeat, enforces
two timeouts (process-wide and per-stage), kills the subprocess tree on
timeout, and classifies the result onto the existing ``CellVerdict``
enum via ``p1.stability.schema.decide``.
"""
from __future__ import annotations

import enum
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NamedTuple, Optional, Protocol

from p1.stability.schema import CellVerdict, STAGE_NAMES, decide


# ---------------------------------------------------------------------------
# Pure parser (no I/O).
# ---------------------------------------------------------------------------


class HeartbeatEvent(NamedTuple):
    """One parsed line from the probe's STAGE heartbeat.

    ``stage`` is always one of ``STAGE_NAMES``. ``kind`` is exactly
    "START" or "PASS" — the probe never prints any other value.
    """

    stage: str
    kind: str


_HEARTBEAT_RE = re.compile(r"^STAGE\s+(\S+)\s+(START|PASS)\s*$")


def parse_heartbeat_line(line: str) -> Optional[HeartbeatEvent]:
    """Parse one stdout line from the probe subprocess.

    Returns ``None`` for lines that are not heartbeats. Raises
    ``ValueError`` if the line is a heartbeat but the stage name is not
    in ``STAGE_NAMES`` — the probe contract is closed, so a typo
    indicates a probe bug, not user data.
    """
    line = line.rstrip("\r\n")
    m = _HEARTBEAT_RE.match(line)
    if m is None:
        return None
    stage, kind = m.group(1), m.group(2)
    if stage not in STAGE_NAMES:
        raise ValueError(
            f"heartbeat references unknown stage {stage!r}; expected one of {STAGE_NAMES}"
        )
    return HeartbeatEvent(stage=stage, kind=kind)


__all__ = [
    "FakeTerminator",
    "HeartbeatEvent",
    "RealTerminator",
    "SubprocessRunner",
    "Terminator",
    "WatchConfig",
    "WatchResult",
    "parse_heartbeat_line",
]


# ---------------------------------------------------------------------------
# Watch configuration (frozen dataclass; tests override the timeouts).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WatchConfig:
    """Time-budget knobs for a single SubprocessRunner.

    Defaults are the design values: 5 minutes for the whole cell, 90
    seconds since the last heartbeat line, 100 ms poll granularity.
    Tests use much smaller values so the suite finishes in <30 s.
    """

    process_timeout_seconds: float = 300.0
    heartbeat_timeout_seconds: float = 90.0
    poll_interval_seconds: float = 0.1
    # Two-phase reap budgets: after a timeout we send a graceful signal
    # and wait ``terminate_grace_seconds`` for the tree to exit, then
    # escalate to a forced kill and wait ``kill_grace_seconds``. Tests
    # override both with sub-second values.
    terminate_grace_seconds: float = 10.0
    kill_grace_seconds: float = 5.0


# ---------------------------------------------------------------------------
# Terminator Protocol + the real Windows/POSIX implementations + a fake
# for unit tests. The runner holds a Terminator (not a RealTerminator)
# so the kill path is unit-testable without spawning a child.
# ---------------------------------------------------------------------------


class Terminator(Protocol):
    """Platform-aware process-tree killer.

    ``terminate`` requests a graceful stop (POSIX ``SIGTERM`` to the
    child's process group; Windows ``taskkill /T`` without ``/F``).
    ``kill`` forces it (POSIX ``SIGKILL``; Windows ``taskkill /F /T``).
    The runner escalates from the first to the second.
    """

    def terminate(self, pid: int) -> None: ...

    def kill(self, pid: int) -> None: ...


class RealTerminator:
    """Windows: ``taskkill /PID <pid> /T`` (add ``/F`` to force).

    POSIX: ``os.killpg(os.getpgid(pid), SIGTERM|SIGKILL)``.

    The array form of ``subprocess.run`` is used (not the shell) so MSYS
    path translation cannot mangle the arguments. ``check=False``
    swallows the 128 exit code that ``taskkill`` returns when the PID
    is already gone.

    POSIX correctness depends on the child being spawned with
    ``start_new_session=True`` (see ``_popen_isolation_kwargs``): that
    makes the child its own session/group leader, so
    ``os.getpgid(child.pid) == child.pid`` and ``killpg`` reaches only
    the child's tree — never the watchdog's own process group (pytest /
    the CI shell).
    """

    def terminate(self, pid: int) -> None:
        if sys.platform == "win32":
            # Console children do not reliably honour a graceful WM_CLOSE
            # (taskkill without /F), so there is no meaningful soft phase
            # on Windows — force immediately. The SIGTERM->SIGKILL
            # escalation only matters on POSIX.
            self._taskkill(pid, force=True)
            return
        self._signal_group(pid, signal.SIGTERM)

    def kill(self, pid: int) -> None:
        if sys.platform == "win32":
            self._taskkill(pid, force=True)
            return
        self._signal_group(pid, signal.SIGKILL)

    @staticmethod
    def _taskkill(pid: int, *, force: bool) -> None:
        cmd = ["cmd", "/c", "taskkill"]
        if force:
            cmd.append("/F")
        cmd += ["/PID", str(pid), "/T"]
        subprocess.run(cmd, check=False, capture_output=True)

    @staticmethod
    def _signal_group(pid: int, sig: int) -> None:
        try:
            pgid = os.getpgid(pid)
        except ProcessLookupError:
            return
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            return


@dataclass
class FakeTerminator:
    """Test double: records every pid passed to ``terminate``/``kill``.

    ``pids`` is the graceful-terminate ledger; ``killed_pids`` is the
    forced-kill ledger. A FakeTerminator never actually signals a
    process, so a runner using it cannot reap a still-running child —
    real-reap assertions must use ``RealTerminator``.
    """

    pids: list[int] = field(default_factory=list)
    killed_pids: list[int] = field(default_factory=list)

    def terminate(self, pid: int) -> None:
        self.pids.append(int(pid))

    def kill(self, pid: int) -> None:
        self.killed_pids.append(int(pid))


# ---------------------------------------------------------------------------
# WatchResult — the structured outcome of one cell.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WatchResult:
    """Structured outcome of a single subprocess run.

    ``verdict`` is always one of the ``CellVerdict`` string values
    (``PASS``, ``OOM``, ``TIMEOUT``, ``CUDA_ERROR``, ``DATA_ERROR``,
    ``OTHER_ERROR``). ``failed_stage`` is one of ``STAGE_NAMES`` or
    ``None``. ``last_heartbeat_stage`` is the last stage whose START or
    PASS line the runner saw, used for debugging. ``stderr_tail`` is
    the last 4096 characters of stderr, useful when classification fell back to
    ``OTHER_ERROR`` and the JSON is absent.
    """

    cell_label: str
    verdict: str
    failed_stage: Optional[str]
    last_heartbeat_stage: Optional[str]
    exit_code: Optional[int]
    killed: bool
    timed_out: bool
    partial_json: bool
    stderr_tail: str
    elapsed_seconds: float


# ---------------------------------------------------------------------------
# SubprocessRunner — spawn, capture, parse, poll, kill, classify.
# ---------------------------------------------------------------------------


_STDERR_TAIL_CHARS = 4096


def _popen_isolation_kwargs() -> dict[str, Any]:
    """Popen kwargs that put the child in its own process group.

    POSIX: ``start_new_session=True`` runs ``setsid()`` in the child, so
    it becomes a session + process-group leader (``pgid == pid``). This
    is what makes ``RealTerminator``'s ``killpg`` safe — it kills only
    the child's tree, never the watchdog's own group (pytest / CI shell).

    Windows: ``CREATE_NEW_PROCESS_GROUP`` gives the child a fresh group
    id so ``taskkill /T`` targets only its tree.
    """
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _classify(
    *,
    exit_code: Optional[int],
    json_path: Path,
    last_heartbeat_stage: Optional[str],
    timed_out: bool,
    stderr_tail: str,
) -> tuple[str, Optional[str], bool]:
    """Return ``(verdict, failed_stage, partial_json)``.

    Implements the verdict table in spec section 5. ``decide()`` may
    raise ``ValueError`` for unparseable exception text; we catch it
    and substitute ``OTHER_ERROR`` at this boundary.
    """
    partial_json = json_path.exists()
    if timed_out:
        return CellVerdict.TIMEOUT.value, last_heartbeat_stage, partial_json

    if partial_json:
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = None
    else:
        payload = None

    if payload is not None:
        failed_stage = payload.get("failed_stage")
        all_pass = bool(payload.get("all_pass"))
        if all_pass and exit_code in (None, 0):
            return CellVerdict.PASS.value, None, True
        if failed_stage:
            records = payload.get("records") or []
            msg = ""
            for rec in records:
                if isinstance(rec, dict) and rec.get("stage") == failed_stage:
                    msg = str(rec.get("exception_message") or "")
                    break
            if not msg:
                return CellVerdict.OTHER_ERROR.value, failed_stage, True
            try:
                verdict = decide(msg)
            except ValueError:
                verdict = CellVerdict.OTHER_ERROR.value
            return verdict, failed_stage, True
        return CellVerdict.OTHER_ERROR.value, None, True

    return CellVerdict.OTHER_ERROR.value, None, False


@dataclass
class SubprocessRunner:
    """Spawn the probe as a subprocess, watch it, classify the result."""

    cmd: list[str]
    out_dir: Path
    cell_label: str
    config: WatchConfig
    terminator: Terminator = field(default_factory=RealTerminator)

    def _ensure_dead(self, child: "subprocess.Popen[str]") -> None:
        """Guarantee the child tree is reaped before ``run`` returns.

        No-op if the child already exited on its own. Otherwise escalate:
        graceful ``terminate`` -> wait ``terminate_grace_seconds`` ->
        forced ``kill`` -> wait ``kill_grace_seconds``. With a real
        Terminator this leaves ``child.returncode`` non-None (the child
        is dead); the only way it stays None is a non-killing Terminator
        such as the test FakeTerminator, which real-reap gates avoid.
        """
        if child.poll() is not None:
            return
        self.terminator.terminate(child.pid)
        try:
            child.wait(timeout=self.config.terminate_grace_seconds)
            return
        except subprocess.TimeoutExpired:
            pass
        self.terminator.kill(child.pid)
        try:
            child.wait(timeout=self.config.kill_grace_seconds)
        except subprocess.TimeoutExpired:
            pass

    def run(self) -> WatchResult:
        """Block until the child exits or a timeout fires; return WatchResult.

        Never raises. The child is always either reaped or killed
        before this method returns.
        """
        start = time.monotonic()
        last_heartbeat_at = start
        last_heartbeat_stage: Optional[str] = None
        killed = False
        timed_out = False
        stderr_chunks: list[str] = []
        stderr_lock = threading.Lock()

        try:
            child_env = os.environ.copy()
            existing_pp = child_env.get("PYTHONPATH", "")
            algo_root = str(Path(__file__).resolve().parent.parent.parent)
            child_env["PYTHONPATH"] = (
                algo_root + (os.pathsep + existing_pp if existing_pp else "")
            )
            child = subprocess.Popen(
                self.cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=str(self.out_dir),
                env=child_env,
                **_popen_isolation_kwargs(),
            )
        except OSError:
            elapsed = time.monotonic() - start
            return WatchResult(
                cell_label=self.cell_label,
                verdict=CellVerdict.OTHER_ERROR.value,
                failed_stage=None,
                last_heartbeat_stage=None,
                exit_code=None,
                killed=False,
                timed_out=False,
                partial_json=False,
                stderr_tail="",
                elapsed_seconds=elapsed,
            )

        stdout_fh = None
        stderr_fh = None
        t_out = None
        t_err = None
        try:
            stdout_log = self.out_dir / f"{self.cell_label}.stdout.log"
            stderr_log = self.out_dir / f"{self.cell_label}.stderr.log"
            stdout_fh = stdout_log.open("w", encoding="utf-8", errors="replace")
            stderr_fh = stderr_log.open("w", encoding="utf-8", errors="replace")

            def _drain_stdout() -> None:
                nonlocal last_heartbeat_at, last_heartbeat_stage
                assert child.stdout is not None
                for line in child.stdout:
                    stdout_fh.write(line)
                    stdout_fh.flush()
                    try:
                        evt = parse_heartbeat_line(line)
                    except ValueError:
                        # A malformed heartbeat means a probe bug, not a
                        # reason to kill the drain thread: a dead drain
                        # thread stalls the pipe and the run is then
                        # misclassified as TIMEOUT. Log-and-skip; the raw
                        # line is already written to the stdout log above.
                        continue
                    if evt is not None:
                        last_heartbeat_at = time.monotonic()
                        last_heartbeat_stage = evt.stage

            def _drain_stderr() -> None:
                assert child.stderr is not None
                for line in child.stderr:
                    stderr_fh.write(line)
                    stderr_fh.flush()
                    with stderr_lock:
                        stderr_chunks.append(line)

            t_out = threading.Thread(target=_drain_stdout, name=f"out-{self.cell_label}", daemon=True)
            t_err = threading.Thread(target=_drain_stderr, name=f"err-{self.cell_label}", daemon=True)
            t_out.start()
            t_err.start()

            while child.poll() is None:
                now = time.monotonic()
                if now - last_heartbeat_at > self.config.heartbeat_timeout_seconds:
                    killed = True
                    timed_out = True
                    break
                if now - start > self.config.process_timeout_seconds:
                    killed = True
                    timed_out = True
                    break
                time.sleep(self.config.poll_interval_seconds)
        except Exception:
            # run() never raises. A setup failure (e.g. an un-openable log
            # path) lands here; the child is reaped in the finally block and
            # the result is classified OTHER_ERROR below (no partial JSON).
            pass
        finally:
            self._ensure_dead(child)
            if t_out is not None:
                t_out.join(timeout=5.0)
            if t_err is not None:
                t_err.join(timeout=5.0)
            if stdout_fh is not None:
                stdout_fh.close()
            if stderr_fh is not None:
                stderr_fh.close()

        exit_code = child.returncode
        elapsed = time.monotonic() - start
        with stderr_lock:
            stderr_text = "".join(stderr_chunks)
        stderr_tail = stderr_text[-_STDERR_TAIL_CHARS:]

        json_path = self.out_dir / f"{self.cell_label}.json"
        verdict, failed_stage, partial_json = _classify(
            exit_code=exit_code,
            json_path=json_path,
            last_heartbeat_stage=last_heartbeat_stage,
            timed_out=timed_out,
            stderr_tail=stderr_tail,
        )
        return WatchResult(
            cell_label=self.cell_label,
            verdict=verdict,
            failed_stage=failed_stage,
            last_heartbeat_stage=last_heartbeat_stage,
            exit_code=exit_code,
            killed=killed,
            timed_out=timed_out,
            partial_json=partial_json,
            stderr_tail=stderr_tail,
            elapsed_seconds=elapsed,
        )
