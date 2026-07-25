"""6-cell diagnostic matrix for the P2-02A CUDA stability probe.

The matrix is frozen: A-F maps onto the user-specified suspension-and-
escalation ladder. Adding/removing/reordering cells requires a
``schema_version`` bump in the P2-02A protocol.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


MATRIX_ROWS: tuple[tuple[str, dict[str, Any]], ...] = (
    ("A", {"amp": False, "patient_batch": 1, "num_workers": 0, "pin_memory": False}),
    ("B", {"amp": True, "patient_batch": 1, "num_workers": 0, "pin_memory": False}),
    ("C", {"amp": True, "patient_batch": 2, "num_workers": 0, "pin_memory": False}),
    ("D", {"amp": True, "patient_batch": 4, "num_workers": 0, "pin_memory": False}),
    ("E", {"amp": True, "patient_batch": 8, "num_workers": 0, "pin_memory": False}),
    ("F", {"amp": True, "patient_batch": 8, "num_workers": 2, "pin_memory": True}),
)


@dataclass(frozen=True)
class Cell:
    """A single matrix cell: a label and its concrete config."""

    label: str
    config: dict[str, Any]


def expand_matrix() -> list[Cell]:
    """Return the matrix in strict serial order A-F. Do NOT shuffle."""
    return [Cell(label, dict(cfg)) for label, cfg in MATRIX_ROWS]


def matrix_to_dict(rows: list[Cell]) -> list[dict[str, Any]]:
    """Serialise a list of ``Cell`` to a JSON-friendly list of dicts."""
    return [{"label": row.label, "config": dict(row.config)} for row in rows]
