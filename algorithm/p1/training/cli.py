"""CLI for the P2-01 E0–E3 training entry point.

Minimal scaffold only: parses arguments, locates the patient manifest and
split, and delegates to ``run_fold``. The full multi-fold orchestration
lives in P2-02.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from p1.audit import CLASS_ORDER
from p1.manifest import ManifestPaths
from p1.split import assign_splits, build_oof_folds
from p1.training.e2_assignment import assign_e2_eyes
from p1.training.fold_runner import run_fold
from p1.training.protocol import default_protocol, load_protocol


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="p1.training.cli")
    parser.add_argument("--experiment", required=True, choices=["E0", "E1", "E2", "E3"])
    parser.add_argument("--fold", required=True, type=int)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument(
        "--protocol",
        default=str(Path(__file__).resolve().parent.parent / "protocol_e0_e3_v1.json"),
        help="Path to the frozen protocol JSON. Defaults to p1/protocol_e0_e3_v1.json.",
    )
    parser.add_argument(
        "--out-dir",
        default="artifacts/p2_e0_e3_v1",
        help="Where to write fold receipts and OOF CSVs.",
    )
    parser.add_argument(
        "--eye-data-root",
        default=os.environ.get("EYE_DATA_ROOT", ""),
        help="Path to the source dataset (also reads EYE_DATA_ROOT env).",
    )
    parser.add_argument("--device", default="cuda")
    return parser.parse_args(list(argv) if argv is not None else None)


def _load_manifest(root: Path) -> ManifestPaths:
    return ManifestPaths(
        patient_manifest_path=root / "patient_manifest_v1.parquet",
        eye_index_path=root / "eye_index_v1.parquet",
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    protocol_path = Path(args.protocol)
    protocol = load_protocol(protocol_path) if protocol_path.exists() else default_protocol()
    root = Path(args.eye_data_root)
    if not root.exists():
        print(f"eye-data-root not found: {root}", file=sys.stderr)
        return 2

    manifest = _load_manifest(root)
    assignment = assign_splits(manifest, seed=protocol.seed, test_frac=0.15, out_dir=None)
    folds = build_oof_folds(assignment, manifest, k=5, seed=protocol.seed)
    val_pids = list(folds.fold_to_patients(args.fold))
    dev_pids = [pid for pid in assignment.dev_patient_ids if pid not in set(val_pids)]

    pdf = pd.read_parquet(manifest.patient_manifest_path)
    image_paths = {
        row["patient_id"]: {
            "left": Path(row["left_image_relpath"]),
            "right": Path(row["right_image_relpath"]),
        }
        for row in pdf.to_dict("records")
    }
    labels = {
        row["patient_id"]: np.asarray(
            [row[f"label_{c}"] for c in CLASS_ORDER], dtype=np.int8
        )
        for row in pdf.to_dict("records")
    }

    e2_assignment = (
        assign_e2_eyes(list(pdf["patient_id"].tolist()), seed=protocol.e2_seed)
        if args.experiment == "E2"
        else None
    )

    out_dir = Path(args.out_dir) / args.experiment / f"fold_{args.fold}"
    receipt = run_fold(
        experiment=args.experiment,
        fold_id=args.fold,
        dev_patient_ids=dev_pids,
        val_patient_ids=val_pids,
        image_paths=image_paths,
        labels=labels,
        root_dir=root,
        protocol=protocol,
        out_dir=out_dir,
        e2_assignment=e2_assignment,
    )
    print(
        f"fold {args.fold} {args.experiment} ok: "
        f"val={receipt.val_patient_count} sha={receipt.checkpoint_sha256[:12]}..."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())