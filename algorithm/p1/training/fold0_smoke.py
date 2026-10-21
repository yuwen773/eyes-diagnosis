"""P2-02C entry point: real-GPU fold-0 acceptance smoke for P2-02B.

Orchestrates: preflight -> subprocess(cli_formal) -> reload-verify -> report.
Exit codes: 0=PASS, 1=BLOCKED | TIMEOUT, 2=FAILED_PREFLIGHT.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Optional, Sequence

from p1.stability.cli import build_real_torch_adapter  # noqa: F401  (monkey-patch seam)
from p1.stability.environment import capture_environment  # noqa: F401  (monkey-patch seam)
from p1.stability.preflight import run_preflight  # noqa: F401  (monkey-patch seam)
from p1.stability.protocol import load_p202a_protocol  # noqa: F401  (monkey-patch seam)
from p1.training._atomic_io import atomic_write_text
from p1.training.reload_verify import ReloadError, verify as reload_verify
from p1.training.training_watchdog import (
    RealTerminator, WatchConfig, WatchResult, run_subprocess,
)


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="fold0_smoke",
        description="P2-02C real-GPU fold-0 acceptance smoke for P2-02B.",
    )
    p.add_argument("--protocol", type=Path,
                   default=Path("algorithm") / "p1" / "protocol_p2_02a_v1.json")
    p.add_argument("--manifest", type=Path,
                   default=Path("artifacts") / "p1_v1" / "patient_manifest_v1.parquet")
    p.add_argument("--split-assignment", type=Path,
                   default=Path("artifacts") / "p1_v1" / "split_assignment_v1.csv")
    p.add_argument("--fold-assignment", type=Path,
                   default=Path("artifacts") / "p1_v1" / "fold_assignment_v1.csv")
    p.add_argument("--image-root", type=Path, required=True)
    p.add_argument("--out-dir", type=Path,
                   default=Path("artifacts") / "p2_02c" / "fold0")
    p.add_argument("--max-epochs", type=int, default=1)
    p.add_argument("--patience", type=int, default=1)
    p.add_argument("--process-timeout", type=float, default=300.0)
    p.add_argument("--heartbeat-timeout", type=float, default=90.0)
    p.add_argument("--poll-interval", type=float, default=0.1)
    # Mirrors matrix_cli defaults: the same hard gate the T3 matrix applies.
    p.add_argument("--vram-floor-mb", type=int, default=6000)
    p.add_argument("--weights-id", type=str,
                   default="EfficientNet_B4_Weights.IMAGENET1K_V1")
    return p


def _atomic_write_json(path: Path, payload: dict) -> None:
    payload_str = json.dumps(payload, indent=2, default=str)
    def _write(tmp: Path) -> None:
        tmp.write_text(payload_str, encoding="utf-8")
    atomic_write_text(path, _write)


def _expected_artifacts() -> set[str]:
    return {
        "protocol.json", "environment.json", "training_log.jsonl",
        "best_checkpoint.pth", "best_checkpoint.sha256",
        "validation_predictions.csv", "oof.csv", "metrics.json",
        "fold_receipt.json",
    }


def _preflight_dict(pf) -> dict:
    return {
        "ok": pf.ok,
        "reason": pf.reason,
        "checks": [
            {"name": c.name, "ok": c.ok, "detail": c.detail}
            for c in getattr(pf, "checks", [])
        ],
    }


def _git_commit() -> Optional[str]:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], check=False,
                             capture_output=True, text=True)
        return out.stdout.strip() or None
    except OSError:
        return None


def main(argv: Optional[Sequence[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO)
    args = _build_argparser().parse_args(list(argv) if argv is not None else None)
    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)

    # Protocol errors are preflight-style failures: report and exit 2 rather
    # than letting the exception escape before any artifact is written.
    try:
        load_p202a_protocol(args.protocol)
    except Exception as e:
        print(f"protocol error: {e}", file=sys.stderr)
        _atomic_write_json(out_dir / "fold0_smoke_report.json", {
            "schema_version": "p2-02c-v1",
            "verdict": "BLOCKED",
            "error_class": "preflight",
            "preflight": {"ok": False, "reason": f"protocol: {e}", "checks": []},
        })
        return 2

    adapter = build_real_torch_adapter()

    # Spec §5: on preflight failure write preflight.json + environment.json
    # alongside the report, so a blocked run still leaves reproducible evidence.
    now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _atomic_write_json(out_dir / "environment.json",
                       capture_environment(adapter, now=now, git_commit=_git_commit()))

    pf = run_preflight(
        protocol_path=args.protocol,
        manifest_path=args.manifest,
        split_path=args.split_assignment,
        fold_path=args.fold_assignment,
        image_root=args.image_root,
        out_dir=out_dir,
        vram_floor_mb=args.vram_floor_mb,
        weights_id=args.weights_id,
        adapter=adapter,
    )
    _atomic_write_json(out_dir / "preflight.json", _preflight_dict(pf))

    if not pf.ok:
        _atomic_write_json(out_dir / "fold0_smoke_report.json", {
            "schema_version": "p2-02c-v1",
            "verdict": "BLOCKED",
            "error_class": "preflight",
            "preflight": _preflight_dict(pf),
        })
        return 2

    cmd = [
        sys.executable, "-u", "-m", "p1.training.cli_formal",
        "--fold", "0",
        "--max-epochs", str(args.max_epochs),
        "--patience", str(args.patience),
        "--protocol", str(args.protocol),
        "--manifest", str(args.manifest),
        "--split-assignment", str(args.split_assignment),
        "--fold-assignment", str(args.fold_assignment),
        "--image-root", str(args.image_root),
        "--out-dir", str(out_dir),
        "--emit-heartbeat",
    ]

    config = WatchConfig(
        process_timeout_seconds=args.process_timeout,
        heartbeat_timeout_seconds=args.heartbeat_timeout,
        poll_interval_seconds=args.poll_interval,
    )
    result: WatchResult = run_subprocess(cmd, out_dir, cell_label="fold0",
                                         config=config,
                                         terminator=RealTerminator())

    report: dict = {
        "schema_version": "p2-02c-v1",
        "verdict": result.verdict,
        "error_class": result.error_class,
        "exit_code": result.exit_code,
        "wall_clock_seconds": result.elapsed_seconds,
        "last_heartbeat_epoch": result.last_heartbeat_epoch,
        "last_checkpoint": result.last_checkpoint,
        "killed": result.killed,
        "timed_out": result.timed_out,
        "stderr_tail": result.stderr_tail,
    }

    if result.verdict == "PASS":
        try:
            r = reload_verify(out_dir)
            report["reload_verification"] = {
                "ok": r.ok, "sha256_match": r.sha256_match,
                "state_dict_identical": r.state_dict_identical,
                "sha256": r.sha256, "num_params": r.num_params,
                "config_hash": r.config_hash,
            }
        except ReloadError as e:
            report["verdict"] = "BLOCKED"
            report["error_class"] = "reload_mismatch"
            report["reload_error"] = str(e)

    fold0 = out_dir / "fold_0"
    present = {p.name for p in fold0.iterdir()} if fold0.exists() else set()
    report["artifact_tree_complete"] = _expected_artifacts().issubset(present)
    report["artifacts_present"] = sorted(present)
    if (fold0 / "fold_receipt.json").exists():
        try:
            report["fold_receipt_status"] = json.loads(
                (fold0 / "fold_receipt.json").read_text()).get("status")
        except json.JSONDecodeError:
            report["fold_receipt_status"] = None

    _atomic_write_json(out_dir / "fold0_smoke_report.json", report)
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))


__all__ = ["main", "_build_argparser"]
