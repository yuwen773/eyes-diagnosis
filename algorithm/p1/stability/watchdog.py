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
    "HeartbeatEvent",
    "parse_heartbeat_line",
]
