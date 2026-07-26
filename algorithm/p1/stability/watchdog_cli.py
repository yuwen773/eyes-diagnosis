"""P2-02A T2 subprocess watchdog CLI.

Iterates the 6 matrix cells (A-F) serially via
``p1.stability.matrix.expand_matrix`` and runs each through
``p1.stability.watchdog.SubprocessRunner``. The probe is invoked as
``python -u -m p1.stability.cli`` with the same frozen inputs as the
standalone probe plus the per-cell ``--cell`` and ``--out-dir`` flags.

The watchdog never overwrites the probe's ``<out>/<cell>.json``; it
writes ``<out>/<cell>.stdout.log``, ``<out>/<cell>.stderr.log``, and
a single ``<out>/_watchdog_summary.json`` containing every cell's
``WatchResult``.

Returns 0 if every cell's verdict is ``PASS``, else 1.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from p1.stability.matrix import expand_matrix
from p1.stability.watchdog import (
    RealTerminator,
    SubprocessRunner,
    WatchConfig,
)


def _build_argparser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="p1.stability.watchdog_cli",
        description=(
            "Run the P2-02A 6-cell matrix through the subprocess watchdog. "
            "Each cell is its own subprocess of `python -u -m p1.stability.cli`."
        ),
    )
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split-assignment", type=Path, required=True)
    parser.add_argument("--fold-assignment", type=Path, required=True)
    parser.add_argument("--image-root", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--process-timeout", type=float, default=300.0)
    parser.add_argument("--heartbeat-timeout", type=float, default=90.0)
    parser.add_argument("--poll-interval", type=float, default=0.1)
    parser.add_argument(
        "--child",
        type=Path,
        default=None,
        help=(
            "INTERNAL: replace `python -u -m p1.stability.cli` with this "
            "executable. Used by the test suite to substitute a fake harness."
        ),
    )
    return parser


def _invoke_probe(
    cell_label: str,
    cell_dir: Path,
    args: argparse.Namespace,
) -> list[str]:
    """Build the cmd for one cell. The child's --out-dir matches the
    runner's out_dir, so the probe writes ``<out>/<cell>.json`` and the
    runner reads from the same path."""
    if args.child is not None:
        return [
            sys.executable,
            "-u",
            str(args.child),
            str(cell_dir),
            cell_label,
        ]
    return [
        sys.executable,
        "-u",
        "-m",
        "p1.stability.cli",
        "--protocol", str(args.protocol),
        "--manifest", str(args.manifest),
        "--split-assignment", str(args.split_assignment),
        "--fold-assignment", str(args.fold_assignment),
        "--image-root", str(args.image_root),
        "--cell", cell_label,
        "--out-dir", str(cell_dir),
    ]


def main(argv: Optional[list[str]] = None) -> int:
    """Iterate cells A-F serially; return 0 iff every cell is PASS."""
    args = _build_argparser().parse_args(argv)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    config = WatchConfig(
        process_timeout_seconds=args.process_timeout,
        heartbeat_timeout_seconds=args.heartbeat_timeout,
        poll_interval_seconds=args.poll_interval,
    )
    summary: dict[str, dict] = {}
    all_pass = True
    for cell in expand_matrix():
        cell_dir = args.out_dir / cell.label
        cell_dir.mkdir(parents=True, exist_ok=True)
        runner = SubprocessRunner(
            cmd=_invoke_probe(cell.label, cell_dir, args),
            out_dir=cell_dir,
            cell_label=cell.label,
            config=config,
            terminator=RealTerminator(),
        )
        result = runner.run()
        summary[cell.label] = asdict(result)
        if result.verdict != "PASS":
            all_pass = False
    summary_path = args.out_dir / "_watchdog_summary.json"
    summary_path.write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0 if all_pass else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())


__all__ = ["main"]