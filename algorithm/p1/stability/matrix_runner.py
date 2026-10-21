"""P2-02A T3 matrix orchestration, classification, T4 gate, and report writing.

``classify`` consumes the frozen T2 ``_watchdog_summary.json`` and emits
the T3-local ``t4_gate``. ``run_matrix`` wraps ``watchdog_cli.main``
in-process; preflight failures short-circuit before any subprocess
runs.
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from p1.stability import watchdog_cli
from p1.stability.environment import T3EnvAdapter, capture_environment
from p1.stability.matrix import expand_matrix
from p1.stability.preflight import PreflightResult, run_preflight
from p1.stability.schema import CellVerdict

T4_AUTHORIZED = "T4_AUTHORIZED"
T4_BLOCKED = "T4_BLOCKED"
MISSING = "MISSING"
T3_REPORT_SCHEMA = "p2-02a-t3-v1"
_PASS = CellVerdict.PASS.value


@dataclass(frozen=True)
class ClassifyResult:
    matrix_verdicts: dict[str, str]
    t4_gate: str
    blocking_cells: list[str]
    diagnostic: str


@dataclass
class MatrixConfig:
    protocol_path: Path
    manifest_path: Path
    split_path: Path
    fold_path: Path
    image_root: Path
    out_dir: Path
    vram_floor_mb: int
    weights_id: str
    heartbeat_timeout: float
    process_timeout: float
    now: str
    git_commit: Optional[str] = None
    child: Optional[Path] = None


@dataclass
class MatrixReport:
    schema_version: str
    ok: bool
    exit_code: int
    t4_gate: str
    report_path: Path
    preflight: PreflightResult
    environment: dict


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
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def _preflight_dict(pf: PreflightResult) -> dict:
    return {"ok": pf.ok, "reason": pf.reason,
            "checks": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in pf.checks]}


def run_matrix(cfg: MatrixConfig, adapter: T3EnvAdapter) -> MatrixReport:
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    env = capture_environment(adapter, now=cfg.now, git_commit=cfg.git_commit)
    _write_json_atomic(cfg.out_dir / "environment.json", env)

    pf = run_preflight(
        protocol_path=cfg.protocol_path, manifest_path=cfg.manifest_path,
        split_path=cfg.split_path, fold_path=cfg.fold_path, image_root=cfg.image_root,
        out_dir=cfg.out_dir, vram_floor_mb=cfg.vram_floor_mb, weights_id=cfg.weights_id,
        adapter=adapter,
    )
    _write_json_atomic(cfg.out_dir / "preflight.json", _preflight_dict(pf))

    if not pf.ok:
        report_path = cfg.out_dir / "t3_matrix_report.json"
        _write_report(report_path, env, pf, matrix_verdicts={}, t4_gate=T4_BLOCKED,
                      blocking_cells=[], diagnostic=f"preflight failed: {pf.reason}")
        return MatrixReport(T3_REPORT_SCHEMA, False, 2, T4_BLOCKED, report_path, pf, env)

    # Delegate the full A-F serial loop to the FROZEN T2 watchdog (in-process).
    argv = [
        "--protocol", str(cfg.protocol_path), "--manifest", str(cfg.manifest_path),
        "--split-assignment", str(cfg.split_path), "--fold-assignment", str(cfg.fold_path),
        "--image-root", str(cfg.image_root), "--out-dir", str(cfg.out_dir),
        "--heartbeat-timeout", str(cfg.heartbeat_timeout),
        "--process-timeout", str(cfg.process_timeout),
    ]
    if cfg.child is not None:
        argv += ["--child", str(cfg.child)]
    watchdog_cli.main(argv)

    summary = json.loads((cfg.out_dir / "_watchdog_summary.json").read_text(encoding="utf-8"))
    cr = classify(summary)
    report_path = cfg.out_dir / "t3_matrix_report.json"
    _write_report(report_path, env, pf, matrix_verdicts=cr.matrix_verdicts, t4_gate=cr.t4_gate,
                  blocking_cells=cr.blocking_cells, diagnostic=cr.diagnostic)
    exit_code = 0 if cr.t4_gate == T4_AUTHORIZED else 1
    return MatrixReport(T3_REPORT_SCHEMA, cr.t4_gate == T4_AUTHORIZED, exit_code, cr.t4_gate,
                        report_path, pf, env)


def _write_report(path, env, pf, *, matrix_verdicts, t4_gate, blocking_cells, diagnostic) -> None:
    _write_json_atomic(path, {
        "schema_version": T3_REPORT_SCHEMA,
        "timestamp": env.get("timestamp"),
        "environment": env,
        "preflight": _preflight_dict(pf),
        "matrix_verdicts": matrix_verdicts,
        "t4_gate": t4_gate,
        "blocking_cells": blocking_cells,
        "diagnostic": diagnostic,
        "watchdog_summary_ref": "_watchdog_summary.json",
    })


__all__ = [
    "ClassifyResult",
    "MISSING",
    "MatrixConfig",
    "MatrixReport",
    "T3_REPORT_SCHEMA",
    "T4_AUTHORIZED",
    "T4_BLOCKED",
    "_write_json_atomic",
    "classify",
    "run_matrix",
]
