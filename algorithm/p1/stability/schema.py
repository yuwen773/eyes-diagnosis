"""Result schema for the P2-02A CUDA stability probe.

This module defines three closed enums (StageStatus, CellVerdict,
Decision), the ordered stage-name list, the per-stage record factory,
the matrix-cell validator, the exception-text classifier, and the
finalize_decision rule that maps a matrix + 100-batch status onto a
single Decision enum value.

None of these enums may be extended without bumping the protocol
``schema_version``. The Decision enum is the public single-bit outcome
that downstream P2-02B/P2-02C code consults.
"""

from __future__ import annotations

import enum
from typing import Any


# Ordered list of stages the single-batch probe must walk through.
# Order matters: each stage's CUDA boundary is bracketed by
# torch.cuda.synchronize() so the staged report can localise a silent hang.
STAGE_NAMES: tuple[str, ...] = (
    "manifest_load",
    "frozen_input_validation",
    "dataloader_create",
    "first_batch_wait",
    "host_to_device",
    "forward",
    "loss",
    "backward",
    "optimizer_step",
)


class StageStatus(str, enum.Enum):
    """Closed set of per-stage statuses. Adding a status requires a
    schema_version bump."""

    PENDING = "pending"
    STARTED = "started"
    OK = "ok"
    FAILED = "failed"
    TIMEOUT = "timeout"


class CellVerdict(str, enum.Enum):
    """Closed set of per-cell verdicts. Adding a verdict requires a
    schema_version bump."""

    PASS = "PASS"
    OOM = "OOM"
    TIMEOUT = "TIMEOUT"
    CUDA_ERROR = "CUDA_ERROR"
    DATA_ERROR = "DATA_ERROR"
    OTHER_ERROR = "OTHER_ERROR"


class Decision(str, enum.Enum):
    """Closed set of final-probe decisions. Adding a decision requires a
    schema_version bump."""

    PASS_FORMAL_RUNNER_GATE = "PASS_FORMAL_RUNNER_GATE"
    BLOCKED_CUDA_RUNTIME = "BLOCKED_CUDA_RUNTIME"
    BLOCKED_DATALOADER = "BLOCKED_DATALOADER"
    BLOCKED_MEMORY = "BLOCKED_MEMORY"
    BLOCKED_DATA = "BLOCKED_DATA"


_VALID_CELL_FIELDS = {"amp", "patient_batch", "num_workers", "pin_memory"}
_VALID_CELL_BATCH = {1, 2, 4, 8}


def new_stage_record(stage: str) -> dict[str, Any]:
    """Return a fresh per-stage record for ``stage``.

    Raises ``ValueError`` if ``stage`` is not one of ``STAGE_NAMES``.
    """
    if stage not in STAGE_NAMES:
        raise ValueError(f"unknown stage {stage!r}; expected one of {STAGE_NAMES}")
    return {
        "stage": stage,
        "status": StageStatus.PENDING.value,
        "started_at": None,
        "finished_at": None,
        "duration_ms": None,
        "exception_type": None,
        "exception_message": None,
    }


def validate_matrix_cell(cell: dict[str, Any]) -> None:
    """Reject any matrix cell whose field set or values deviate from the
    frozen contract. Adding a new field requires a schema_version bump."""
    if not isinstance(cell, dict):
        raise ValueError(f"matrix cell must be a dict, got {type(cell).__name__}")
    keys = set(cell)
    if keys != _VALID_CELL_FIELDS:
        raise ValueError(
            f"matrix cell keys must be exactly {sorted(_VALID_CELL_FIELDS)}, got {sorted(keys)}"
        )
    if not isinstance(cell["amp"], bool):
        raise ValueError(f"amp must be bool, got {type(cell['amp']).__name__}")
    if cell["patient_batch"] not in _VALID_CELL_BATCH:
        raise ValueError(
            f"patient_batch must be one of {sorted(_VALID_CELL_BATCH)}, got {cell['patient_batch']!r}"
        )
    if cell["num_workers"] not in (0, 2):
        raise ValueError(f"num_workers must be 0 or 2, got {cell['num_workers']!r}")
    if not isinstance(cell["pin_memory"], bool):
        raise ValueError(f"pin_memory must be bool, got {type(cell['pin_memory']).__name__}")


def decide(exception_text: str) -> str:
    """Classify a free-form exception text onto the closed verdict enum.

    The order of substrings below is load-bearing: the first match wins.
    This is the same "first-match" rule used by the test suite.

    The ``OTHER_ERROR`` fallback only fires when the input string *looks
    like* an exception message (contains one of ``Exception``, ``Error``,
    ``Traceback``). A bare prose string with no exception markers
    raises ``ValueError`` — callers must label unparseable inputs as
    OTHER_ERROR explicitly instead of relying on heuristic inference.
    """
    text = exception_text.lower()
    # OOM is checked first because CUDA error messages can mention "memory".
    # Match both natural-language ("out of memory") and CamelCase class
    # names ("torch.cuda.OutOfMemoryError" -> "outofmemoryerror").
    if "out of memory" in text or "outofmemory" in text:
        return CellVerdict.OOM.value
    if "cuda error" in text or "device-side assert" in text or "cudnn" in text:
        return CellVerdict.CUDA_ERROR.value
    if "timeout" in text or "timed out" in text:
        return CellVerdict.TIMEOUT.value
    if (
        "unidentifiedimageerror" in text
        or "cannot identify image" in text
        or "cannot open resource" in text
        or "patient_id" in text
        or "filenotfounderror" in text
    ):
        return CellVerdict.DATA_ERROR.value
    if "exception" in text or "error" in text or "traceback" in text:
        return CellVerdict.OTHER_ERROR.value
    raise ValueError(f"exception text does not match any verdict category: {exception_text!r}")


def finalize_decision(matrix: dict[str, Any], batch100: dict[str, Any]) -> str:
    """Map the matrix verdicts + 100-batch results onto a single Decision.

    Rules (frozen for P2-02A v1; changing any rule requires a
    schema_version bump):

      1. PASS_FORMAL_RUNNER_GATE iff every cell A-F is PASS *and* the
         100-batch gate passed for both E and F.
      2. If any cell's verdict is OOM (any of A-F), the blocker is MEMORY.
      3. If cell F's verdict is DATA_ERROR / OOM / OTHER_ERROR / TIMEOUT
         (i.e. the target DataLoader config fails), the blocker is
         DATALOADER. Cell E must also fail; otherwise the issue is
         upgrade-specific, not a real DataLoader block.
      4. If cell A is CUDA_ERROR (CUDA context fails even without AMP
         and with batch=1), the blocker is CUDA_RUNTIME.
      5. If cell A is DATA_ERROR, the blocker is DATA.
      6. Any other failure mode (OTHER_ERROR in any cell leaving E and
         F passing) lands as BLOCKED_CUDA_RUNTIME conservatively.
    """
    labels = [label for label, _ in _matrix_iter()]
    has = lambda v: any(matrix.get(label, {}).get("verdict") == v for label in labels)

    # Rule 1: pass gate.
    all_pass = all(matrix.get(label, {}).get("verdict") == CellVerdict.PASS.value for label in labels)
    e_passed = bool(batch100.get("E", {}).get("passed"))
    f_passed = bool(batch100.get("F", {}).get("passed"))
    if all_pass and e_passed and f_passed:
        return Decision.PASS_FORMAL_RUNNER_GATE.value

    # Rule 2: any OOM anywhere memory-blocks.
    if has(CellVerdict.OOM.value):
        return Decision.BLOCKED_MEMORY.value

    # Rule 3: target DataLoader config fails.
    if matrix.get("F", {}).get("verdict") == CellVerdict.DATA_ERROR.value and not f_passed:
        return Decision.BLOCKED_DATALOADER.value
    if matrix.get("F", {}).get("verdict") == CellVerdict.OOM.value and not f_passed:
        return Decision.BLOCKED_DATALOADER.value

    # Rule 4: CUDA context itself fails.
    if matrix.get("A", {}).get("verdict") == CellVerdict.CUDA_ERROR.value:
        return Decision.BLOCKED_CUDA_RUNTIME.value

    # Rule 5: data layer fails on the most conservative cell.
    if matrix.get("A", {}).get("verdict") == CellVerdict.DATA_ERROR.value:
        return Decision.BLOCKED_DATA.value

    # Rule 6: conservative default.
    return Decision.BLOCKED_CUDA_RUNTIME.value


def _matrix_iter():
    # Imported lazily to avoid a circular import at module load time.
    from p1.stability.matrix import MATRIX_ROWS
    return MATRIX_ROWS
