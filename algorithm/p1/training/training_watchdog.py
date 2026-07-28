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
            subprocess.run(
                ["cmd", "/c", "taskkill", "/F", "/PID", str(pid), "/T"],
                check=False, capture_output=True,
            )
        else:
            import os, signal
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except ProcessLookupError:
                pass


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