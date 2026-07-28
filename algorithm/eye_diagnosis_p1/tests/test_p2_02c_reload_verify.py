"""Tests for algorithm/p1/training/reload_verify.py.

verify() loads best_checkpoint.pth from <out_dir>/fold_0/, recomputes
SHA256, and confirms two consecutive loads produce equal state_dicts.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import torch
from torch import nn


def _save_minimal_checkpoint(path: Path) -> None:
    """Save a deterministic checkpoint via the P2-02B checkpoint module."""
    from p1.training.checkpoint import save_checkpoint, sha256_file
    model = nn.Linear(4, 2)
    sd = {k: v.detach().clone() for k, v in model.state_dict().items()}
    save_checkpoint(
        sd,
        metadata={"schema_version": "p2-02b-v1", "fold": 0, "epoch": 0,
                  "best_metric": 0.0, "config_hash": "deadbeef",
                  "saved_at": "2026-07-28T00:00:00Z"},
        path=path,
    )
    # Sidecar: written by formal_fold_runner after save_checkpoint.
    (path.parent / "best_checkpoint.sha256").write_text(
        sha256_file(path) + "\n", encoding="utf-8"
    )


def test_verify_returns_ok_when_checkpoint_round_trips(tmp_path: Path) -> None:
    from p1.training.reload_verify import verify
    fold0 = tmp_path / "fold_0"; fold0.mkdir()
    _save_minimal_checkpoint(fold0 / "best_checkpoint.pth")
    # sha256 sidecar is written by save_checkpoint already.

    result = verify(tmp_path)
    assert result.ok is True
    assert result.sha256_match is True
    assert result.state_dict_identical is True
    assert len(result.sha256) == 64
    assert result.num_params == 4 * 2 + 2  # 10
    assert result.config_hash == "deadbeef"


def test_verify_raises_on_missing_checkpoint(tmp_path: Path) -> None:
    from p1.training.reload_verify import ReloadError, verify
    with pytest.raises(ReloadError, match="checkpoint missing"):
        verify(tmp_path)


def test_verify_raises_on_missing_sha256_sidecar(tmp_path: Path) -> None:
    from p1.training.reload_verify import ReloadError, verify
    fold0 = tmp_path / "fold_0"; fold0.mkdir()
    _save_minimal_checkpoint(fold0 / "best_checkpoint.pth")
    (fold0 / "best_checkpoint.sha256").unlink()
    with pytest.raises(ReloadError, match="sha256 file missing"):
        verify(tmp_path)


def test_verify_raises_on_sha256_mismatch(tmp_path: Path) -> None:
    from p1.training.reload_verify import ReloadError, verify
    fold0 = tmp_path / "fold_0"; fold0.mkdir()
    _save_minimal_checkpoint(fold0 / "best_checkpoint.pth")
    (fold0 / "best_checkpoint.sha256").write_text(
        "0000000000000000000000000000000000000000000000000000000000000000\n"
    )
    with pytest.raises(ReloadError, match="sha256_match=False"):
        verify(tmp_path)


def test_verify_raises_on_state_dict_mismatch(tmp_path, monkeypatch) -> None:
    """Two consecutive loads returning different state_dicts → ReloadError.

    Note: with the current sha256 + state_dict layout, mutating the on-disk
    file also breaks the sha256 check (both checks trip together). To test
    state_dict mismatch in isolation, monkeypatch `load_checkpoint` to return
    different tensors on the second call. The sha256 check still passes
    because the on-disk bytes + sidecar are unchanged.
    """
    from p1.training import reload_verify as rv

    fold0 = tmp_path / "fold_0"; fold0.mkdir()
    _save_minimal_checkpoint(fold0 / "best_checkpoint.pth")
    # sidecar already matches; sha check passes.

    original_load = rv.load_checkpoint
    calls = [0]

    def _diverging_load(path):
        sd, meta = original_load(path)
        if calls[0] == 0:
            calls[0] += 1
            return sd, meta
        # Second call: nudge every floating-point tensor by +1 (bit-identical
        # to the original only if torch is broken, never in practice).
        sd2 = {k: (v + 1.0) if v.dtype.is_floating_point else v
               for k, v in sd.items()}
        return sd2, meta

    monkeypatch.setattr(rv, "load_checkpoint", _diverging_load)

    from p1.training.reload_verify import ReloadError, verify
    with pytest.raises(ReloadError, match="state_dict_identical=False"):
        verify(tmp_path)