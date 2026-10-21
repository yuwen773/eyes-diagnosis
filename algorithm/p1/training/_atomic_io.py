"""Atomic file-write helpers shared across ``p1.training`` modules.

Single source of truth for the tmp + ``os.replace`` pattern so JSON / CSV /
checkpoint writers cannot drift apart.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable


def atomic_write_text(path: Path, write_fn: Callable[[Path], None]) -> None:
    """Atomically replace ``path`` with the output of ``write_fn(tmp_path)``.

    On success the ``.tmp`` file is gone and ``path`` exists with whatever
    ``write_fn`` wrote. On any exception, ``.tmp`` is removed and ``path``
    is untouched. ``write_fn`` must accept a ``Path``.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        write_fn(tmp)
        os.replace(tmp, path)
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


__all__ = ["atomic_write_text"]