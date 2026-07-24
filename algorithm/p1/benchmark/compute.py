"""Compute-benchmark core for P1-01c (Part A: pure GPU).

Split into two layers:

- **Pure measurement logic** (``measure_config``, ``run_compute_sweep``,
  ``is_oom_error``, ``ConfigResult``): no CUDA, fully unit-testable with
  injected clock / memory-probe / step fakes. This is where OOM capture,
  percentile timing, throughput, and the "stop larger batches after OOM"
  policy live.
- **Real CUDA step builder** (``build_cuda_step``, ``CudaMemoryProbe``):
  constructs the E3 model on GPU and returns a closure doing
  forward + BCE + backward + GradScaler + AdamW step + zero_grad under AMP.
  Exercised only by the explicit CLI benchmark run, never by CI unit tests.

Measurement protocol per config: build model/optimizer, warm up N steps,
``reset_peak_memory_stats``, measure M steps, ``synchronize`` around timing.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Callable, Protocol, Sequence

# ---- Result type ------------------------------------------------------------


@dataclass(frozen=True)
class ConfigResult:
    backbone: str
    weights: str
    input_size: int
    patient_batch_size: int
    encoder_image_batch_size: int
    amp: bool
    steps: int
    stable: bool
    oom: bool
    start_free_vram_mb: int
    peak_allocated_mb: int
    peak_reserved_mb: int
    free_vram_after_step_mb: int
    step_time_p50_ms: float
    step_time_p95_ms: float
    patients_per_second: float
    images_per_second: float


def result_to_dict(res: ConfigResult) -> dict:
    return asdict(res)


# ---- Memory probe protocol --------------------------------------------------


class MemoryProbe(Protocol):
    def start_free_mb(self) -> int: ...
    def reset_peak(self) -> None: ...
    def peak_allocated_mb(self) -> int: ...
    def peak_reserved_mb(self) -> int: ...
    def free_mb(self) -> int: ...


@dataclass
class FakeMemoryProbe:
    """Injected memory probe for unit tests."""

    start_free_mb_v: int
    peak_alloc_mb_v: int
    peak_reserved_mb_v: int
    free_after_mb_v: int

    # positional compatibility: FakeMemoryProbe(7000, 100, 200, 6000)
    def __init__(self, start_free_mb, peak_alloc_mb, peak_reserved_mb, free_after_mb):
        self.start_free_mb_v = start_free_mb
        self.peak_alloc_mb_v = peak_alloc_mb
        self.peak_reserved_mb_v = peak_reserved_mb
        self.free_after_mb_v = free_after_mb

    def start_free_mb(self) -> int:
        return self.start_free_mb_v

    def reset_peak(self) -> None:
        return None

    def peak_allocated_mb(self) -> int:
        return self.peak_alloc_mb_v

    def peak_reserved_mb(self) -> int:
        return self.peak_reserved_mb_v

    def free_mb(self) -> int:
        return self.free_after_mb_v


# ---- OOM detection ----------------------------------------------------------

_OOM_MARKERS = (
    "out of memory",
    "cublas_status_alloc_failed",
    "cuda error: out of memory",
    "cudnn_status_alloc_failed",
)


def is_oom_error(exc: BaseException) -> bool:
    """True if ``exc`` looks like a CUDA out-of-memory / allocation failure."""
    if not isinstance(exc, RuntimeError):
        return False
    msg = str(exc).lower()
    return any(marker in msg for marker in _OOM_MARKERS)


# ---- Percentiles (no numpy dependency in the hot path) ----------------------


def _percentile(sorted_vals: Sequence[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    # Linear interpolation on the sorted sample (matches numpy default).
    rank = pct / 100.0 * (len(sorted_vals) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


# ---- Single-config measurement ---------------------------------------------


def measure_config(
    *,
    backbone: str,
    weights: str,
    input_size: int,
    patient_batch: int,
    step_fn: Callable[[], None],
    warmup: int,
    measure: int,
    clock: Callable[[], float],
    mem: MemoryProbe,
    sync: Callable[[], None],
    amp: bool,
) -> ConfigResult:
    """Measure one (backbone, patient_batch) config.

    ``step_fn`` performs one full train step (fwd+loss+bwd+opt). A CUDA-OOM
    raised by it is captured as ``oom=True``; any other error propagates.
    ``clock`` is called twice per measured step (start/end); timing is
    bracketed by ``sync`` to force GPU completion.
    """
    start_free = mem.start_free_mb()
    encoder_image_batch = patient_batch * 2

    def _oom_result() -> ConfigResult:
        return ConfigResult(
            backbone=backbone,
            weights=weights,
            input_size=input_size,
            patient_batch_size=patient_batch,
            encoder_image_batch_size=encoder_image_batch,
            amp=amp,
            steps=0,
            stable=False,
            oom=True,
            start_free_vram_mb=start_free,
            peak_allocated_mb=mem.peak_allocated_mb(),
            peak_reserved_mb=mem.peak_reserved_mb(),
            free_vram_after_step_mb=mem.free_mb(),
            step_time_p50_ms=0.0,
            step_time_p95_ms=0.0,
            patients_per_second=0.0,
            images_per_second=0.0,
        )

    # Warm-up.
    try:
        for _ in range(warmup):
            step_fn()
        sync()
    except Exception as exc:  # noqa: BLE001
        if is_oom_error(exc):
            return _oom_result()
        raise

    mem.reset_peak()

    # Measured steps.
    times_ms: list[float] = []
    try:
        for _ in range(measure):
            sync()
            t0 = clock()
            step_fn()
            sync()
            t1 = clock()
            times_ms.append((t1 - t0) * 1000.0)
    except Exception as exc:  # noqa: BLE001
        if is_oom_error(exc):
            return _oom_result()
        raise

    times_sorted = sorted(times_ms)
    p50 = _percentile(times_sorted, 50)
    p95 = _percentile(times_sorted, 95)
    mean_s = (sum(times_ms) / len(times_ms)) / 1000.0 if times_ms else 0.0
    pps = (patient_batch / mean_s) if mean_s > 0 else 0.0

    return ConfigResult(
        backbone=backbone,
        weights=weights,
        input_size=input_size,
        patient_batch_size=patient_batch,
        encoder_image_batch_size=encoder_image_batch,
        amp=amp,
        steps=measure,
        stable=True,
        oom=False,
        start_free_vram_mb=start_free,
        peak_allocated_mb=mem.peak_allocated_mb(),
        peak_reserved_mb=mem.peak_reserved_mb(),
        free_vram_after_step_mb=mem.free_mb(),
        step_time_p50_ms=p50,
        step_time_p95_ms=p95,
        patients_per_second=pps,
        images_per_second=pps * 2.0,
    )


def _skipped_after_oom(backbone, weights, input_size, patient_batch, amp) -> ConfigResult:
    return ConfigResult(
        backbone=backbone,
        weights=weights,
        input_size=input_size,
        patient_batch_size=patient_batch,
        encoder_image_batch_size=patient_batch * 2,
        amp=amp,
        steps=0,
        stable=False,
        oom=True,
        start_free_vram_mb=0,
        peak_allocated_mb=0,
        peak_reserved_mb=0,
        free_vram_after_step_mb=0,
        step_time_p50_ms=0.0,
        step_time_p95_ms=0.0,
        patients_per_second=0.0,
        images_per_second=0.0,
    )


def run_compute_sweep(
    *,
    backbones: Sequence[tuple[str, str, int]],  # (name, weights_str, input_size)
    patient_batches: Sequence[int],
    make_step: Callable[[str, int], Callable[[], None]],
    warmup: int,
    measure: int,
    clock_factory: Callable[[], Callable[[], float]],
    mem_factory: Callable[[], MemoryProbe],
    sync: Callable[[], None],
    repeats: int = 1,
    amp: bool = True,
) -> list[ConfigResult]:
    """Sweep every (backbone × patient_batch), stopping larger batches for a
    backbone once a deterministic OOM is hit.

    ``make_step(backbone, patient_batch)`` builds the model+optimizer and
    returns the per-step closure. ``repeats`` re-measures stable configs
    (only the last measurement is kept per config here; the CLI aggregates
    repeat stability separately).
    """
    results: list[ConfigResult] = []
    for backbone, weights, input_size in backbones:
        oomed = False
        for pb in sorted(patient_batches):
            if oomed:
                results.append(_skipped_after_oom(backbone, weights, input_size, pb, amp))
                continue
            last: ConfigResult | None = None
            for _ in range(max(1, repeats)):
                step = make_step(backbone, pb)
                last = measure_config(
                    backbone=backbone,
                    weights=weights,
                    input_size=input_size,
                    patient_batch=pb,
                    step_fn=step,
                    warmup=warmup,
                    measure=measure,
                    clock=clock_factory(),
                    mem=mem_factory(),
                    sync=sync,
                    amp=amp,
                )
                if last.oom:
                    break
            assert last is not None
            results.append(last)
            if last.oom:
                oomed = True
    return results
