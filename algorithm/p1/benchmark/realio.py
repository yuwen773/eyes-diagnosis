"""Real-data I/O benchmark for P1-01c (Part B).

Two layers, same pattern as the compute benchmark:

- **Pure logic** (``dataloader_configs``, ``IoStageTiming``,
  ``io_result_to_dict``): the DataLoader config matrix with its
  workers==0 ⇒ persistent==False constraint, and the staged-timing result
  schema. CPU-testable, no torch import required at module top level for
  these (torch is imported lazily by the runner).
- **Real runner** (``BilateralEyeDataset``, ``run_io_config``): builds a
  Dataset over the fixed 128 Dev patients, decodes real JPEGs through the
  frozen deterministic preprocessing, and measures staged timings
  (dataloader wait / cpu preprocess / H2D / gpu step / end-to-end).
  Exercised only by the explicit CLI run.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import product
from typing import Sequence


# ---- Result schema ----------------------------------------------------------


@dataclass(frozen=True)
class IoStageTiming:
    num_workers: int
    pin_memory: bool
    persistent_workers: bool
    steps: int
    dataloader_wait_ms: float
    cpu_preprocess_ms: float
    host_to_device_ms: float
    gpu_step_ms: float
    end_to_end_step_ms: float
    end_to_end_patients_per_second: float
    gpu_patients_per_second: float
    oom: bool
    stable: bool


IO_RESULT_FIELDS = set(IoStageTiming.__dataclass_fields__.keys())


def io_result_to_dict(t: IoStageTiming) -> dict:
    return asdict(t)


# ---- Config matrix ----------------------------------------------------------


def dataloader_configs(
    *,
    num_workers: Sequence[int],
    pin_memory: Sequence[bool],
    persistent_workers: Sequence[bool],
) -> list[dict]:
    """Enumerate valid DataLoader configs.

    Constraint: ``num_workers == 0`` forbids ``persistent_workers == True``
    (PyTorch raises otherwise). Such combinations are dropped.
    """
    out: list[dict] = []
    for nw, pin, persist in product(num_workers, pin_memory, persistent_workers):
        if nw == 0 and persist:
            continue
        out.append(
            {"num_workers": nw, "pin_memory": pin, "persistent_workers": persist}
        )
    return out
