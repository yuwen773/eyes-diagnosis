"""FakeEnvironmentCapture — stable environment dict for fingerprint tests."""
from __future__ import annotations

from typing import Any

_FROZEN_ENV: dict[str, Any] = {
    "schema_version": "p2-02a-v1",
    "python_version": "3.11.15",
    "torch_version": "2.4.1+cu118",
    "cuda_available": False,  # CI is CPU-only; real adapter flips this on GPU host
    "cuda_device_count": 0,
    "gpu_name": None,
    "driver_version": None,
    "conda_env": "eye-p1-bench",
    "platform": "win32",
    "git_commit": "37de954",  # pinned to spec commit; tests can override
    "vram_total_mb": 0,
    "vram_free_mb": 0,
}


class FakeEnvironmentCapture:
    """Returns a stable environment fingerprint. Tests can override fields."""

    def __init__(self, override: dict[str, Any] | None = None) -> None:
        self._override = override or {}

    def __call__(
        self, *, now: str | None = None, git_commit: str | None = None
    ) -> dict[str, Any]:
        env = dict(_FROZEN_ENV)
        env.update(self._override)
        if now is not None:
            env["timestamp"] = now
        if git_commit is not None:
            env["git_commit"] = git_commit
        return env