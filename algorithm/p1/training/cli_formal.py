"""P2-02B CLI front end for the formal epoch training loop.

Mirrors the §3.6 flag set locked during brainstorming. Maps
``ExperimentReceipt.overall_status`` to exit codes (0=PASS, 1=BLOCKED,
2=FAILED_PREFLIGHT). Reuses DI'd real adapters from ``p1.stability.cli``.

Module-level imports of ``load_protocol`` / ``load_split_assignment`` /
``load_fold_assignment`` / ``pd`` / ``build_real_*`` are intentional:
they're attributes on this module so tests can monkey-patch them
(the CLI tests use this to bypass real artifact files / GPU adapters).
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Sequence

import pandas as pd

from p1.training.frozen_inputs import (  # noqa: F401  (monkey-patch seam)
    load_fold_assignment,
    load_split_assignment,
)
from p1.training.orchestrator import run_formal_experiment  # noqa: F401  (monkey-patch seam)
from p1.training.receipts import ExperimentReceipt
from p1.stability.cli import (  # noqa: F401  (monkey-patch seam)
    build_real_dataloader_factory,
    build_real_model_factory,
    build_real_torch_adapter,
    make_real_optimizer_factory,
)
from p1.stability.protocol import (  # noqa: F401  (monkey-patch seam)
    P202AProtocolError,
    load_p202a_protocol,
)


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cli_formal",
        description="P2-02B formal epoch training loop. "
                    "P2-02B itself does NOT run on the real GPU; "
                    "this entry point is for P2-02C and P2-03.",
    )
    p.add_argument("--fold", type=int, action="append", required=True,
                   help="Fold index; pass multiple times for multiple folds.")
    p.add_argument("--experiment", default="E3")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out-dir", type=Path,
                   default=Path("artifacts") / "p2_02b")
    p.add_argument("--max-epochs", type=int, default=None)
    p.add_argument("--patience", type=int, default=None)
    p.add_argument("--protocol", type=Path,
                   default=Path("p1") / "protocol_p2_02a_v1.json")
    p.add_argument("--manifest", type=Path,
                   default=Path("artifacts") / "p1_v1" / "patient_manifest_v1.parquet")
    p.add_argument("--split-assignment", type=Path,
                   default=Path("artifacts") / "p1_v1" / "split_assignment_v1.csv")
    p.add_argument("--fold-assignment", type=Path,
                   default=Path("artifacts") / "p1_v1" / "fold_assignment_v1.csv")
    p.add_argument("--image-root", type=Path, required=True)
    p.add_argument("--emit-heartbeat", action="store_true", default=False,
                   help="Emit HEARTBEAT EPOCH/CHECKPOINT lines to stdout for "
                        "the fold0_smoke subprocess watchdog (P2-02C).")
    return p


def _exit_code_for(receipt: ExperimentReceipt) -> int:
    if receipt.overall_status == "PASS":
        return 0
    if receipt.overall_status == "FAILED_PREFLIGHT":
        return 2
    return 1  # BLOCKED


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    args = _build_argparser().parse_args(list(argv) if argv is not None else None)

    # All module-level imports so tests can monkey-patch them.
    try:
        cfg = load_p202a_protocol(args.protocol)
    except P202AProtocolError as e:
        print(f"protocol error: {e}", file=sys.stderr)
        return 2
    manifest_pdf = pd.read_parquet(args.manifest)
    split_df = load_split_assignment(args.split_assignment)
    fold_df = load_fold_assignment(args.fold_assignment, expected_folds=5)

    torch_a = build_real_torch_adapter()
    model_factory = build_real_model_factory(
        experiment=args.experiment,
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        device="cuda",
    )
    optimizer_factory = make_real_optimizer_factory()
    dl_factory = build_real_dataloader_factory(
        manifest_path=args.manifest,
        image_root=args.image_root,
        fold=args.fold[0],  # for fold 0; full multi-fold uses orchestrator
        target_size=380,
        fold_assignment_path=args.fold_assignment,
    )

    receipt = run_formal_experiment(
        out_root=args.out_dir,
        folds=args.fold,
        manifest_pids=set(manifest_pdf["patient_id"].tolist()),
        split_df=split_df,
        fold_df=fold_df,
        cfg=cfg,
        torch_adapter=torch_a,
        model_factory=model_factory,
        data_factory=dl_factory,
        experiment=args.experiment,
        seed=args.seed,
        max_epochs=args.max_epochs,
        patience=args.patience,
        emit_heartbeat=args.emit_heartbeat,
    )
    return _exit_code_for(receipt)


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv[1:]))


__all__ = ["main", "_build_argparser", "_exit_code_for"]