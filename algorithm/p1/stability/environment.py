"""P2-02A T3 read-only environment fingerprint.

Wraps a tiny ``T3EnvAdapter`` Protocol so the fingerprint can be
unit-tested on a CPU-only host via a fake. The real adapter
(``RealT3EnvAdapter``) imports ``torch``/``torchvision`` lazily and is
only constructed on the GPU host.

This module is read-only: it never imports training code, never
launches subprocesses, never touches disk beyond constructing a
plain ``dict``.
"""
from __future__ import annotations

import platform
import socket
import sys
from typing import Optional, Protocol


class T3EnvAdapter(Protocol):
    """Injectable surface for the GPU/VRAM/weights probes T3 needs.

    Every method has a sensible default for the CPU-only test host:
    ``cuda_is_available`` returns ``False`` and ``weights_cache_path``
    returns ``None``. ``capture_environment`` is total — it never
    raises for missing GPU.
    """

    def cuda_is_available(self) -> bool: ...
    def cuda_device_count(self) -> int: ...
    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]: ...
    def device_name(self, device: int = 0) -> str: ...
    def versions_dict(self) -> dict: ...
    def weights_cache_path(self, weights_id: str) -> Optional[str]: ...


def capture_environment(adapter: T3EnvAdapter, *, now: str, git_commit: Optional[str]) -> dict:
    """Read-only environment fingerprint. Never raises for missing GPU."""
    available = bool(adapter.cuda_is_available())
    free_mb = total_mb = 0
    device_name = ""
    if available and adapter.cuda_device_count() >= 1:
        free_b, total_b = adapter.cuda_mem_get_info(0)
        free_mb, total_mb = free_b // (1024**2), total_b // (1024**2)
        device_name = adapter.device_name(0)
    v = adapter.versions_dict()
    return {
        "timestamp": now,
        "git_commit": git_commit,
        "cuda_available": available,
        "device_count": int(adapter.cuda_device_count()),
        "device_name": device_name,
        "vram_free_mb": int(free_mb),
        "vram_total_mb": int(total_mb),
        "torch_version": v.get("torch", ""),
        "cuda_version": v.get("cuda", ""),
        "cudnn_version": v.get("cudnn", ""),
        "driver_version": v.get("driver", ""),
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "hostname": socket.gethostname(),
    }


class RealT3EnvAdapter:
    """torch/torchvision-backed adapter. Imported lazily on the GPU host."""

    def cuda_is_available(self) -> bool:
        import torch
        return bool(torch.cuda.is_available())

    def cuda_device_count(self) -> int:
        import torch
        return int(torch.cuda.device_count())

    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]:
        import torch
        return tuple(torch.cuda.mem_get_info(device))  # type: ignore[return-value]

    def device_name(self, device: int = 0) -> str:
        import torch
        return str(torch.cuda.get_device_name(device))

    def versions_dict(self) -> dict:
        import torch
        return {
            "torch": torch.__version__,
            "cuda": torch.version.cuda or "",
            "cudnn": str(getattr(torch.backends.cudnn, "version", lambda: "")() or ""),
            "driver": _driver_version(),
        }

    def weights_cache_path(self, weights_id: str) -> Optional[str]:
        # weights_id e.g. "EfficientNet_B4_Weights.IMAGENET1K_V1"
        import os
        import torch
        from torchvision.models import get_weight
        try:
            weight = get_weight(weights_id)
            filename = weight.url.split("/")[-1]
        except Exception:
            return None
        candidate = os.path.join(torch.hub.get_dir(), "checkpoints", filename)
        return candidate if os.path.exists(candidate) else None


def _driver_version() -> str:
    try:
        import torch
        v = torch._C._cuda_getDriverVersion()  # type: ignore[attr-defined]
        return str(v)
    except Exception:
        return ""


__all__ = ["T3EnvAdapter", "RealT3EnvAdapter", "capture_environment"]
