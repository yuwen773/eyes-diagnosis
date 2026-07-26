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
