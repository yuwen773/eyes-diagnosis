"""P2-02B checkpoint utilities — atomic save/load + SHA256.

Used by ``formal_fold_runner.py`` to persist the best-epoch model state
per fold. Every write uses ``tmp + os.replace`` so OOM or power loss
cannot leave a half-written ``.pth`` behind; every success leaves no
``.tmp`` file. ``sha256_file`` produces a hex digest that the runner
records next to the checkpoint for receipt integrity.

Schema (frozen for round 1):
    * ``.pth`` contains ``{'__meta__': metadata, **state_dict}``
    * metadata schema version: ``"p2-02b-v1"``
"""
from __future__ import annotations

import hashlib
import io
import pickle
from pathlib import Path
from typing import Any

import torch

from p1.training._atomic_io import atomic_write_text


class CheckpointError(IOError):
    """Raised when a checkpoint write/read fails (disk full, permission, etc.)."""


def save_checkpoint(
    state_dict: dict[str, Any],
    metadata: dict[str, Any],
    path: Path,
) -> None:
    """Save a model state_dict + metadata atomically.

    ``metadata`` is stored under the ``'__meta__'`` key in the same file
    so ``load_checkpoint`` recovers both. Raises ``CheckpointError`` on
    any I/O failure.
    """
    payload = {"__meta__": dict(metadata), **state_dict}
    buf = io.BytesIO()
    try:
        torch.save(payload, buf)
        atomic_write_text(Path(path), lambda tmp: tmp.write_bytes(buf.getvalue()))
    except (IOError, OSError) as exc:
        raise CheckpointError(f"save_checkpoint failed: path={path}, exc={exc!r}") from exc


def load_checkpoint(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load state_dict and metadata from a checkpoint file.

    Returns ``(state_dict, metadata)``. The returned state_dict has the
    ``__meta__`` key stripped. Raises ``CheckpointError`` on I/O failure.
    """
    p = Path(path)
    try:
        payload = torch.load(p, map_location="cpu", weights_only=False)
    except (IOError, OSError, RuntimeError, pickle.UnpicklingError) as exc:
        raise CheckpointError(f"load_checkpoint failed: path={p}, exc={exc!r}") from exc
    metadata = dict(payload.pop("__meta__", {}))
    return payload, metadata


def sha256_file(path: Path) -> str:
    """Return the hex SHA256 of file bytes. Raises ``CheckpointError`` on I/O."""
    p = Path(path)
    try:
        h = hashlib.sha256()
        with p.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
    except (IOError, OSError) as exc:
        raise CheckpointError(f"sha256_file failed: path={p}, exc={exc!r}") from exc
    return h.hexdigest()