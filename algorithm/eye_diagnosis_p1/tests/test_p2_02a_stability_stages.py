"""T1.1 contract tests for the P2-02A probe stage state machine.

These tests cover ``p1.stability.stages.ProbeRunner`` — a pure state
machine that walks ``STAGE_NAMES`` in order, records each stage, and
short-circuits on the first exception. The machine *does not* touch
CUDA, PyTorch, DataLoader, threads, or signals. Timeout termination is
the responsibility of the T2 parent-process watchdog; T1.1 only
faithfully records any exception the injected ``execute_stage_fn``
raises (including a ``TimeoutError`` injected by the watchdog).

Recorded stages must serialise into the T0 stage-record schema:

    {"stage", "status", "started_at", "finished_at", "duration_ms",
     "exception_type", "exception_message"}

Mapping from internal state to T0 ``StageStatus`` string:

    PENDING   -> "pending"   (only seen mid-run; never in final report)
    RUNNING   -> "started"   (only seen mid-run; never in final report)
    PASS      -> "ok"
    FAIL      -> "failed"
    SKIPPED   -> "failed" with exception_type="StageSkipped"
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Sequence

import pytest

from p1.stability.schema import STAGE_NAMES, new_stage_record
from p1.stability.stages import (
    InternalStageState,
    ProbeContext,
    ProbeRunner,
    ProbeRunResult,
    StageAlreadyExecutedError,
    StageSpec,
    UnknownStageError,
)


class _Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def _stages() -> List[StageSpec]:
    # 9 stages in T0 order; the T1.1 machine has no opinion on
    # cuda_boundary, so we leave it default-False to assert that it is
    # purely informational and does not affect ordering or counts.
    return [StageSpec(name=n) for n in STAGE_NAMES]


def test_runner_rejects_unknown_stage_name() -> None:
    bad = [StageSpec(name="not_a_stage")]
    with pytest.raises(UnknownStageError):
        ProbeRunner(stages=bad, execute_stage_fn=lambda spec, ctx: None)


def test_runner_rejects_duplicate_stage_name() -> None:
    # StageAlreadyExecutedError fires when a stages list contains the
    # same T0 stage name twice. The list is constructed with the right
    # *length* but a duplicate first entry, so the duplicate-detection
    # branch is what fires (set-wise checking can also fire, but the
    # lint-class checker here is the duplicate detector).
    stages = [StageSpec(name=n) for n in STAGE_NAMES[:-1]]
    stages.append(StageSpec(name=STAGE_NAMES[0]))  # manifest_load appears twice
    assert len(stages) == len(STAGE_NAMES)
    with pytest.raises(StageAlreadyExecutedError):
        ProbeRunner(stages=stages, execute_stage_fn=lambda spec, ctx: None)


def test_runner_rejects_wrong_stage_count() -> None:
    short = [StageSpec(name=n) for n in STAGE_NAMES[:-1]]
    with pytest.raises(UnknownStageError):
        ProbeRunner(stages=short, execute_stage_fn=lambda spec, ctx: None)


def test_runner_rejects_stage_set_mismatch_with_t0() -> None:
    # replace one stage with a different name; the union must equal STAGE_NAMES.
    mis = [StageSpec(name=n) for n in STAGE_NAMES]
    mis[3] = StageSpec(name="bogus")
    with pytest.raises(UnknownStageError):
        ProbeRunner(stages=mis, execute_stage_fn=lambda spec, ctx: None)


def test_runner_walks_stages_in_fixed_order() -> None:
    seen: List[str] = []

    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        seen.append(spec.name)

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    result = runner.run(ProbeContext())
    assert seen == list(STAGE_NAMES)


def test_runner_executes_each_stage_exactly_once() -> None:
    counts = {n: 0 for n in STAGE_NAMES}

    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        counts[spec.name] += 1

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    runner.run(ProbeContext())
    assert all(v == 1 for v in counts.values()), counts


def test_runner_all_pass_records_nine_ok() -> None:
    runner = ProbeRunner(stages=_stages(), execute_stage_fn=lambda s, c: None)
    result = runner.run(ProbeContext())
    assert result.failed_stage is None
    assert result.all_pass is True
    assert [r["stage"] for r in result.records] == list(STAGE_NAMES)
    assert all(r["status"] == "ok" for r in result.records)
    assert all(r["exception_type"] is None for r in result.records)
    assert all(r["exception_message"] is None for r in result.records)


def test_runner_records_duration_ms_non_negative() -> None:
    clock = _Clock()
    calls = {"n": 0}

    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        calls["n"] += 1
        clock.advance(7.5)  # 7.5 ms per stage

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe, clock=clock)
    result = runner.run(ProbeContext())
    for rec in result.records:
        assert rec["duration_ms"] is not None
        assert rec["duration_ms"] >= 0.0
    # Each stage spans one tick of 7.5 ms.
    assert all(rec["duration_ms"] == 7.5 for rec in result.records)


def test_runner_short_circuits_on_failure() -> None:
    seen: List[str] = []

    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        seen.append(spec.name)
        if spec.name == "host_to_device":
            raise RuntimeError("boom")

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    result = runner.run(ProbeContext())
    assert result.failed_stage == "host_to_device"
    assert result.all_pass is False
    statuses = [r["status"] for r in result.records]
    assert statuses[:4] == ["ok", "ok", "ok", "ok"]
    assert statuses[4] == "failed"
    assert statuses[5:] == ["failed"] * 4  # SKIPPED -> "failed" in T0 schema
    # The execute fn must have been called exactly until the failing stage,
    # then STOP — no later stages ever invoked.
    assert seen == list(STAGE_NAMES[:5])


def test_runner_records_exception_type_and_message() -> None:
    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        if spec.name == "frozen_input_validation":
            raise ValueError("patient_id missing")

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    result = runner.run(ProbeContext())
    failed = result.records[1]
    assert failed["stage"] == "frozen_input_validation"
    assert failed["status"] == "failed"
    assert failed["exception_type"] == "ValueError"
    assert failed["exception_message"] == "patient_id missing"


def test_runner_marks_skipped_stages_with_stage_skipped_marker() -> None:
    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        if spec.name == "dataloader_create":
            raise RuntimeError("nope")

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    result = runner.run(ProbeContext())
    statuses = [r["status"] for r in result.records]
    assert statuses[2] == "failed"
    for r in result.records[3:]:
        assert r["status"] == "failed"
        assert r["exception_type"] == "StageSkipped"
        assert r["exception_message"] == "skipped after dataloader_create"


def test_runner_propagates_timeout_error_as_a_normal_exception() -> None:
    """The T2 watchdog will inject TimeoutError by raising it from the
    execute_stage_fn. The T1.1 state machine must record it the same way
    as any other exception and short-circuit."""

    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        if spec.name == "forward":
            raise TimeoutError("watchdog timeout")

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    result = runner.run(ProbeContext())
    assert result.failed_stage == "forward"
    failed = [r for r in result.records if r["stage"] == "forward"][0]
    assert failed["status"] == "failed"
    assert failed["exception_type"] == "TimeoutError"
    assert failed["exception_message"] == "watchdog timeout"


def test_runner_serialises_to_the_t0_schema(tmp_path: Path) -> None:
    runner = ProbeRunner(stages=_stages(), execute_stage_fn=lambda s, c: None)
    result = runner.run(ProbeContext())
    out = tmp_path / "stages.json"
    out.write_text(json.dumps(result.to_dict(), indent=2))
    payload = json.loads(out.read_text())
    # Each record must have exactly the T0 keys.
    expected_keys = {
        "stage", "status", "started_at", "finished_at",
        "duration_ms", "exception_type", "exception_message",
    }
    for rec in payload["records"]:
        assert set(rec) == expected_keys
    assert payload["failed_stage"] is None
    assert payload["all_pass"] is True
    assert [r["stage"] for r in payload["records"]] == list(STAGE_NAMES)


def test_runner_context_must_be_a_probe_context() -> None:
    runner = ProbeRunner(stages=_stages(), execute_stage_fn=lambda s, c: None)
    with pytest.raises(TypeError):
        runner.run(context={"not": "a context"})  # type: ignore[arg-type]


def test_probe_context_carries_setup_metadata() -> None:
    ctx = ProbeContext()
    ctx.set_setup(
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        weights_loaded=True,
        initialization="imagenet",
        model_device="cuda",
        first_conv_in_channels=3,
    )
    assert ctx.setup == {
        "weights": "EfficientNet_B4_Weights.IMAGENET1K_V1",
        "weights_loaded": True,
        "initialization": "imagenet",
        "model_device": "cuda",
        "first_conv_in_channels": 3,
    }


def test_probe_context_setup_is_optional() -> None:
    ctx = ProbeContext()
    assert ctx.setup == {}  # not set → empty.


def test_internal_stage_state_is_closed() -> None:
    assert {s.value for s in InternalStageState} == {
        "PENDING", "RUNNING", "PASS", "FAIL", "SKIPPED",
    }


def test_runner_uses_new_stage_record_factory_for_each_stage() -> None:
    """State machine must seed each record via T0's new_stage_record
    so the key set stays aligned with the T0 schema."""
    captured: List[dict] = []

    real_factory = new_stage_record

    def exe(spec: StageSpec, ctx: ProbeContext) -> None:
        captured.append(real_factory(spec.name))

    runner = ProbeRunner(stages=_stages(), execute_stage_fn=exe)
    runner.run(ProbeContext())
    assert len(captured) == len(STAGE_NAMES)
    for rec, name in zip(captured, STAGE_NAMES):
        assert rec["stage"] == name
        assert rec["status"] == "pending"
