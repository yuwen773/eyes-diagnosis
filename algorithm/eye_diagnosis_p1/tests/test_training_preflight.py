"""Unit tests for the preflight free-VRAM check."""

from __future__ import annotations

import pytest

from p1.training.preflight import InsufficientVram, check_required_free_vram_mb


def test_passes_when_free_vram_above_threshold() -> None:
    fake = lambda device=None: (8000 * 1024 * 1024, 8188 * 1024 * 1024)  # bytes
    free_mb = check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert free_mb == 8000


def test_passes_at_exact_threshold() -> None:
    fake = lambda device=None: (6800 * 1024 * 1024, 8188 * 1024 * 1024)
    free_mb = check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert free_mb == 6800


def test_raises_when_free_vram_below_threshold() -> None:
    fake = lambda device=None: (6799 * 1024 * 1024, 8188 * 1024 * 1024)
    with pytest.raises(InsufficientVram) as ei:
        check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert "6799" in str(ei.value)
    assert "6800" in str(ei.value)


def test_message_mentions_nvidia_smi_hint() -> None:
    fake = lambda device=None: (1000 * 1024 * 1024, 8188 * 1024 * 1024)
    with pytest.raises(InsufficientVram) as ei:
        check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert "nvidia-smi" in str(ei.value).lower()


def test_no_retry_or_autodegrade_path() -> None:
    """The function must not loop, must not return a degraded value, and must
    not accept any 'fall_back'/'on_low' kwarg. We assert the signature is
    exactly (threshold_mb, mem_get_info)."""
    import inspect

    sig = inspect.signature(check_required_free_vram_mb)
    assert list(sig.parameters) == ["threshold_mb", "mem_get_info"]