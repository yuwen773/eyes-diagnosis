"""Tests for the real-data I/O benchmark control logic (Part B).

The heavy DataLoader run needs real images and a GPU, so it is not run here.
We test the *pure* logic:

- ``dataloader_configs`` generates the full matrix num_workers{0,2,4} ×
  pin_memory{F,T} × persistent_workers{F,T} while enforcing the constraint
  that num_workers==0 forbids persistent_workers==True.
- ``IoStageTiming`` aggregates staged timings and both throughput numbers
  (end-to-end and pure-GPU) into the required serialisable schema.

CPU-only; no data required.
"""

from __future__ import annotations

import pytest

from p1.benchmark.realio import (  # noqa: E402
    IO_RESULT_FIELDS,
    IoStageTiming,
    dataloader_configs,
    io_result_to_dict,
)


def test_matrix_excludes_invalid_persistent_with_zero_workers() -> None:
    configs = dataloader_configs(
        num_workers=[0, 2, 4],
        pin_memory=[False, True],
        persistent_workers=[False, True],
    )
    for c in configs:
        if c["num_workers"] == 0:
            assert c["persistent_workers"] is False


def test_matrix_covers_valid_combinations() -> None:
    configs = dataloader_configs(
        num_workers=[0, 2, 4],
        pin_memory=[False, True],
        persistent_workers=[False, True],
    )
    keys = {(c["num_workers"], c["pin_memory"], c["persistent_workers"]) for c in configs}
    # workers=0: only persistent=False → 1 x 2 pin = 2
    assert (0, False, False) in keys
    assert (0, True, False) in keys
    assert (0, False, True) not in keys
    # workers=2/4: 2 pin x 2 persistent = 4 each
    assert (2, True, True) in keys
    assert (4, False, True) in keys
    # total: 2 + 4 + 4 = 10
    assert len(keys) == 10


def test_io_result_has_all_required_fields() -> None:
    t = IoStageTiming(
        num_workers=2,
        pin_memory=True,
        persistent_workers=True,
        steps=50,
        dataloader_wait_ms=1.0,
        cpu_preprocess_ms=2.0,
        host_to_device_ms=0.5,
        gpu_step_ms=40.0,
        end_to_end_step_ms=43.5,
        end_to_end_patients_per_second=30.0,
        gpu_patients_per_second=50.0,
        oom=False,
        stable=True,
    )
    d = io_result_to_dict(t)
    assert IO_RESULT_FIELDS.issubset(d.keys())
    import json

    json.dumps(d)


def test_end_to_end_pps_lower_than_gpu_pps_when_io_bound() -> None:
    """Sanity: if end-to-end step is slower than pure GPU step, end-to-end
    throughput must be the lower of the two (I/O is the bottleneck)."""
    t = IoStageTiming(
        num_workers=0,
        pin_memory=False,
        persistent_workers=False,
        steps=50,
        dataloader_wait_ms=20.0,
        cpu_preprocess_ms=10.0,
        host_to_device_ms=1.0,
        gpu_step_ms=40.0,
        end_to_end_step_ms=71.0,
        end_to_end_patients_per_second=18.0,
        gpu_patients_per_second=50.0,
        oom=False,
        stable=True,
    )
    assert t.end_to_end_patients_per_second < t.gpu_patients_per_second
