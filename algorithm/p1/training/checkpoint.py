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
import os
import pickle
from pathlib import Path
from typing import Any

import torch


class CheckpointError(IOError):
    """Raised when a checkpoint write/read fails (disk full, permission, etc.)."""


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` atomically (tmp + ``os.replace``).

    On success the ``.tmp`` file is gone and ``path`` exists with the
    exact bytes written. On any exception, ``.tmp`` is removed and
    ``path`` is untouched.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except Exception:
        # Clean up the tmp file if it exists.
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


def _atomic_write_torch(path: Path, payload: dict[str, Any]) -> None:
    """Serialize ``payload`` to bytes and write atomically."""
    buf = io.BytesIO()
    torch.save(payload, buf)
    _atomic_write_bytes(path, buf.getvalue())


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
    try:
        payload = {"__meta__": dict(metadata), **state_dict}
        _atomic_write_torch(Path(path), payload)
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