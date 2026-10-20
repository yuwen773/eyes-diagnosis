"""P2-02C subprocess watchdog for the training pipeline.

Mirrors p1.stability.watchdog's structure but is bound to the training
heartbeat vocabulary (HEARTBEAT EPOCH/CHECKPOINT). It does NOT import
anything from p1.stability.watchdog; the two pipelines are independent.
"""
from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional, Protocol


# --- heartbeat vocabulary ---------------------------------------------------

_HEARTBEAT_LINE = re.compile(
    r"^\s*HEARTBEAT (EPOCH (?P<epoch>\d+) (START|PASS)"
    r"|CHECKPOINT_SAVED (?P<ckpt>\S+))\s*$"
)


@dataclass(frozen=True)
class HeartbeatEvent:
    kind: str                                      # "EPOCH" | "CHECKPOINT"
    epoch: Optional[int] = None
    status: Optional[str] = None                    # "START" | "PASS" for EPOCH
    checkpoint_path: Optional[str] = None           # for CHECKPOINT


def parse_heartbeat_line(line: str) -> Optional[HeartbeatEvent]:
    """Return a HeartbeatEvent for valid lines, None for everything else."""
    m = _HEARTBEAT_LINE.match(line)
    if not m:
        return None
    if m.group("epoch") is not None:
        return HeartbeatEvent(kind="EPOCH", epoch=int(m.group("epoch")),
                              status=m.group(3))
    return HeartbeatEvent(kind="CHECKPOINT", checkpoint_path=m.group("ckpt"))


# --- config -----------------------------------------------------------------


@dataclass(frozen=True)
class WatchConfig:
    process_timeout_seconds: float = 300.0
    heartbeat_timeout_seconds: float = 90.0
    poll_interval_seconds: float = 0.1


# --- terminator -------------------------------------------------------------


class Terminator(Protocol):
    def terminate(self, pid: int) -> None: ...


class RealTerminator:
    """Total: never raises. taskkill on Windows, SIGTERM on POSIX."""

    def terminate(self, pid: int) -> None:
        if sys.platform == "win32":
            try:
                subprocess.run(
                    ["cmd", "/c", "taskkill", "/F", "/PID", str(pid), "/T"],
                    check=False, capture_output=True,
                )
            except OSError:
                pass
            return
        try:
            self._signal_process_group(pid)
        except ProcessLookupError:
            # The group is already gone — the desired end state.
            pass
        except PermissionError:
            # The pid exists but is not ours. Signalling it would be wrong,
            # and terminate() is documented as total, so swallow it.
            pass
        except OSError:
            # Anything else from getpgid/killpg (e.g. EINVAL on a bogus pid).
            pass

    @staticmethod
    def _signal_process_group(pid: int) -> None:
        """SIGTERM the pid's process group. POSIX only; may raise OSError."""
        import os, signal
        os.killpg(os.getpgid(pid), signal.SIGTERM)


# --- result -----------------------------------------------------------------


@dataclass(frozen=True)
class WatchResult:
    cell_label: str
    verdict: str                              # PASS | BLOCKED | TIMEOUT
    error_class: Optional[str]                # nonzero_exit | heartbeat_stale | process_timeout | None
    last_heartbeat_epoch: Optional[int]
    last_checkpoint: Optional[str]
    exit_code: Optional[int]
    killed: bool
    timed_out: bool
    stderr_tail: str
    elapsed_seconds: float


# --- subprocess runner (Task 2) ---------------------------------------------


import threading
import time
from dataclasses import field as _field
from pathlib import Path as _Path


@dataclass
class SubprocessRunner:
    cmd: list[str]
    out_dir: _Path
    cell_label: str
    config: WatchConfig = _field(default_factory=WatchConfig)
    terminator: Terminator = _field(default_factory=RealTerminator)

    def run(self) -> WatchResult:
        out_dir = _Path(self.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
        stdout_log = out_dir / ".stdout.log"
        stderr_log = out_dir / ".stderr.log"
        start = time.monotonic()

        proc = subprocess.Popen(self.cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, bufsize=1)

        last_hb_at = start
        last_epoch: Optional[int] = None
        last_ckpt: Optional[str] = None
        lock = threading.Lock()

        def _stdout_reader() -> None:
            assert proc.stdout is not None
            with stdout_log.open("w", encoding="utf-8") as fh:
                for line in proc.stdout:
                    fh.write(line)
                    ev = parse_heartbeat_line(line)
                    if ev is None:
                        continue
                    with lock:
                        nonlocal last_hb_at, last_epoch, last_ckpt
                        last_hb_at = time.monotonic()
                        if ev.kind == "EPOCH":
                            last_epoch = ev.epoch
                        elif ev.kind == "CHECKPOINT":
                            last_ckpt = ev.checkpoint_path

        def _stderr_reader() -> None:
            assert proc.stderr is not None
            with stderr_log.open("w", encoding="utf-8") as fh:
                for line in proc.stderr:
                    fh.write(line)

        t_out = threading.Thread(target=_stdout_reader, daemon=True)
        t_err = threading.Thread(target=_stderr_reader, daemon=True)
        t_out.start(); t_err.start()

        exit_code: Optional[int] = None
        killed = timed_out = False
        verdict = "BLOCKED"
        error_class: Optional[str] = "nonzero_exit"

        while proc.poll() is None:
            now = time.monotonic()
            with lock:
                hb_age = now - last_hb_at
                cur_epoch = last_epoch
            if hb_age > self.config.heartbeat_timeout_seconds and cur_epoch is not None:
                self.terminator.terminate(proc.pid)
                killed = timed_out = True
                error_class = "heartbeat_stale"
                break
            if now - start > self.config.process_timeout_seconds:
                self.terminator.terminate(proc.pid)
                killed = timed_out = True
                error_class = "process_timeout"
                break
            time.sleep(self.config.poll_interval_seconds)

        try:
            exit_code = proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            # Terminator should have killed it; treat as process_timeout fallback.
            killed = timed_out = True
            error_class = error_class or "process_timeout"
        t_out.join(timeout=5.0); t_err.join(timeout=5.0)

        if not timed_out:
            if exit_code == 0:
                verdict, error_class = "PASS", None
            else:
                verdict, error_class = "BLOCKED", "nonzero_exit"
        else:
            verdict = "TIMEOUT"

        stderr_tail = ""
        if stderr_log.exists():
            data = stderr_log.read_bytes()[-4096:].decode("utf-8", errors="replace")
            stderr_tail = data

        return WatchResult(
            cell_label=self.cell_label,
            verdict=verdict, error_class=error_class,
            last_heartbeat_epoch=last_epoch, last_checkpoint=last_ckpt,
            exit_code=exit_code, killed=killed, timed_out=timed_out,
            stderr_tail=stderr_tail,
            elapsed_seconds=time.monotonic() - start,
        )


def run_subprocess(cmd: list[str], out_dir: _Path, *,
                   cell_label: str = "fold0",
                   config: Optional[WatchConfig] = None,
                   terminator: Optional[Terminator] = None) -> WatchResult:
    runner = SubprocessRunner(
        cmd=cmd, out_dir=out_dir, cell_label=cell_label,
        config=config or WatchConfig(),
        terminator=terminator or RealTerminator(),
    )
    return runner.run()