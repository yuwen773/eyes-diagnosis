"""T1.1 probe stage state machine.

This module is the *pure state-machine* layer of the P2-02A probe. It
walks the 9 ``STAGE_NAMES`` in fixed order, records each stage into the
T0 stage-record schema, and short-circuits on the first exception
returned by the injected ``execute_stage_fn``.

The state machine is intentionally decoupled from CUDA, PyTorch,
DataLoader, threads, signals, and subprocess management. The T2
parent-process watchdog (or a human operator) is responsible for
timing out a stuck run; the state machine only records the resulting
``TimeoutError`` faithfully.

Setup metadata (``model_build`` / ``model_to_cuda`` / weights /
device / first_conv_in_channels) is NOT a stage. It is carried on
``ProbeContext.setup`` and serialised separately by the report layer.
"""

from __future__ import annotations

import enum
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

from p1.stability.schema import STAGE_NAMES, new_stage_record


class InternalStageState(str, enum.Enum):
    """Closed set of internal runtime states for the state machine.

    The T0 ``StageStatus`` enum is the on-disk string; this enum is the
    in-memory state. The mapping from runtime to on-disk is:

        PENDING -> "pending"   (mid-run only; never appears in final report)
        RUNNING -> "started"   (mid-run only)
        PASS    -> "ok"
        FAIL    -> "failed"
        SKIPPED -> "failed" with exception_type="StageSkipped"
    """

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PASS = "PASS"
    FAIL = "FAIL"
    SKIPPED = "SKIPPED"


class StageExecutionError(RuntimeError):
    """Base class for state-machine errors that are not themselves a
    probe-stage failure (e.g. configuration mistakes caught before run)."""


class UnknownStageError(StageExecutionError):
    """Raised when the runner is built with stages that disagree with
    T0's ``STAGE_NAMES``."""


class StageAlreadyExecutedError(StageExecutionError):
    """Raised when the runner is built with a duplicate stage name."""


@dataclass(frozen=True)
class StageSpec:
    """A single stage definition. ``cuda_boundary`` is informational."""

    name: str
    cuda_boundary: bool = False


@dataclass
class ProbeContext:
    """Mutable context passed to each ``execute_stage_fn`` and the holder
    for ``setup`` metadata that is *not* a probe stage."""

    setup: dict[str, Any] = field(default_factory=dict)

    def set_setup(self, **kwargs: Any) -> None:
        """Set setup metadata (idempotent replacement)."""
        self.setup = dict(kwargs)


# A stage's per-stage record (T0 schema) before any mutation.
# Tuple-of-keys is fixed by T0's ``new_stage_record`` schema.
_Record = dict[str, Any]


@dataclass
class ProbeRunResult:
    """Outcome of a single ``ProbeRunner.run()`` invocation.

    ``records`` is always 9 entries long; every stage is present, even
    those skipped after a failure. ``failed_stage`` is the name of the
    first stage that raised, or None if all 9 passed.
    """

    records: list[_Record]
    failed_stage: str | None
    all_pass: bool

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a JSON-friendly dict matching the report schema."""
        return {
            "records": list(self.records),
            "failed_stage": self.failed_stage,
            "all_pass": self.all_pass,
        }


def _record_state(rec: _Record, state: InternalStageState) -> None:
    """Mutate ``rec`` in place to reflect the runtime state."""
    if state is InternalStageState.PENDING:
        rec["status"] = "pending"
    elif state is InternalStageState.RUNNING:
        rec["status"] = "started"
    elif state is InternalStageState.PASS:
        rec["status"] = "ok"
    elif state is InternalStageState.FAIL:
        rec["status"] = "failed"
    elif state is InternalStageState.SKIPPED:
        rec["status"] = "failed"
    else:  # pragma: no cover — defensive
        raise StageExecutionError(f"unknown internal state: {state!r}")


ExecuteStageFn = Callable[[StageSpec, ProbeContext], object]


def _perf_counter_ms() -> float:
    """Default clock: monotonic time in milliseconds."""
    return time.perf_counter() * 1000.0


class ProbeRunner:
    """Walk the 9 stages in fixed order; record each; short-circuit on failure."""

    def __init__(
        self,
        stages: Sequence[StageSpec],
        execute_stage_fn: ExecuteStageFn,
        clock: Callable[[], float] = _perf_counter_ms,
    ) -> None:
        self._validate_stages(stages)
        self._stages: list[StageSpec] = list(stages)
        self._exe: ExecuteStageFn = execute_stage_fn
        self._clock: Callable[[], float] = clock

    @staticmethod
    def _validate_stages(stages: Sequence[StageSpec]) -> None:
        names = [s.name for s in stages]
        if len(names) != len(STAGE_NAMES):
            raise UnknownStageError(
                f"runner must use exactly {len(STAGE_NAMES)} stages, got {len(names)}"
            )
        # Detect duplicates *before* checking set equality, because a
        # length=9 list with a duplicate will *also* fail the set check
        # (the duplicate means one of STAGE_NAMES is missing). The most
        # actionable diagnosis is "you repeated a stage", not "you are
        # missing one".
        if len(set(names)) != len(names):
            seen: dict[str, int] = {}
            for n in names:
                seen[n] = seen.get(n, 0) + 1
            dupes = {n for n, c in seen.items() if c > 1}
            raise StageAlreadyExecutedError(f"duplicate stages: {sorted(dupes)}")
        if set(names) != set(STAGE_NAMES):
            unknown = set(names) - set(STAGE_NAMES)
            missing = set(STAGE_NAMES) - set(names)
            raise UnknownStageError(
                f"stage set must equal STAGE_NAMES; unknown={sorted(unknown)} missing={sorted(missing)}"
            )

    def run(self, context: ProbeContext) -> ProbeRunResult:
        if not isinstance(context, ProbeContext):
            raise TypeError(
                f"context must be ProbeContext, got {type(context).__name__}"
            )
        records: list[_Record] = []
        failed_stage: str | None = None
        for spec in self._stages:
            rec = new_stage_record(spec.name)
            records.append(rec)
            success = self._execute_one(spec, rec, context)
            if not success:
                failed_stage = spec.name
                break
        if failed_stage is not None:
            self._skip_remaining(records, self._stages, failed_stage)
        return ProbeRunResult(
            records=records,
            failed_stage=failed_stage,
            all_pass=(failed_stage is None),
        )

    def _execute_one(self, spec: StageSpec, rec: _Record, ctx: ProbeContext) -> bool:
        """Run one stage and update ``rec``. Return True on PASS, False on FAIL."""
        _record_state(rec, InternalStageState.RUNNING)
        rec["started_at"] = self._clock()
        try:
            self._exe(spec, ctx)
        except BaseException as e:  # noqa: BLE001 — record and propagate-via-record
            end = self._clock()
            rec["finished_at"] = end
            start = rec["started_at"]
            rec["duration_ms"] = max(0.0, float(end - start))
            rec["exception_type"] = type(e).__name__
            rec["exception_message"] = str(e)
            _record_state(rec, InternalStageState.FAIL)
            return False
        end = self._clock()
        rec["finished_at"] = end
        start = rec["started_at"]
        rec["duration_ms"] = max(0.0, float(end - start))
        # On success, no exception fields.
        rec["exception_type"] = None
        rec["exception_message"] = None
        _record_state(rec, InternalStageState.PASS)
        return True

    def _skip_remaining(
        self,
        records: list[_Record],
        all_stages: Sequence[StageSpec],
        failed_after: str,
    ) -> None:
        """Mark every record after the failing stage as SKIPPED.

        Records for stages that never executed are first seeded via
        ``new_stage_record`` so the final report always contains 9
        entries (one per T0 stage) regardless of where the failure
        occurred.
        """
        executed_names = {r["stage"] for r in records}
        for spec in all_stages:
            if spec.name not in executed_names:
                records.append(new_stage_record(spec.name))
        # Mark post-failure records as SKIPPED with a synthetic
        # StageSkipped marker so the on-disk schema stays the same and
        # downstream code can tell "skipped" from "failed" without a new
        # status enum.
        idx = next(i for i, r in enumerate(records) if r["stage"] == failed_after)
        for r in records[idx + 1:]:
            _record_state(r, InternalStageState.SKIPPED)
            r["exception_type"] = "StageSkipped"
            r["exception_message"] = f"skipped after {failed_after}"
            r["started_at"] = None
            r["finished_at"] = None
            r["duration_ms"] = None
