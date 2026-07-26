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
    "Terminator",
    "WatchConfig",
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


# ---------------------------------------------------------------------------
# Terminator Protocol + the real Windows/POSIX implementations + a fake
# for unit tests. The runner holds a Terminator (not a RealTerminator)
# so the kill path is unit-testable without spawning a child.
# ---------------------------------------------------------------------------


class Terminator(Protocol):
    """Platform-aware process-tree killer."""

    def terminate(self, pid: int) -> None: ...


class RealTerminator:
    """Windows: ``taskkill /F /PID <pid> /T`` via array-form subprocess.run.

    POSIX: ``os.killpg(pgid, SIGTERM)``.

    The array form of ``subprocess.run`` is used (not the shell) so MSYS
    path translation cannot mangle the arguments. ``check=False``
    swallows the 128 exit code that ``taskkill`` returns when the PID
    is already gone.
    """

    def terminate(self, pid: int) -> None:
        if sys.platform == "win32":
            subprocess.run(
                ["cmd", "/c", "taskkill", "/F", "/PID", str(pid), "/T"],
                check=False,
                capture_output=True,
            )
            return
        try:
            pgid = os.getpgid(pid)
        except ProcessLookupError:
            return
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            return


@dataclass
class FakeTerminator:
    """Test double: records every pid passed to ``terminate``."""

    pids: list[int] = field(default_factory=list)

    def terminate(self, pid: int) -> None:
        self.pids.append(int(pid))
