"""P2-02A CUDA stability probe — protocol, schema, and matrix definitions.

This package is the *T0 contract layer* for the P2-02A stability probe.
It does NOT execute any real CUDA. Real GPU runs go through
``p1.stability.cli`` and use the explicit JSON protocol on disk.

The matrices, stage names, status enums, and decision enum defined here
are frozen for the lifetime of P2-02A. Changing any of them without
bumping the ``schema_version`` is a protocol violation.
"""

from __future__ import annotations

from p1.stability.protocol import (
    P202AProtocol,
    P202AProtocolError,
    default_p202a_protocol,
    dump_p202a_protocol,
    load_p202a_protocol,
)
from p1.stability.schema import (
    Decision,
    CellVerdict,
    StageStatus,
    decide,
    finalize_decision,
    new_stage_record,
    validate_matrix_cell,
)
from p1.stability.matrix import (
    Cell,
    expand_matrix,
    matrix_to_dict,
)
from p1.stability.stages import (
    InternalStageState,
    ProbeContext,
    ProbeRunResult,
    ProbeRunner,
    StageAlreadyExecutedError,
    StageExecutionError,
    StageSpec,
    UnknownStageError,
)

__all__ = [
    "P202AProtocol",
    "P202AProtocolError",
    "default_p202a_protocol",
    "dump_p202a_protocol",
    "load_p202a_protocol",
    "Decision",
    "CellVerdict",
    "StageStatus",
    "decide",
    "finalize_decision",
    "new_stage_record",
    "validate_matrix_cell",
    "Cell",
    "expand_matrix",
    "matrix_to_dict",
    "InternalStageState",
    "ProbeContext",
    "ProbeRunResult",
    "ProbeRunner",
    "StageAlreadyExecutedError",
    "StageExecutionError",
    "StageSpec",
    "UnknownStageError",
]
