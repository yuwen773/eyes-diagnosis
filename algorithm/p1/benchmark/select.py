"""Deterministic Dev-patient selection for the real-data I/O benchmark.

The I/O benchmark uses a fixed set of Development patients so its numbers
are reproducible. Selection is by ``sha256(patient_id)`` digest ordering,
which is stable across runs and machines and independent of any random seed.

Hard boundary: frozen **Test** patients are never eligible — the benchmark
must never touch the held-out set. The ``challenge_unlabeled`` pool is also
out of scope (it is not present in the split assignment).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd


def select_dev_patients(split_assignment_path: Path | str, *, n: int) -> list[str]:
    """Return ``n`` Dev patient ids chosen deterministically by sha256 order.

    Parameters
    ----------
    split_assignment_path:
        Path to ``split_assignment_v1.csv`` (columns ``patient_id``, ``split``).
    n:
        Number of Dev patients to select.

    Returns
    -------
    list[str]
        Exactly ``n`` patient ids, sorted by ``sha256(patient_id)`` digest.

    Raises
    ------
    ValueError
        If fewer than ``n`` Dev patients exist.
    """
    df = pd.read_csv(split_assignment_path, dtype={"patient_id": str})
    dev = df.loc[df["split"] == "dev", "patient_id"].astype(str).tolist()
    if len(dev) < n:
        raise ValueError(
            f"need {n} Dev patients but split has only {len(dev)}"
        )
    ordered = sorted(dev, key=lambda p: hashlib.sha256(p.encode("utf-8")).digest())
    return ordered[:n]
