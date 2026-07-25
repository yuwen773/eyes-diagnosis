"""Deterministic E2 eye assignment.

For each patient we choose ``"left"`` or ``"right"`` based on the low bit
of ``sha256(f"{patient_id}:{seed}").digest()[0]``. The seed is part of the
hashed payload (not XOR-folded), so every seed bit affects the assignment.
The same patient and seed always produce the same eye, independent of
fold/epoch/run, satisfying the slice's determinism contract.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Mapping, Sequence


class E2AssignmentError(RuntimeError):
    """Base class for E2-assignment failures."""


class E2AssignmentMismatch(E2AssignmentError):
    """The on-disk assignment does not match the requested seed."""


def _eye_for(patient_id: str, seed: int) -> str:
    payload = f"{patient_id}:{seed}".encode("utf-8")
    digest = hashlib.sha256(payload).digest()
    return "left" if (digest[0] % 2 == 0) else "right"


def assign_e2_eyes(patient_ids: Sequence[str], *, seed: int) -> dict[str, str]:
    if not patient_ids:
        raise E2AssignmentError("assign_e2_eyes: patient_ids is empty")
    return {pid: _eye_for(pid, seed) for pid in patient_ids}


def write_e2_assignment(
    patient_to_eye: Mapping[str, str], *, seed: int, out_path: Path
) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {"patient_id": pid, "eye": eye, "seed": seed}
        for pid, eye in sorted(patient_to_eye.items())
    ]
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["patient_id", "eye", "seed"])
        writer.writeheader()
        writer.writerows(rows)
    return out_path


def read_e2_assignment(path: Path) -> dict[str, str]:
    path = Path(path)
    out: dict[str, str] = {}
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = row["patient_id"]
            eye = row["eye"]
            row_seed = int(row["seed"])
            expected = _eye_for(pid, row_seed)
            if eye != expected:
                raise E2AssignmentMismatch(
                    f"e2 assignment file {path}: row for {pid} says {eye!r} "
                    f"but sha256(patient|seed) maps to {expected!r}"
                )
            out[pid] = eye
    return out