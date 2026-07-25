"""T0 contract tests for the P2-02A CUDA stability probe protocol + schema.

These tests prove the *schema* of the probe protocol and the result-report
schema. They do NOT execute any real CUDA. CI must run them as pure-Schema
tests; the real GPU probe runs only via the explicit CLI:

    python -m p1.stability.cli --protocol p1/protocol_p2_02a_v1.json ...

The probe protocol is *separate* from ``p1/protocol_e0_e3_v1.json`` (the
P2-01R training protocol). The P2-02A protocol pins the experiment under
test (E3 only), the 6-cell diagnostic matrix, and the result schema. It
does NOT tune the eventual epoch-training protocol — that is P2-02B's
job and any change to the training protocol must be a new schema_version.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict
from pathlib import Path
from typing import Mapping

import pytest

from p1.stability.protocol import (
    P202AProtocol,
    P202AProtocolError,
    default_p202a_protocol,
    dump_p202a_protocol,
    load_p202a_protocol,
)
from p1.stability.schema import (
    STAGE_NAMES,
    StageStatus,
    CellVerdict,
    decide,
    finalize_decision,
    new_stage_record,
    validate_matrix_cell,
)
from p1.stability.matrix import (
    MATRIX_ROWS,
    expand_matrix,
    matrix_to_dict,
)


# ---------------------------------------------------------------------------
# Protocol (T0 frozen inputs)
# ---------------------------------------------------------------------------


def test_default_protocol_matches_frozen_p202a_values() -> None:
    p = default_p202a_protocol()
    assert p.schema_version == "p2-02a-v1"
    # Experiment under test is pinned to E3 (bilateral) only.
    assert p.experiment == "E3"
    assert p.backbone == "efficientnet_b4"
    assert p.weights == "EfficientNet_B4_Weights.IMAGENET1K_V1"
    assert p.fold == 0
    assert p.seed == 42
    # Stability gate is "100 consecutive real batches, no hang, no OOM, no NaN".
    assert p.target_success_batches == 100
    # PCM/P2-01 economic defaults inherited from E0E3-v1, restated for clarity.
    assert p.image_size == 380
    assert p.num_classes == 8
    # The probe itself does NOT pin patient_batch / workers / pin_memory / amp;
    # those are matrix-cell fields. Enforce that they are NOT on the dataclass.
    assert not hasattr(p, "patient_batch")
    assert not hasattr(p, "num_workers")
    assert not hasattr(p, "pin_memory")
    assert not hasattr(p, "amp")


def test_p202a_protocol_is_frozen_dataclass() -> None:
    p = default_p202a_protocol()
    with pytest.raises((AttributeError, Exception)):
        p.fold = 1  # type: ignore[misc]


def test_p202a_protocol_round_trip(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    out = tmp_path / "p2_02a.json"
    dump_p202a_protocol(p, out)
    loaded = load_p202a_protocol(out)
    assert loaded == p


def test_p202a_protocol_pinned_json_file() -> None:
    """The frozen protocol JSON on disk must match the dataclass defaults."""
    path = Path(__file__).resolve().parents[2] / "p1" / "protocol_p2_02a_v1.json"
    assert path.is_file(), f"missing frozen protocol: {path}"
    on_disk = load_p202a_protocol(path)
    assert on_disk == default_p202a_protocol()


def test_load_rejects_wrong_experiment(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    payload = _to_jsonable(p); payload["experiment"] = "E0"
    bad = tmp_path / "bad.json"; bad.write_text(json.dumps(payload))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def test_load_rejects_wrong_backbone(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    payload = _to_jsonable(p); payload["backbone"] = "efficientnet_b3"
    bad = tmp_path / "bad.json"; bad.write_text(json.dumps(payload))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def test_load_rejects_wrong_weights(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    payload = _to_jsonable(p); payload["weights"] = "DEFAULT"
    bad = tmp_path / "bad.json"; bad.write_text(json.dumps(payload))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def test_load_rejects_non_zero_fold(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    payload = _to_jsonable(p); payload["fold"] = 1
    bad = tmp_path / "bad.json"; bad.write_text(json.dumps(payload))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def test_load_rejects_wrong_target_batches(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    payload = _to_jsonable(p); payload["target_success_batches"] = 50
    bad = tmp_path / "bad.json"; bad.write_text(json.dumps(payload))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def test_load_rejects_wrong_schema_version(tmp_path: Path) -> None:
    p = default_p202a_protocol()
    payload = _to_jsonable(p); payload["schema_version"] = "p2-02a-v0"
    bad = tmp_path / "bad.json"; bad.write_text(json.dumps(payload))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def test_load_rejects_missing_required_fields(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"backbone": "efficientnet_b4"}))
    with pytest.raises(P202AProtocolError):
        load_p202a_protocol(bad)


def _to_jsonable(p: P202AProtocol) -> dict:
    return {k: v for k, v in asdict(p).items()}


# ---------------------------------------------------------------------------
# Stage schema (T0 stage-name list + status enum)
# ---------------------------------------------------------------------------


def test_stage_names_are_frozen_and_ordered() -> None:
    assert STAGE_NAMES == (
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


def test_stage_status_enum_is_closed() -> None:
    # Status enum is closed; adding a new status requires a schema_version bump.
    assert {s.value for s in StageStatus} == {"pending", "started", "ok", "failed", "timeout"}


def test_new_stage_record_starts_pending() -> None:
    rec = new_stage_record("forward")
    assert rec["stage"] == "forward"
    assert rec["status"] == "pending"
    assert rec["started_at"] is None
    assert rec["finished_at"] is None
    assert rec["duration_ms"] is None
    assert rec["exception_type"] is None
    assert rec["exception_message"] is None


def test_new_stage_record_rejects_unknown_stage() -> None:
    with pytest.raises(ValueError):
        new_stage_record("not_a_real_stage")


# ---------------------------------------------------------------------------
# Cell/verdict schema
# ---------------------------------------------------------------------------


def test_cell_verdict_enum_is_closed() -> None:
    assert {v.value for v in CellVerdict} == {"PASS", "OOM", "TIMEOUT", "CUDA_ERROR", "DATA_ERROR", "OTHER_ERROR"}


def test_validate_matrix_cell_accepts_frozen_config() -> None:
    cell = {"amp": True, "patient_batch": 8, "num_workers": 0, "pin_memory": False}
    validate_matrix_cell(cell)  # must not raise


def test_validate_matrix_cell_rejects_extra_field() -> None:
    cell = {"amp": True, "patient_batch": 8, "num_workers": 0, "pin_memory": False, "extra": 1}
    with pytest.raises(ValueError):
        validate_matrix_cell(cell)


def test_validate_matrix_cell_rejects_bad_batch() -> None:
    cell = {"amp": True, "patient_batch": 3, "num_workers": 0, "pin_memory": False}
    with pytest.raises(ValueError):
        validate_matrix_cell(cell)


# ---------------------------------------------------------------------------
# 6-cell matrix (T0 frozen matrix)
# ---------------------------------------------------------------------------


def test_matrix_rows_are_frozen() -> None:
    assert MATRIX_ROWS == (
        ("A", {"amp": False, "patient_batch": 1, "num_workers": 0, "pin_memory": False}),
        ("B", {"amp": True, "patient_batch": 1, "num_workers": 0, "pin_memory": False}),
        ("C", {"amp": True, "patient_batch": 2, "num_workers": 0, "pin_memory": False}),
        ("D", {"amp": True, "patient_batch": 4, "num_workers": 0, "pin_memory": False}),
        ("E", {"amp": True, "patient_batch": 8, "num_workers": 0, "pin_memory": False}),
        ("F", {"amp": True, "patient_batch": 8, "num_workers": 2, "pin_memory": True}),
    )


def test_expand_matrix_returns_strict_serial_order() -> None:
    rows = expand_matrix()
    assert [r.label for r in rows] == ["A", "B", "C", "D", "E", "F"]
    # Patients must be batched in this frozen order; no shuffle. E must be
    # patient_batch=8, num_workers=0 (the conservative pre-F gate).
    cell_E = next(r for r in rows if r.label == "E")
    assert cell_E.config == {
        "amp": True, "patient_batch": 8, "num_workers": 0, "pin_memory": False,
    }


def test_matrix_to_dict_round_trip() -> None:
    rows = expand_matrix()
    payload = matrix_to_dict(rows)
    assert payload == [
        {"label": "A", "config": dict(MATRIX_ROWS[0][1])},
        {"label": "B", "config": dict(MATRIX_ROWS[1][1])},
        {"label": "C", "config": dict(MATRIX_ROWS[2][1])},
        {"label": "D", "config": dict(MATRIX_ROWS[3][1])},
        {"label": "E", "config": dict(MATRIX_ROWS[4][1])},
        {"label": "F", "config": dict(MATRIX_ROWS[5][1])},
    ]


# ---------------------------------------------------------------------------
# Decision enum (T0 single-enum outcome)
# ---------------------------------------------------------------------------


def test_decision_enum_is_closed() -> None:
    from p1.stability.schema import Decision
    assert {d.value for d in Decision} == {
        "PASS_FORMAL_RUNNER_GATE",
        "BLOCKED_CUDA_RUNTIME",
        "BLOCKED_DATALOADER",
        "BLOCKED_MEMORY",
        "BLOCKED_DATA",
    }


def test_finalize_decision_passes_when_all_required_cells_pass() -> None:
    """PASS_FORMAL_RUNNER_GATE requires cell E and cell F both PASS the 100-batch gate."""
    matrix = {
        "A": {"verdict": "PASS", "stages": []},
        "B": {"verdict": "PASS", "stages": []},
        "C": {"verdict": "PASS", "stages": []},
        "D": {"verdict": "PASS", "stages": []},
        "E": {"verdict": "PASS", "stages": []},
        "F": {"verdict": "PASS", "stages": []},
    }
    batch100 = {"E": {"passed": True}, "F": {"passed": True}}
    assert finalize_decision(matrix, batch100) == "PASS_FORMAL_RUNNER_GATE"


def test_finalize_decision_blocks_on_oom_in_cell_e() -> None:
    matrix = {label: {"verdict": "PASS", "stages": []} for label, _ in MATRIX_ROWS}
    matrix["E"]["verdict"] = "OOM"
    batch100 = {"E": {"passed": False}, "F": {"passed": False}}
    assert finalize_decision(matrix, batch100) == "BLOCKED_MEMORY"


def test_finalize_decision_blocks_on_dataloader_failure() -> None:
    matrix = {label: {"verdict": "PASS", "stages": []} for label, _ in MATRIX_ROWS}
    matrix["F"]["verdict"] = "DATA_ERROR"
    batch100 = {"E": {"passed": True}, "F": {"passed": False}}
    assert finalize_decision(matrix, batch100) == "BLOCKED_DATALOADER"


def test_finalize_decision_blocks_on_cuda_error() -> None:
    matrix = {label: {"verdict": "PASS", "stages": []} for label, _ in MATRIX_ROWS}
    matrix["A"]["verdict"] = "CUDA_ERROR"
    batch100 = {"E": {"passed": False}, "F": {"passed": False}}
    assert finalize_decision(matrix, batch100) == "BLOCKED_CUDA_RUNTIME"


def test_finalize_decision_blocks_on_data_error() -> None:
    matrix = {label: {"verdict": "PASS", "stages": []} for label, _ in MATRIX_ROWS}
    matrix["A"]["verdict"] = "DATA_ERROR"
    batch100 = {"E": {"passed": False}, "F": {"passed": False}}
    assert finalize_decision(matrix, batch100) == "BLOCKED_DATA"


def test_decide_classifies_known_exceptions() -> None:
    """The decide() helper maps free-form exception text onto the closed enum."""
    cases = {
        "CUDA out of memory": "OOM",
        "torch.cuda.OutOfMemoryError": "OOM",
        "RuntimeError: CUDA error: device-side assert triggered": "CUDA_ERROR",
        "subprocess.TimeoutExpired": "TIMEOUT",
        "PIL.UnidentifiedImageError: cannot identify image file": "DATA_ERROR",
        "OSError: cannot open resource": "DATA_ERROR",
        "ValueError: patient_id not found": "DATA_ERROR",
        "Exception: something else": "OTHER_ERROR",
    }
    for msg, expected in cases.items():
        assert decide(msg) == expected, f"failed classifying {msg!r}"


def test_decide_rejects_unknown_message() -> None:
    with pytest.raises(ValueError):
        decide("this message matches none of the categories")
