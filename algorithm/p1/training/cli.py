"""CLI for the P2-01 E0–E3 training entry point.

The CLI is strictly consumer-only: it reads a frozen split + a frozen
fold map; it never calls ``assign_splits`` or ``build_oof_folds``. All
four randomness-affecting inputs (manifest, split, fold, protocol) are
SHA-256-recorded in the fold receipt via ``input_hashes``.

The full multi-fold orchestration lives in P2-02.

**Smoke is opt-in.** Without ``--smoke`` the CLI fails closed: the
P2-01R plan only ships a one-step smoke path, and silently running it
as a "formal fold" would mislead downstream readers of the receipt.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from p1.audit import CLASS_ORDER
from p1.training.e2_assignment import assign_e2_eyes
from p1.training.fold_runner import run_fold
from p1.training.frozen_inputs import (
    load_fold_assignment,
    load_split_assignment,
    sha256_file,
    validate_frozen_training_inputs,
)
from p1.training.protocol import load_protocol


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="p1.training.cli")
    parser.add_argument("--experiment", required=True, choices=["E0", "E1", "E2", "E3"])
    parser.add_argument("--fold", required=True, type=int)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help=(
            "Required to actually run: the P2-01R plan only ships a "
            "one-step smoke path. Without --smoke the CLI fails closed "
            "to prevent a silent partial fold from being mistaken for "
            "a formal result."
        ),
    )
    parser.add_argument(
        "--protocol",
        default=str(Path(__file__).resolve().parent.parent / "protocol_e0_e3_v1.json"),
        help="Path to the frozen protocol JSON. Defaults to p1/protocol_e0_e3_v1.json.",
    )
    parser.add_argument(
        "--manifest",
        required=True,
        help="Path to the patient_manifest_v1.parquet file.",
    )
    parser.add_argument(
        "--split-assignment",
        required=True,
        dest="split_assignment",
        help="Path to the frozen split_assignment_v1.csv.",
    )
    parser.add_argument(
        "--fold-assignment",
        required=True,
        dest="fold_assignment",
        help="Path to the frozen fold_assignment_v1.csv.",
    )
    parser.add_argument(
        "--image-root",
        required=True,
        dest="image_root",
        help="Root directory containing the image files referenced by the manifest.",
    )
    parser.add_argument(
        "--out-dir",
        default="artifacts/p2_e0_e3_v1",
        help="Where to write fold receipts and OOF CSVs.",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.smoke:
        print(
            "ERROR: --smoke is required. The P2-01R plan only ships a "
            "one-step smoke path; a missing --smoke would otherwise "
            "silently produce a partial run that looks like a formal "
            "fold. Re-run with --smoke to acknowledge.",
            file=sys.stderr,
        )
        return 2

    protocol_path = Path(args.protocol)
    if not protocol_path.exists():
        print(f"protocol not found: {protocol_path}", file=sys.stderr)
        return 2
    protocol = load_protocol(protocol_path)
    expected_folds = protocol.k_folds

    manifest_path = Path(args.manifest)
    image_root = Path(args.image_root)
    split_path = Path(args.split_assignment)
    fold_path = Path(args.fold_assignment)
    for p in (manifest_path, image_root, split_path, fold_path):
        if not p.exists():
            print(f"path not found: {p}", file=sys.stderr)
            return 2

    pdf = pd.read_parquet(manifest_path)
    manifest_pids = set(pdf["patient_id"].tolist())
    if not manifest_pids:
        print(f"manifest has no patient_ids: {manifest_path}", file=sys.stderr)
        return 2

    split = load_split_assignment(split_path)
    fold_map = load_fold_assignment(fold_path, expected_folds=expected_folds)

    if not (0 <= args.fold < expected_folds):
        print(
            f"--fold {args.fold} outside [0, {expected_folds}) defined by "
            f"protocol.k_folds",
            file=sys.stderr,
        )
        return 2

    validate_frozen_training_inputs(
        manifest_pids, split, fold_map, expected_folds=expected_folds
    )

    val = [
        pid
        for pid, f in fold_map.items()
        if f == args.fold and split.get(pid) == "dev"
    ]
    train = [
        pid
        for pid, f in fold_map.items()
        if f != args.fold and split.get(pid) == "dev"
    ]

    if not val:
        print(
            f"fold {args.fold} has zero Development validation patients "
            f"(train={len(train)}); fail-closed.",
            file=sys.stderr,
        )
        return 2
    if not train:
        print(
            f"fold {args.fold} has zero Development training patients; "
            f"fail-closed.",
            file=sys.stderr,
        )
        return 2

    image_paths: dict[str, dict[str, Path]] = {}
    labels: dict[str, np.ndarray] = {}
    for row in pdf.to_dict("records"):
        pid = row["patient_id"]
        image_paths[pid] = {
            "left": Path(row["left_image_relpath"]),
            "right": Path(row["right_image_relpath"]),
        }
        labels[pid] = np.asarray(
            [row[f"label_{c}"] for c in CLASS_ORDER], dtype=np.int8
        )

    e2 = (
        assign_e2_eyes(list(pdf["patient_id"]), seed=protocol.e2_seed)
        if args.experiment == "E2"
        else None
    )

    input_hashes = {
        "manifest_sha256": sha256_file(manifest_path),
        "split_sha256": sha256_file(split_path),
        "fold_sha256": sha256_file(fold_path),
        "protocol_sha256": sha256_file(protocol_path),
    }

    out_dir = Path(args.out_dir) / args.experiment / f"fold_{args.fold}"
    receipt = run_fold(
        experiment=args.experiment,
        fold_id=args.fold,
        train_patient_ids=train,
        val_patient_ids=val,
        image_paths=image_paths,
        labels=labels,
        root_dir=image_root,
        protocol=protocol,
        out_dir=out_dir,
        e2_assignment=e2,
        input_hashes=input_hashes,
    )
    print(
        f"SMOKE ONLY — not a formal fold result. "
        f"fold {args.fold} {args.experiment} ok: "
        f"val={receipt.val_patient_count} sha={receipt.checkpoint_sha256[:12]}..."
    )
    return 0


__all__ = ["main", "parse_args"]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
