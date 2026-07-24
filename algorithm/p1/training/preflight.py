"""Start-up free VRAM check for the E0–E3 training entry point.

Fails closed at the configured threshold (default 6800 MB). Never
auto-downgrades backbone or patient batch; the caller is expected to
terminate the run, free GPU memory, and start a new protocol version
if it needs to train with a smaller budget.
"""

from __future__ import annotations

from typing import Callable, Optional

import torch


class InsufficientVram(RuntimeError):
    """Raised when the GPU has less free VRAM than the protocol threshold."""


def check_required_free_vram_mb(
    threshold_mb: int = 6800,
    *,
    mem_get_info: Optional[Callable[[Optional[int]], tuple[int, int]]] = None,
) -> int:
    """Return observed free VRAM (MB) or raise ``InsufficientVram``.

    Parameters
    ----------
    threshold_mb:
        Minimum acceptable free VRAM in MB.
    mem_get_info:
        Optional callable compatible with ``torch.cuda.mem_get_info``.
        Tests inject a fake; production code leaves it ``None``.
    """
    getter = mem_get_info or torch.cuda.mem_get_info
    free_bytes, _total_bytes = getter(0)
    free_mb = int(free_bytes // (1024 * 1024))
    if free_mb < threshold_mb:
        raise InsufficientVram(
            f"Insufficient free VRAM: {free_mb} MB available, "
            f"protocol requires at least {threshold_mb} MB. "
            "Close other GPU programs (e.g. `nvidia-smi` and kill the listed "
            "PIDs) and re-run, or create protocol_e0_e3_vN.json with a "
            "smaller threshold. The runner does not auto-degrade."
        )
    return free_mb