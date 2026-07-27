"""P2-02A T4: 100-batch stability run.

T4 is the final gate before epoch training. It runs 100 consecutive
training batches at the cell-F config (amp=True, batch=8, workers=2,
pin_memory=True) and verifies no OOM / NaN / silent hang occurs across
sustained GPU load — the scenario the single-batch probe deliberately
does not cover.

The module is dependency-injected: it accepts ``TorchAdapter``,
``DataLoaderFactory``, ``ModelFactory``, and ``optimizer_factory``
rather than touching ``torch`` directly. CI stays green without a GPU;
the real adapter is wired by the CLI.

Design follows the benchmark's ``_one_pass`` loop in
``p1.benchmark.cuda_runtime``: H2D → autocast wrap → model+loss →
backward (GradScaler) → optimizer step → sync → timing. One autocast
context wraps both ``model()`` and ``criterion()`` per batch.
"""

from __future__ import annotations

import sys
import time
from typing import Any, Callable

from p1.benchmark.compute import _percentile, is_oom_error


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_t4_stability(
    *,
    torch: Any,
    dataloader_factory: Any,
    model_factory: Any,
    optimizer_factory: Callable[[Any], Any],
    experiment: str = "E3",
    weights: str = "EfficientNet_B4_Weights.IMAGENET1K_V1",
    device: str = "cuda",
    amp: bool = True,
    patient_batch: int = 8,
    num_workers: int = 2,
    pin_memory: bool = True,
    image_size: int = 380,
    num_classes: int = 8,
    target_batches: int = 100,
) -> dict[str, Any]:
    """Run 100 consecutive training batches and return a stability report.

    The report is a flat dict; callers serialize it to JSON. Keys:

    - ``verdict``: "PASS" | "BLOCKED"
    - ``config``: the frozen config this run used
    - ``total_batches_attempted``: how many batches the loop reached
    - ``success_batches``: count of batches that completed cleanly
    - ``oom``: True if any batch raised a CUDA OOM error
    - ``nan_detected``: True if ``torch.isfinite(loss)`` returned False
    - ``nan_at_batch``: 1-indexed batch where NaN was first detected
    - ``first_batch_ms``: GPU step time of the first batch
    - ``p50_gpu_ms``: median GPU step time across all success batches
    - ``p95_gpu_ms``: 95th percentile GPU step time
    - ``peak_vram_mb``: max VRAM allocated across the run (0 if unavailable)
    - ``batch_timings``: list of per-batch dicts
    """
    # ------------------------------------------------------------------
    # 1. Build model, optimizer, loss, scaler
    # ------------------------------------------------------------------
    model, _setup_meta = model_factory(
        experiment=experiment, weights=weights, device=device
    )
    model.train()
    optimizer = optimizer_factory(model)
    criterion = torch.BCEWithLogitsLoss()
    scaler = torch.GradScaler(enabled=amp)

    # ------------------------------------------------------------------
    # 2. Build DataLoader
    # ------------------------------------------------------------------
    loader = dataloader_factory(
        dataset=_FakeDataset(),
        batch_size=patient_batch,
        num_workers=num_workers,
        pin_memory=pin_memory,
    )

    # ------------------------------------------------------------------
    # 3. Run the 100-batch loop
    # ------------------------------------------------------------------
    batch_timings: list[dict[str, Any]] = []
    total_attempted = 0
    success = 0
    oom = False
    nan_detected = False
    nan_at_batch: int | None = None
    peak_vram_mb = 0
    first_batch_ms: float | None = None
    min_free_mb = None

    loader_iter = iter(loader)

    while success < target_batches:
        try:
            batch = next(loader_iter)
        except StopIteration:
            # Exhausted the current epoch — restart the iterator to
            # keep going toward target_batches. This is correct for
            # real data: fold 0 has ~491 patients, batch=8 yields ~61
            # per epoch, so 2 epochs are needed to reach 100 batches.
            loader_iter = iter(loader)
            try:
                batch = next(loader_iter)
            except StopIteration:
                # Empty loader (shouldn't happen with real data).
                break
        except Exception as exc:  # noqa: BLE001
            # Catch OOM / CUDA errors in the DataLoader itself (e.g.
            # JPEG decode on a pinned-memory worker).
            if is_oom_error(exc):
                oom = True
                break
            raise

        # Normalise: DataLoaders built via the probe's
        # ``build_real_dataloader_factory`` use a custom collate_fn
        # that drops ``cpu_ms`` (returns a list [lefts, rights, labels]).
        # Other DataLoaders yield the raw 4-tuple per item.
        if isinstance(batch, list) and len(batch) == 3:
            left, right, labels = batch[0], batch[1], batch[2]
            cpu_ms = 0.0
        elif isinstance(batch, tuple) and len(batch) == 4:
            left, right, labels, cpu_ms = batch
        elif isinstance(batch, tuple) and len(batch) == 3:
            left, right, labels = batch
            cpu_ms = 0.0
        else:
            raise RuntimeError(
                f"T4 got unexpected batch shape: type={type(batch).__name__} "
                f"len={len(batch) if hasattr(batch, '__len__') else '?'}"
            )

        total_attempted += 1
        try:
            # H2D
            left = left.to(device)
            right = right.to(device)
            labels = labels.to(device)

            t0 = time.perf_counter()
            optimizer.zero_grad(set_to_none=True)

            # match benchmark pattern: one autocast context wraps both
            # model() and criterion().
            autocast_ctx = None
            if amp:
                autocast_ctx = torch.autocast(
                    device_type="cuda", enabled=True
                )
                autocast_ctx.__enter__()
            try:
                logits = model(left, right)
                loss = criterion(logits, torch.float(labels))
            finally:
                if autocast_ctx is not None:
                    autocast_ctx.__exit__(*sys.exc_info())

            # NaN check BEFORE backward: a NaN loss would produce garbage
            # gradients that pollute the model parameters for subsequent
            # batches. Catch it first so the report reflects the exact
            # batch where NaN appeared.
            if not torch.isfinite(loss):
                nan_detected = True
                nan_at_batch = success + 1  # 1-indexed
                break

            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            torch.cuda_synchronize()

            gpu_ms = (time.perf_counter() - t0) * 1000.0
        except Exception as exc:  # noqa: BLE001
            if is_oom_error(exc):
                oom = True
                break
            raise

        success += 1
        if first_batch_ms is None:
            first_batch_ms = gpu_ms

        # VRAM — track minimum free memory observed across all batches.
        # Peak usage ≈ total_gpu_memory − min_free_mb (approximation;
        # the TorchAdapter protocol doesn't expose max_memory_allocated).
        try:
            free_bytes, _total_bytes = torch.cuda_mem_get_info(0)
            free_mb = int(free_bytes // (1024 * 1024))
            if min_free_mb is None:
                min_free_mb = free_mb
            else:
                min_free_mb = min(min_free_mb, free_mb)
        except Exception:
            pass

        batch_timings.append(
            {
                "batch_idx": success,
                "loss": float(loss.item()),
                "gpu_step_ms": round(gpu_ms, 3),
                "vram_free_mb": peak_vram_mb,
            }
        )

    # ------------------------------------------------------------------
    # 4. Compute aggregate metrics
    # ------------------------------------------------------------------
    gpu_times = sorted(b["gpu_step_ms"] for b in batch_timings)
    p50 = _percentile(gpu_times, 50) if gpu_times else 0.0
    p95 = _percentile(gpu_times, 95) if gpu_times else 0.0

    verdict = "PASS" if (
        success >= target_batches and not oom and not nan_detected
    ) else "BLOCKED"

    return {
        "verdict": verdict,
        "config": {
            "experiment": experiment,
            "backbone": "efficientnet_b4",
            "weights": weights,
            "amp": amp,
            "patient_batch": patient_batch,
            "num_workers": num_workers,
            "pin_memory": pin_memory,
            "image_size": image_size,
            "num_classes": num_classes,
            "target_batches": target_batches,
        },
        "total_batches_attempted": total_attempted,
        "success_batches": success,
        "oom": oom,
        "nan_detected": nan_detected,
        "nan_at_batch": nan_at_batch,
        "first_batch_ms": first_batch_ms,
        "p50_gpu_ms": round(p50, 3),
        "p95_gpu_ms": round(p95, 3),
        "peak_vram_mb": peak_vram_mb,
        "batch_timings": batch_timings,
    }


class _FakeDataset:
    """Placeholder — the real DataLoaderFactory ignores this."""

    pass


__all__ = ["run_t4_stability"]
