"""P2-02A T3 environment-fingerprint unit tests.

Drives ``capture_environment`` with a fake adapter so the test runs
without CUDA / torch. The real adapter is exercised in T8 on the GPU
host only.
"""
from __future__ import annotations
from dataclasses import dataclass
from p1.stability.environment import capture_environment


@dataclass
class _FakeAdapter:
    def cuda_is_available(self) -> bool: return True
    def cuda_device_count(self) -> int: return 1
    def cuda_mem_get_info(self, device: int = 0): return (7_000 * 1024**2, 8_188 * 1024**2)
    def device_name(self, device: int = 0) -> str: return "RTX 4060 Laptop"
    def versions_dict(self): return {"torch": "2.7.0", "cuda": "11.8", "cudnn": "8", "driver": "531.61"}
    def weights_cache_path(self, weights_id: str): return "/c/efficientnet_b4.pth"


def test_capture_environment_has_required_keys():
    env = capture_environment(_FakeAdapter(), now="2026-07-27T00:00:00Z", git_commit="abc123")
    assert env["timestamp"] == "2026-07-27T00:00:00Z"
    assert env["git_commit"] == "abc123"
    assert env["cuda_available"] is True
    assert env["device_count"] == 1
    assert env["device_name"] == "RTX 4060 Laptop"
    assert env["vram_free_mb"] == 7_000
    assert env["vram_total_mb"] == 8_188
    assert env["torch_version"] == "2.7.0"
    assert env["cuda_version"] == "11.8"
    assert "python_version" in env and "platform" in env and "hostname" in env


def test_capture_environment_no_gpu_does_not_raise():
    class _NoGpu:
        def cuda_is_available(self) -> bool: return False
        def cuda_device_count(self) -> int: return 0
        def cuda_mem_get_info(self, device: int = 0): return (0, 0)
        def device_name(self, device: int = 0) -> str: return ""
        def versions_dict(self): return {"torch": "x", "cuda": "", "cudnn": "", "driver": ""}
        def weights_cache_path(self, weights_id: str): return None
    env = capture_environment(_NoGpu(), now="2026-07-27T00:00:00Z", git_commit=None)
    assert env["cuda_available"] is False
    assert env["device_count"] == 0
    assert env["device_name"] == ""
    assert env["vram_free_mb"] == 0 and env["vram_total_mb"] == 0
    assert env["git_commit"] is None
