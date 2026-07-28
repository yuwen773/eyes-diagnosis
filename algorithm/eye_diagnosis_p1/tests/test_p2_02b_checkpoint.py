"""Tests for algorithm/p1/training/checkpoint.py."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
import torch
from torch import nn

from p1.training.checkpoint import (
    CheckpointError,
    load_checkpoint,
    save_checkpoint,
    sha256_file,
)


class _TinyModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.linear = nn.Linear(4, 2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.linear(x)


def test_save_load_roundtrip_returns_identical_state_dict(tmp_path: Path) -> None:
    model = _TinyModel()
    # Force deterministic weights.
    with torch.no_grad():
        model.linear.weight.fill_(0.5)
        model.linear.bias.fill_(0.25)
    original = {k: v.clone() for k, v in model.state_dict().items()}

    metadata = {"epoch": 3, "best_metric": 0.91, "fold": 0}
    target = tmp_path / "best.pth"
    save_checkpoint(model.state_dict(), metadata, target)

    assert target.exists()
    loaded_state, loaded_meta = load_checkpoint(target)
    assert set(loaded_state.keys()) == set(original.keys())
    for k in original:
        assert torch.equal(loaded_state[k], original[k])
    assert loaded_meta["epoch"] == 3
    assert loaded_meta["best_metric"] == 0.91
    assert loaded_meta["fold"] == 0


def test_atomic_write_no_tmp_left_on_success(tmp_path: Path) -> None:
    model = _TinyModel()
    target = tmp_path / "best.pth"
    save_checkpoint(model.state_dict(), {"epoch": 0}, target)

    assert target.exists()
    # No .tmp file survives a successful write.
    leftover = list(tmp_path.glob("*.tmp"))
    assert leftover == [], f"unexpected tmp files: {leftover}"


def test_atomic_write_no_tmp_left_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """If the rename step fails, no .tmp file is left behind."""
    from p1.training import _atomic_io

    model = _TinyModel()
    target = tmp_path / "best.pth"

    # Force the rename step to raise so we hit the cleanup branch.
    def _raise_replace(*_a: object, **_k: object) -> None:
        raise OSError("simulated rename failure")

    monkeypatch.setattr(_atomic_io.os, "replace", _raise_replace)

    with pytest.raises(CheckpointError):
        save_checkpoint(model.state_dict(), {"epoch": 0}, target)

    leftover = list(tmp_path.glob("*.tmp"))
    assert leftover == [], f"tmp file leaked on failure: {leftover}"
    assert not target.exists(), "target should not be written when rename fails"


def test_sha256_matches_checkpoint_bytes(tmp_path: Path) -> None:
    """sha256_file returns the same hex digest as recomputing the file bytes."""
    model = _TinyModel()
    target = tmp_path / "best.pth"
    save_checkpoint(model.state_dict(), {"epoch": 7, "best_metric": 0.42}, target)

    recorded = sha256_file(target)

    # Independently re-compute the hash from file bytes.
    expected = hashlib.sha256(target.read_bytes()).hexdigest()
    assert recorded == expected
    # Hex digest is 64 chars (sha256).
    assert len(recorded) == 64 and all(c in "0123456789abcdef" for c in recorded)