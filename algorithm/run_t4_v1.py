"""T4 CLI: run the 100-batch stability gate on the real GPU.

This is a thin script — the real logic lives in ``p1.stability.t4``.
It imports torch + builds the real adapters exactly like the T1.2
probe CLI does, then runs 100 batches and writes a JSON report.

Usage (from the worktree's algorithm/ dir):
    /d/programe/Anaconda/envs/eye-p1-bench/python.exe run_t4_v1.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Worktree paths (this script is run from algorithm/)
WORKTREE = Path(__file__).resolve().parent
# Main checkout is 3 levels up: algorithm/.. = worktree/, ../.. = .worktrees/, ../../.. = D:/Work/code/eye-diagnosis
MAIN = WORKTREE.parent.parent.parent / "algorithm"


def main() -> int:
    protocol_path = WORKTREE / "p1" / "protocol_p2_02a_v1.json"
    manifest_path = MAIN / "artifacts" / "p1_v1" / "patient_manifest_v1.parquet"
    split_path = MAIN / "artifacts" / "p1_v1" / "split_assignment_v1.csv"
    fold_path = MAIN / "artifacts" / "p1_v1" / "fold_assignment_v1.csv"
    # Manifest relpath is "Training_Dataset/<n>_<side>.jpg"; the actual
    # JPEGs are 2 levels deeper than datasets/DataSet (see p1-data-facts
    # memory and the v3 run invocation in run_t3_v3.ps1).
    image_root = MAIN / "datasets" / "DataSet" / "Training_Dataset" / "Training_Dataset"
    out_dir = WORKTREE / "artifacts" / "p2_02a_t4_real_v1"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[t4] worktree   = {WORKTREE}", flush=True)
    print(f"[t4] protocol   = {protocol_path}", flush=True)
    print(f"[t4] manifest   = {manifest_path}", flush=True)
    print(f"[t4] fold       = {fold_path}", flush=True)
    print(f"[t4] image_root = {image_root}", flush=True)
    print(f"[t4] out_dir    = {out_dir}", flush=True)

    sys.path.insert(0, str(WORKTREE))

    # Imports here so the path is set first.
    from p1.stability.cli import (
        build_real_dataloader_factory,
        build_real_model_factory,
        make_real_optimizer_factory,
    )
    from p1.stability.t4 import run_t4_stability

    import pandas as pd
    from p1.training.frozen_inputs import (
        load_fold_assignment,
        load_split_assignment,
        validate_frozen_training_inputs,
    )

    manifest_pdf = pd.read_parquet(manifest_path)
    manifest_pids = set(manifest_pdf["patient_id"].tolist())
    split = load_split_assignment(split_path)
    fold = load_fold_assignment(fold_path, expected_folds=5)

    # Validate frozen inputs BEFORE touching the GPU (mirrors the probe's
    # frozen_input_validation stage). T4 doesn't enforce this internally
    # — it's the caller's responsibility.
    validate_frozen_training_inputs(
        manifest_pids, split, fold, expected_folds=5
    )
    print("[t4] frozen inputs validated", flush=True)

    # Real adapters
    torch_a = __import__(
        "p1.stability.cli", fromlist=["build_real_torch_adapter"]
    ).build_real_torch_adapter()
    dl_factory = build_real_dataloader_factory(
        manifest_path=manifest_path,
        image_root=image_root,
        fold=0,
        target_size=380,
        fold_assignment_path=fold_path,
    )
    model_factory = build_real_model_factory(
        experiment="E3",
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        device="cuda",
    )
    optimizer_factory = make_real_optimizer_factory()

    report = run_t4_stability(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=optimizer_factory,
        experiment="E3",
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        device="cuda",
        amp=True,
        patient_batch=8,
        num_workers=2,
        pin_memory=True,
        image_size=380,
        num_classes=8,
        target_batches=100,
    )

    out_path = out_dir / "t4_stability_report.json"
    out_path.write_text(
        json.dumps(report, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    print(f"[t4] verdict    = {report['verdict']}", flush=True)
    print(f"[t4] success    = {report['success_batches']}", flush=True)
    print(f"[t4] oom        = {report['oom']}", flush=True)
    print(f"[t4] nan        = {report['nan_detected']} @ batch {report['nan_at_batch']}", flush=True)
    print(f"[t4] first_ms   = {report['first_batch_ms']}", flush=True)
    print(f"[t4] p50/p95_ms = {report['p50_gpu_ms']} / {report['p95_gpu_ms']}", flush=True)
    print(f"[t4] written    = {out_path}", flush=True)
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())