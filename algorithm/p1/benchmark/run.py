"""P1-01c benchmark CLI.

Run the full GPU smoke benchmark on the RTX 4060 and emit the five JSON
artifacts under ``algorithm/artifacts/p1_benchmark_v1/``::

    benchmark_environment_v1.json
    benchmark_protocol_v1.json
    benchmark_compute_v1.json
    benchmark_real_io_v1.json
    backbone_decision_v1.json

Hard rules:

- Skip cleanly on CPU-only environments (the unit tests cover the pure
  logic; the real GPU sweep is a *separate* CLI step).
- Never touch the frozen data layer or the gRPC/Java/Vue stack.
- Never load legacy disease checkpoints.

Typical usage::

    conda run -n eye-p1-bench python -m p1.benchmark.run \\
        --eye-data-root "<real dataset path>" \\
        --out-dir algorithm/artifacts/p1_benchmark_v1

Unit tests + integration test invocation::

    python -m pytest eye_diagnosis_p1/tests/ -q
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Sequence

# torch is imported lazily so the module is importable on CPU (for --help).
BACKBONES: list[tuple[str, str, int]] = [
    ("efficientnet_b2", "EfficientNet_B2_Weights.IMAGENET1K_V1", 288),
    ("efficientnet_b3", "EfficientNet_B3_Weights.IMAGENET1K_V1", 300),
    ("efficientnet_b4", "EfficientNet_B4_Weights.IMAGENET1K_V1", 380),
]
PATIENT_BATCHES = (1, 2, 4, 6, 8)
TARGET_PATIENT_BATCH = 8
IO_NUM_WORKERS = (0, 2, 4)
IO_PIN_MEMORY = (False, True)
IO_PERSISTENT = (False, True)
IO_PATIENT_BATCH = 2
IO_N_PATIENTS = 128
COMPUTE_WARMUP = 20
COMPUTE_MEASURE = 100
COMPUTE_REPEATS = 3
IO_WARMUP_STEPS = 2
IO_MEASURE_STEPS = 50


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _git_commit() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(Path(__file__).resolve().parents[2])
        )
        return out.decode("utf-8").strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def _require_cuda_or_exit() -> None:
    import torch

    if not torch.cuda.is_available():
        print("ERROR: CUDA not available. This benchmark needs a CUDA-enabled "
              "PyTorch build (e.g. the eye-p1-bench conda env).", file=sys.stderr)
        sys.exit(2)


def collect_environment(eye_data_root: Path, manifest_paths) -> dict:
    import torch
    import torchvision

    free, total = torch.cuda.mem_get_info(0)
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "windows_release": platform.release(),
        "torch": torch.__version__,
        "torchvision": torchvision.__version__,
        "cuda_runtime": torch.version.cuda or "none",
        "cudnn_version": torch.backends.cudnn.version(),
        "cudnn_deterministic": bool(torch.backends.cudnn.deterministic),
        "gpu_name": torch.cuda.get_device_name(0),
        "gpu_capability": list(torch.cuda.get_device_capability(0)),
        "driver_version": _driver_version(),
        "gpu_total_mb": int(total // (1024 * 1024)),
        "gpu_free_mb": int(free // (1024 * 1024)),
        "amp_dtype": "float16",
        "git_commit": _git_commit(),
        "manifest_sha256": _sha256_file(manifest_paths.patient_manifest_path),
        "eye_index_sha256": _sha256_file(manifest_paths.eye_index_path),
        "eye_data_root_sha256": _hash_eye_data_root(eye_data_root),
        "weights_enum": {
            "efficientnet_b2": "EfficientNet_B2_Weights.IMAGENET1K_V1",
            "efficientnet_b3": "EfficientNet_B3_Weights.IMAGENET1K_V1",
            "efficientnet_b4": "EfficientNet_B4_Weights.IMAGENET1K_V1",
        },
        "timestamp_utc": _dt.datetime.utcnow().isoformat() + "Z",
    }


def _driver_version() -> str:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader,nounits"]
        )
        return out.decode("utf-8").strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def _hash_eye_data_root(eye_data_root: Path) -> str:
    """Stable hash of the manifest + images dir file list (not the bytes)."""
    from p1.audit import read_source_manifest

    src = read_source_manifest(eye_data_root)
    return hashlib.sha256(
        (src.workbook_sha256 + src.images_dir_sha256).encode("utf-8")
    ).hexdigest()


def collect_protocol() -> dict:
    return {
        "compute": {
            "backbones": [b for b, _w, _s in BACKBONES],
            "patient_batches": list(PATIENT_BATCHES),
            "warmup_steps": COMPUTE_WARMUP,
            "measure_steps": COMPUTE_MEASURE,
            "repeats": COMPUTE_REPEATS,
            "amp": True,
            "amp_dtype": "float16",
            "step_components": ["forward", "BCEWithLogitsLoss", "backward", "GradScaler", "AdamW", "zero_grad"],
            "disabled_optimisations": ["torch.compile", "gradient_checkpointing", "channels_last", "custom_cuda_kernels", "quantization"],
        },
        "io": {
            "patient_batch": IO_PATIENT_BATCH,
            "n_patients": IO_N_PATIENTS,
            "num_workers": list(IO_NUM_WORKERS),
            "pin_memory": list(IO_PIN_MEMORY),
            "persistent_workers": list(IO_PERSISTENT),
            "warmup_steps": IO_WARMUP_STEPS,
            "measure_steps": IO_MEASURE_STEPS,
            "fov_crop_enabled": False,
            "preprocessing_pipeline": ["EXIF_orientation", "RGB", "aspect_preserving_resize", "pad_to_square", "resize_to_target", "imagenet_normalize"],
        },
    }


def run_compute_sweep() -> list[dict]:
    import time as _time

    import torch

    from p1.benchmark.compute import measure_config, result_to_dict
    from p1.benchmark.cuda_runtime import CudaMemoryProbe, build_compute_step, cuda_sync

    out: list[dict] = []
    for backbone, weights, input_size in BACKBONES:
        for pb in PATIENT_BATCHES:
            # try first; if OOM, mark rest as OOM-skipped
            repeat_results: list[dict] = []
            oom_seen = False
            for r in range(COMPUTE_REPEATS):
                try:
                    step = build_compute_step(backbone, patient_batch=pb)
                except torch.cuda.OutOfMemoryError as exc:  # build-time OOM
                    res = measure_config(
                        backbone=backbone,
                        weights=weights,
                        input_size=input_size,
                        patient_batch=pb,
                        step_fn=lambda: (_ for _ in ()).throw(exc),
                        warmup=COMPUTE_WARMUP,
                        measure=COMPUTE_MEASURE,
                        clock=_time.perf_counter,
                        mem=CudaMemoryProbe(),
                        sync=cuda_sync,
                        amp=True,
                    )
                    repeat_results.append(result_to_dict(res))
                    oom_seen = True
                    break

                if oom_seen:
                    continue

                res = measure_config(
                    backbone=backbone,
                    weights=weights,
                    input_size=input_size,
                    patient_batch=pb,
                    step_fn=step,
                    warmup=COMPUTE_WARMUP,
                    measure=COMPUTE_MEASURE,
                    clock=_time.perf_counter,
                    mem=CudaMemoryProbe(),
                    sync=cuda_sync,
                    amp=True,
                )
                repeat_results.append(result_to_dict(res))
                if res.oom:
                    oom_seen = True
                    break

            # Aggregate: stable if all repeats successful, take the last.
            if not repeat_results:
                continue
            last = repeat_results[-1]
            last["repeats"] = len(repeat_results)
            last["stable"] = all(r["stable"] and not r["oom"] for r in repeat_results)
            out.append(last)

            if oom_seen:
                # Larger batches for this backbone are OOM-skipped.
                for larger in PATIENT_BATCHES:
                    if larger <= pb:
                        continue
                    out.append(
                        {
                            "backbone": backbone,
                            "weights": weights,
                            "input_size": input_size,
                            "patient_batch_size": larger,
                            "encoder_image_batch_size": larger * 2,
                            "amp": True,
                            "steps": 0,
                            "stable": False,
                            "oom": True,
                            "start_free_vram_mb": 0,
                            "peak_allocated_mb": 0,
                            "peak_reserved_mb": 0,
                            "free_vram_after_step_mb": 0,
                            "step_time_p50_ms": 0.0,
                            "step_time_p95_ms": 0.0,
                            "patients_per_second": 0.0,
                            "images_per_second": 0.0,
                            "skipped_after_oom": True,
                        }
                    )
                break  # next backbone
    return out


def run_io_sweep(eye_data_root: Path, patient_rows: list[dict]) -> list[dict]:
    from p1.benchmark.cuda_runtime import run_io_config
    from p1.benchmark.realio import dataloader_configs, io_result_to_dict

    configs = dataloader_configs(
        num_workers=IO_NUM_WORKERS,
        pin_memory=IO_PIN_MEMORY,
        persistent_workers=IO_PERSISTENT,
    )
    out: list[dict] = []
    for backbone in ("efficientnet_b2", "efficientnet_b3", "efficientnet_b4"):
        for c in configs:
            r = run_io_config(
                backbone=backbone,
                rows=patient_rows,
                eye_data_root=eye_data_root,
                num_workers=c["num_workers"],
                pin_memory=c["pin_memory"],
                persistent_workers=c["persistent_workers"],
                patient_batch=IO_PATIENT_BATCH,
                measure_steps=IO_MEASURE_STEPS,
                warmup_steps=IO_WARMUP_STEPS,
            )
            d = io_result_to_dict(r)
            d["backbone"] = backbone
            out.append(d)
    return out


def make_decision(
    compute_results: list[dict],
    io_results: list[dict],
    *,
    baseline_free_vram_mb: int,
):
    from p1.benchmark.decision import (
        BackboneEvidence,
        decide_backbone,
        decision_to_dict,
    )

    # For each backbone, find the largest stable patient batch.
    by_bb: dict[str, dict] = {}
    for r in compute_results:
        bb = r["backbone"]
        info = by_bb.setdefault(bb, {"stable_patient_batches": 0, "peak_reserved": 0, "oom": False})
        if r["stable"] and not r["oom"]:
            if r["patient_batch_size"] > info["stable_patient_batches"]:
                info["stable_patient_batches"] = r["patient_batch_size"]
                # Record peak_reserved from the *largest* stable batch, which
                # is the one that actually challenges the VRAM budget.
                info["peak_reserved"] = r["peak_reserved_mb"]
        if r.get("oom") and not r.get("skipped_after_oom"):
            info["oom"] = True

    io_pps_by_bb = {b: max((r["end_to_end_patients_per_second"] for r in io_results if r["backbone"] == b), default=0.0)
                    for b in ("efficientnet_b2", "efficientnet_b3", "efficientnet_b4")}

    # Use the benchmark-start free VRAM (recorded in
    # ``benchmark_environment_v1.json``) as the headroom denominator for
    # every backbone. The per-config ``start_free_vram_mb`` from the
    # compute sweep is contaminated by accumulated CUDA context across
    # configs and is not a valid VRAM budget reference.
    evidence = []
    for bb in ("efficientnet_b4", "efficientnet_b3", "efficientnet_b2"):
        info = by_bb.get(bb, {"stable_patient_batches": 0, "peak_reserved": 0, "oom": True})
        evidence.append(
            BackboneEvidence(
                backbone=bb,
                input_size={"efficientnet_b2": 288, "efficientnet_b3": 300, "efficientnet_b4": 380}[bb],
                stable_patient_batches=tuple(
                    pb for pb in (1, 2, 4, 6, 8) if pb <= info["stable_patient_batches"]
                ),
                max_peak_reserved_mb=info["peak_reserved"],
                start_free_vram_mb=baseline_free_vram_mb,
                oomed=info["oom"] and info["stable_patient_batches"] == 0,
                io_patients_per_second=io_pps_by_bb[bb],
            )
        )

    decision = decide_backbone(evidence, target_patient_batch=TARGET_PATIENT_BATCH)
    return decision_to_dict(decision)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--eye-data-root",
        type=Path,
        default=Path(os.environ.get("EYE_DATA_ROOT", "")),
        help="Path to the source dataset root (Traning_Dataset.xlsx + Training_Dataset/).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("algorithm/artifacts/p1_benchmark_v1"),
        help="Where to write the five JSON artifacts.",
    )
    parser.add_argument(
        "--manifest-dir",
        type=Path,
        default=Path("algorithm/artifacts/p1_v1"),
        help="Where the patient manifest artifacts live.",
    )
    parser.add_argument(
        "--skip-io",
        action="store_true",
        help="Skip Part B (real-data I/O). Useful for re-running compute only.",
    )
    parser.add_argument(
        "--skip-compute",
        action="store_true",
        help="Skip Part A (compute). Reuse existing benchmark_compute_v1.json.",
    )
    args = parser.parse_args(argv)

    _require_cuda_or_exit()
    eye_data_root = args.eye_data_root
    if not eye_data_root.is_dir():
        print(f"ERROR: --eye-data-root is not a directory: {eye_data_root}", file=sys.stderr)
        return 2

    from p1.audit import read_source_manifest
    from p1.manifest import ManifestPaths
    from p1.benchmark.select import select_dev_patients

    print(f"[env] reading manifest from {args.manifest_dir}")
    manifest_paths = ManifestPaths(
        patient_manifest_path=args.manifest_dir / "patient_manifest_v1.parquet",
        eye_index_path=args.manifest_dir / "eye_index_v1.parquet",
    )
    # Force a real-data audit to anchor the SHA in the environment JSON.
    read_source_manifest(eye_data_root)

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- environment ----
    env = collect_environment(eye_data_root, manifest_paths)
    (out_dir / "benchmark_environment_v1.json").write_text(json.dumps(env, indent=2))
    print(f"[env] free_mb={env['gpu_free_mb']} device={env['gpu_name']}")

    # ---- protocol ----
    proto = collect_protocol()
    (out_dir / "benchmark_protocol_v1.json").write_text(json.dumps(proto, indent=2))

    # ---- compute ----
    compute_results: list[dict] = []
    if args.skip_compute:
        existing = out_dir / "benchmark_compute_v1.json"
        if existing.is_file():
            compute_results = json.loads(existing.read_text())["results"]
            print(f"[compute] loaded {len(compute_results)} existing configs")
        else:
            print(f"[compute] --skip-compute but {existing} not found", file=sys.stderr)
            return 2
    else:
        print("[compute] sweeping...")
        compute_results = run_compute_sweep()
        (out_dir / "benchmark_compute_v1.json").write_text(
            json.dumps({"results": compute_results, "schema_version": 1}, indent=2)
        )
        print(f"[compute] {len(compute_results)} configs")

    # ---- io ----
    io_results: list[dict] = []
    if not args.skip_io:
        split_path = args.manifest_dir / "split_assignment_v1.csv"
        patient_ids = select_dev_patients(split_path, n=IO_N_PATIENTS)
        # Resolve each patient to its (left,right,labels) row from the manifest.
        import pandas as pd

        pdf = pd.read_parquet(manifest_paths.patient_manifest_path)
        pdf = pdf.set_index("patient_id")
        label_cols = [c for c in pdf.columns if c.startswith("label_")]
        rows: list[dict] = []
        for pid in patient_ids:
            r = pdf.loc[pid]
            rows.append(
                {
                    "patient_id": pid,
                    "left_image_relpath": r["left_image_relpath"],
                    "right_image_relpath": r["right_image_relpath"],
                    "labels": [int(r[c]) for c in label_cols],
                }
            )
        print(f"[io] selected {len(rows)} Dev patients; sweeping DataLoader matrix")
        io_results = run_io_sweep(eye_data_root, rows)
        (out_dir / "benchmark_real_io_v1.json").write_text(
            json.dumps({"results": io_results, "schema_version": 1}, indent=2)
        )
        print(f"[io] {len(io_results)} configs")

    # ---- decision ----
    decision = make_decision(compute_results, io_results, baseline_free_vram_mb=env["gpu_free_mb"])
    (out_dir / "backbone_decision_v1.json").write_text(json.dumps(decision, indent=2))
    print(
        f"[decision] selected_backbone={decision['selected_backbone']} "
        f"patient_batch={decision['selected_patient_batch']} "
        f"accum={decision['gradient_accumulation_target']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
