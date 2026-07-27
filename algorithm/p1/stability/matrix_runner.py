"""P2-02A T3 classification + T4 gate + atomic report write.

``run_matrix`` is added in a follow-up commit (Task 4) along with
``MatrixConfig`` / ``MatrixReport``; this module ships the
classification half first so unit tests can pin the gate logic
independently of the orchestration.
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from p1.stability.matrix import expand_matrix
from p1.stability.schema import CellVerdict

T4_AUTHORIZED = "T4_AUTHORIZED"
T4_BLOCKED = "T4_BLOCKED"
MISSING = "MISSING"
_PASS = CellVerdict.PASS.value


@dataclass(frozen=True)
class ClassifyResult:
    matrix_verdicts: dict[str, str]
    t4_gate: str
    blocking_cells: list[str]
    diagnostic: str


def classify(summary: dict) -> ClassifyResult:
    labels = [c.label for c in expand_matrix()]  # canonical A..F
    verdicts = {lab: str(summary.get(lab, {}).get("verdict", MISSING)) for lab in labels}
    blocking = [lab for lab in ("E", "F") if verdicts.get(lab) != _PASS]
    gate = T4_AUTHORIZED if not blocking else T4_BLOCKED
    return ClassifyResult(
        matrix_verdicts=verdicts,
        t4_gate=gate,
        blocking_cells=blocking,
        diagnostic=_diagnostic(verdicts, blocking),
    )


def _diagnostic(verdicts: dict[str, str], blocking: list[str]) -> str:
    # Borrows the intent of schema.finalize_decision WITHOUT calling it
    # (batch100 is absent at T3; calling it would mislabel all-PASS as BLOCKED).
    if verdicts.get("A") == CellVerdict.CUDA_ERROR.value:
        return "CUDA runtime blocked (cell A failed the no-AMP/batch-1 baseline)"
    oom = [lab for lab, v in verdicts.items() if v == CellVerdict.OOM.value]
    if oom:
        return f"memory-bound (OOM at cell {oom[0]})"
    if verdicts.get("E") == _PASS and verdicts.get("F") != _PASS:
        return "target DataLoader config (workers/pin) unstable at cell F"
    if not blocking:
        return "matrix clean; T4 authorized for E and F"
    return f"T4 blocked; non-PASS target cells: {blocking}"


def _write_json_atomic(path: Path, payload: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


__all__ = [
    "ClassifyResult",
    "MISSING",
    "T4_AUTHORIZED",
    "T4_BLOCKED",
    "_write_json_atomic",
    "classify",
]
