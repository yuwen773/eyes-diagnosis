"""Pytest configuration for the P1 baseline tests.

Registers an opt-in ``--eye-data-root`` flag (also readable from the
``EYE_DATA_ROOT`` environment variable) used by the integration tests that
exercise the real source dataset.
"""

from __future__ import annotations

import os
from pathlib import Path


def pytest_addoption(parser) -> None:
    parser.addoption(
        "--eye-data-root",
        action="store",
        default=os.environ.get("EYE_DATA_ROOT", ""),
        help="Path to the read-only source dataset root (or set EYE_DATA_ROOT).",
    )


def pytest_report_header(config) -> str:
    root = config.getoption("--eye-data-root")
    if root:
        return f"eye-data-root: {Path(root)}"
    return "eye-data-root: <unset> (integration tests will skip)"


def pytest_configure(config) -> None:
    config.addinivalue_line(
        "markers",
        "slow: marks tests as slow (deselect with -m 'not slow'); "
        "currently used by the watchdog subprocess suite which takes ~62s locally",
    )