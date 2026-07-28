"""Reload best_checkpoint.pth and verify the round-trip is lossless.

Used by ``p1.training.fold0_smoke`` after a successful subprocess run.
On any mismatch, raises :class:`ReloadError` (the caller maps to a
BLOCKED verdict + ``error_class="reload_mismatch"``).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import torch

from p1.training.checkpoint import load_checkpoint, sha256_file


class ReloadError(RuntimeError):
    """Round-trip mismatch between saved and re-loaded checkpoint."""


@dataclass(frozen=True)
class ReloadResult:
    ok: bool
    sha256_match: bool
    state_dict_identical: bool
    sha256: str
    num_params: int
    config_hash: str


def verify(out_dir: Path) -> ReloadResult:
    """Verify that ``<out_dir>/fold_0/best_checkpoint.pth`` round-trips.

    Performs three checks (any failure raises ``ReloadError``):
      1. Both ``best_checkpoint.pth`` and ``best_checkpoint.sha256`` exist.
      2. ``sha256_file(best_checkpoint.pth) == best_checkpoint.sha256`` contents.
      3. Two consecutive ``load_checkpoint`` calls produce state_dicts that
         are equal key-by-key (shape + ``torch.equal``).
    """
    fold_dir = out_dir / "fold_0"
    ckpt = fold_dir / "best_checkpoint.pth"
    sha_file = fold_dir / "best_checkpoint.sha256"
    if not ckpt.exists():
        raise ReloadError(f"checkpoint missing: {ckpt}")
    if not sha_file.exists():
        raise ReloadError(f"sha256 file missing: {sha_file}")

    actual = sha256_file(ckpt)
    recorded = sha_file.read_text().strip()
    sha_ok = actual == recorded

    sd_a, meta_a = load_checkpoint(ckpt)
    sd_b, _ = load_checkpoint(ckpt)
    state_ok = True
    for k, v_a in sd_a.items():
        v_b = sd_b.get(k)
        if v_b is None or v_a.shape != v_b.shape or not torch.equal(v_a, v_b):
            state_ok = False
            break

    if not (sha_ok and state_ok):
        raise ReloadError(
            f"reload mismatch: sha256_match={sha_ok}, "
            f"state_dict_identical={state_ok}"
        )

    return ReloadResult(
        ok=True,
        sha256_match=sha_ok,
        state_dict_identical=state_ok,
        sha256=actual,
        num_params=sum(t.numel() for t in sd_a.values()),
        config_hash=str(meta_a.get("config_hash", "")),
    )


__all__ = ["ReloadError", "ReloadResult", "verify"]

