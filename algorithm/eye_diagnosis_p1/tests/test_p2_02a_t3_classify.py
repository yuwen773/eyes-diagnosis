"""P2-02A T3 classification / T4-gate unit tests.

Drives ``classify`` with table-driven summaries that mirror what the
frozen T2 watchdog writes into ``_watchdog_summary.json``. Verifies:
  - T4_AUTHORIZED iff cells E and F are both PASS.
  - Missing cells are reported as MISSING and treated as non-PASS.
  - The diagnostic hint borrows the intent of ``finalize_decision``
    (CUDA_ERROR → CUDA runtime, OOM → memory) WITHOUT calling it
    (batch100 is absent at T3; calling it would mislabel all-PASS as
    BLOCKED).
  - The atomic report write never leaves a partial ``.tmp`` behind.
"""
from __future__ import annotations
import json
from pathlib import Path
from p1.stability.matrix_runner import classify, _write_json_atomic, T4_AUTHORIZED, T4_BLOCKED


def _summary(**verdicts) -> dict:
    return {label: {"verdict": v} for label, v in verdicts.items()}


def test_classify_all_pass_authorizes_t4():
    s = _summary(A="PASS", B="PASS", C="PASS", D="PASS", E="PASS", F="PASS")
    r = classify(s)
    assert r.matrix_verdicts["E"] == "PASS" and r.matrix_verdicts["F"] == "PASS"
    assert r.t4_gate == T4_AUTHORIZED
    assert r.blocking_cells == []
    assert "T4 authorized" in r.diagnostic


def test_classify_blocks_when_f_not_pass():
    s = _summary(A="PASS", B="PASS", C="PASS", D="PASS", E="PASS", F="DATA_ERROR")
    r = classify(s)
    assert r.t4_gate == T4_BLOCKED
    assert r.blocking_cells == ["F"]
    assert "DataLoader" in r.diagnostic


def test_classify_blocks_when_e_not_pass():
    s = _summary(A="PASS", B="PASS", C="PASS", D="PASS", E="OOM", F="PASS")
    r = classify(s)
    assert r.t4_gate == T4_BLOCKED
    assert r.blocking_cells == ["E"]
    assert "memory" in r.diagnostic.lower()


def test_classify_cell_a_cuda_error_hint():
    s = _summary(A="CUDA_ERROR", B="CUDA_ERROR", C="CUDA_ERROR", D="CUDA_ERROR", E="CUDA_ERROR", F="CUDA_ERROR")
    r = classify(s)
    assert r.t4_gate == T4_BLOCKED
    assert set(r.blocking_cells) == {"E", "F"}
    assert "CUDA runtime" in r.diagnostic


def test_classify_missing_cell_is_non_pass():
    s = _summary(A="PASS", B="PASS", C="PASS", D="PASS", E="PASS")  # F missing
    r = classify(s)
    assert r.matrix_verdicts["F"] == "MISSING"
    assert r.t4_gate == T4_BLOCKED
    assert r.blocking_cells == ["F"]


def test_write_json_atomic_no_partial_file(tmp_path):
    p = tmp_path / "t3_matrix_report.json"
    _write_json_atomic(p, {"a": 1})
    assert json.loads(p.read_text(encoding="utf-8")) == {"a": 1}
    assert not list(tmp_path.glob("*.tmp"))
