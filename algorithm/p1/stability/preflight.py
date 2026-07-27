"""P2-02A T3 preflight hard gates.

Runs the four T3-acceptance checks before any GPU time is spent:

  1. GPU availability (no CPU fallback — fail closed).
  2. VRAM floor (no auto batch shrink — fail closed).
  3. Frozen-input integrity (reuses P2-01 ``validate_frozen_training_inputs``).
  4. Weights cached on disk + image root readable + out dir writable + disk free.

Any failing gate ⇒ ``ok=False`` and ``reason`` names the offending
gate; the matrix is never launched. There is no remediation path —
T3 is intentionally strict.
"""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from p1.stability.environment import T3EnvAdapter


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class PreflightResult:
    ok: bool
    checks: list[CheckResult]
    reason: Optional[str]


def run_preflight(
    *,
    protocol_path: Path,
    manifest_path: Path,
    split_path: Path,
    fold_path: Path,
    image_root: Path,
    out_dir: Path,
    vram_floor_mb: int,
    weights_id: str,
    adapter: T3EnvAdapter,
) -> PreflightResult:
    checks: list[CheckResult] = []

    # 1. GPU availability (hard gate; no CPU fallback).
    cuda_avail = bool(adapter.cuda_is_available())
    cuda_n = int(adapter.cuda_device_count())
    gpu_ok = cuda_avail and cuda_n >= 1
    checks.append(CheckResult("gpu", gpu_ok,
                              f"cuda_available={cuda_avail} devices={cuda_n}"))

    # 2. VRAM floor (hard gate; no auto batch shrink).
    vram_ok = False
    if gpu_ok:
        free_b, total_b = adapter.cuda_mem_get_info(0)
        free_mb = free_b // (1024**2)
        vram_ok = free_mb >= vram_floor_mb
        checks.append(CheckResult("vram", vram_ok, f"free_mb={free_mb} floor_mb={vram_floor_mb}"))
    else:
        checks.append(CheckResult("vram", False, "skipped: no gpu"))

    # 3. Frozen-input integrity (reuse P2-01 validators; no modification).
    fi_ok, fi_detail = _check_frozen_inputs(protocol_path, manifest_path, split_path, fold_path)
    checks.append(CheckResult("frozen_inputs", fi_ok, fi_detail))

    # 4. Weights cached + image-root readable + out-dir writable + disk free.
    wp_ok, wp_detail = _check_weights_paths_disk(adapter, weights_id, image_root, out_dir)
    checks.append(CheckResult("weights_paths_disk", wp_ok, wp_detail))

    reason = None
    if not gpu_ok:
        reason = "no_cuda"
    elif not vram_ok:
        reason = "insufficient_vram"
    elif not fi_ok:
        reason = "frozen_input_integrity"
    elif not wp_ok:
        reason = "weights_paths_disk"
    return PreflightResult(ok=(reason is None), checks=checks, reason=reason)


def _check_frozen_inputs(protocol_path, manifest_path, split_path, fold_path) -> tuple[bool, str]:
    try:
        from p1.stability.protocol import P202AProtocolError, load_p202a_protocol
        from p1.training.frozen_inputs import (
            FrozenInputError,
            load_fold_assignment,
            load_split_assignment,
            validate_frozen_training_inputs,
        )
        # Read the manifest with pyarrow directly (pyarrow is in
        # requirements-p1.txt and the GPU env eye-p1-bench). Using
        # pandas would force a second heavyweight dep that the
        # watchdog CI job does not install.
        import pyarrow as _pa
        import pyarrow.parquet as _pq
        manifest_pids = {
            str(v) for v in _pq.read_table(Path(manifest_path)).column("patient_id").to_pylist()
        }
        load_p202a_protocol(Path(protocol_path))
        split = load_split_assignment(Path(split_path))
        fold = load_fold_assignment(Path(fold_path), expected_folds=5)
        validate_frozen_training_inputs(manifest_pids, split, fold, expected_folds=5)
        return True, "protocol+manifest+split+fold validated"
    except (P202AProtocolError, FrozenInputError, OSError, _pa.ArrowException) as e:
        return False, f"{type(e).__name__}: {e}"


def _check_weights_paths_disk(adapter, weights_id, image_root, out_dir) -> tuple[bool, str]:
    image_root, out_dir = Path(image_root), Path(out_dir)
    if not image_root.is_dir():
        return False, f"image_root not readable: {image_root}"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        probe = out_dir / ".t3_write_probe"
        probe.write_text("x", encoding="utf-8"); probe.unlink()
    except OSError as e:
        return False, f"out_dir not writable: {e}"
    free_bytes = shutil.disk_usage(out_dir).free
    if free_bytes < 1 * 1024**3:  # 1 GiB floor for logs/reports
        return False, f"insufficient disk: {free_bytes // 1024**2} MB free"
    wp = adapter.weights_cache_path(weights_id)
    if not wp:
        return False, f"weights not cached for {weights_id}"
    return True, f"weights={wp}"


__all__ = ["CheckResult", "PreflightResult", "run_preflight"]
