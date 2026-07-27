"""P2-02A T3 CLI front end.

Thin argparse wrapper around ``run_matrix``. The CLI is the only
place that builds the real ``RealT3EnvAdapter`` (so the GPU probe
import stays on the GPU host); the unit tests use ``_config_from_args``
to avoid importing torch.

Exit codes:
  0 — T4_AUTHORIZED
  1 — matrix ran but T4_BLOCKED
  2 — preflight aborted (env / disk / frozen inputs)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import subprocess
import sys
from pathlib import Path
from typing import Optional

from p1.stability.matrix_runner import MatrixConfig, run_matrix


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="p1.stability.matrix_cli",
        description="T3: preflight + frozen-watchdog A-F matrix + T4 gate. Writes t3_matrix_report.json.",
    )
    p.add_argument("--protocol", type=Path, required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--split-assignment", type=Path, required=True)
    p.add_argument("--fold-assignment", type=Path, required=True)
    p.add_argument("--image-root", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--vram-floor-mb", type=int, default=6000)
    p.add_argument("--weights-id", type=str, default="EfficientNet_B4_Weights.IMAGENET1K_V1")
    p.add_argument("--heartbeat-timeout", type=float, default=90.0)
    p.add_argument("--process-timeout", type=float, default=300.0)
    p.add_argument("--now", type=str, default=None, help="ISO8601 timestamp; default = now (UTC).")
    p.add_argument("--child", type=Path, default=None, help="INTERNAL: fake harness (test only).")
    return p


def _git_commit() -> Optional[str]:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], check=False,
                             capture_output=True, text=True)
        return out.stdout.strip() or None
    except OSError:
        return None


def _config_from_args(args: argparse.Namespace) -> MatrixConfig:
    now = args.now or _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return MatrixConfig(
        protocol_path=args.protocol, manifest_path=args.manifest,
        split_path=args.split_assignment, fold_path=args.fold_assignment,
        image_root=args.image_root, out_dir=args.out_dir,
        vram_floor_mb=args.vram_floor_mb, weights_id=args.weights_id,
        heartbeat_timeout=args.heartbeat_timeout, process_timeout=args.process_timeout,
        now=now, git_commit=_git_commit(), child=args.child,
    )


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_argparser().parse_args(argv)
    from p1.stability.environment import RealT3EnvAdapter
    cfg = _config_from_args(args)
    report = run_matrix(cfg, RealT3EnvAdapter())
    return report.exit_code


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())


__all__ = ["main"]
