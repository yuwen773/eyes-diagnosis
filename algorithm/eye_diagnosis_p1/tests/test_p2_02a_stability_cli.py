"""Tests for the P2-02A CLI bridge (T1.2 architectural repair).

The CLI's ``_RealDataLoaderFactory`` must:

1. Build a ``rows`` list from the frozen manifest + fold assignment
   (each row: ``left_image_relpath``, ``right_image_relpath``, ``labels``).
2. Hand ``rows`` to ``p1.benchmark.cuda_runtime.BilateralEyeDataset`` (the
   only place that class exists in the repo).
3. Wrap the resulting DataLoader so the 4-tuple ``(left, right, labels,
   cpu_ms)`` is unwrapped to the 3-tuple ``(left, right, labels)`` the
   probe expects.

These tests are CPU-only: they exercise the row builder directly and
stub the torch / dataset / DataLoader stack so the bridge logic can be
asserted without a GPU.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _make_manifest(n: int = 12) -> pd.DataFrame:
    """Build a synthetic 12-row patient manifest with 8 label columns."""
    rows = []
    for i in range(n):
        rows.append(
            {
                "patient_id": str(i),
                "left_image_relpath": f"Training_Dataset/{i}_left.jpg",
                "right_image_relpath": f"Training_Dataset/{i}_right.jpg",
                "age": 50,
                "sex": "M",
                "label_N": 1 if i % 8 == 0 else 0,
                "label_D": 1 if i % 8 == 1 else 0,
                "label_G": 1 if i % 8 == 2 else 0,
                "label_C": 1 if i % 8 == 3 else 0,
                "label_A": 1 if i % 8 == 4 else 0,
                "label_H": 1 if i % 8 == 5 else 0,
                "label_M": 1 if i % 8 == 6 else 0,
                "label_O": 1 if i % 8 == 7 else 0,
            }
        )
    return pd.DataFrame(rows)


def _make_fold_assignment(n: int = 12) -> dict[str, int]:
    """Two folds: first 5 -> fold 0, next 5 -> fold 1, last 2 -> fold 0."""
    return {str(i): (0 if i < 5 else 1 if i < 10 else 0) for i in range(n)}


# ---------------------------------------------------------------------------
# Test 1: row builder filters manifest to the chosen fold
# ---------------------------------------------------------------------------


def test_build_rows_for_fold_filters_manifest_to_fold() -> None:
    """build_rows_for_fold returns only the rows whose patient_id is in fold."""
    from p1.stability.cli import build_rows_for_fold

    manifest = _make_manifest(n=12)
    fold = _make_fold_assignment(n=12)
    rows = build_rows_for_fold(manifest, fold=0, fold_assignment=fold)
    pids = sorted(r["patient_id"] for r in rows)
    # sorted() is lexicographic on strings: '10' < '2'.
    assert pids == ["0", "1", "10", "11", "2", "3", "4"]


# ---------------------------------------------------------------------------
# Test 2: row schema matches BilateralEyeDataset contract
# ---------------------------------------------------------------------------


def test_build_rows_for_fold_row_schema() -> None:
    """Each row has 'left_image_relpath', 'right_image_relpath', 'labels' (8 floats)."""
    from p1.stability.cli import build_rows_for_fold

    manifest = _make_manifest(n=12)
    fold = _make_fold_assignment(n=12)
    rows = build_rows_for_fold(manifest, fold=1, fold_assignment=fold)
    assert len(rows) == 5
    for row in rows:
        assert set(row.keys()) == {"patient_id", "left_image_relpath", "right_image_relpath", "labels"}
        assert row["left_image_relpath"].endswith("_left.jpg")
        assert row["right_image_relpath"].endswith("_right.jpg")
        assert isinstance(row["labels"], list)
        assert len(row["labels"]) == 8
        assert all(isinstance(x, float) for x in row["labels"])


# ---------------------------------------------------------------------------
# Test 3: empty fold returns empty list
# ---------------------------------------------------------------------------


def test_build_rows_for_fold_empty_fold() -> None:
    """A fold with no patients yields an empty list, not an error."""
    from p1.stability.cli import build_rows_for_fold

    manifest = _make_manifest(n=12)
    fold = _make_fold_assignment(n=12)
    rows = build_rows_for_fold(manifest, fold=4, fold_assignment=fold)
    assert rows == []


# ---------------------------------------------------------------------------
# Test 4: collate stacks a list of per-item samples into batched tensors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bsize", [1, 2, 4, 8])
def test_collate_bilateral_batch_stacks_multi_item_batches(bsize: int) -> None:
    """Regression: the DataLoader collate_fn ALWAYS receives a list of B
    per-item samples (each the dataset's 4-tuple), for B >= 1.

    The frozen matrix (p1.stability.matrix) uses batch sizes 1, 2, 4, 8
    across cells A-F. The collate must stack every component into a leading
    batch dim of size B and drop cpu_ms, yielding (left, right, labels) with
    shapes [B,3,H,W], [B,3,H,W], [B,num_classes].

    Before the fix, batch_size==1 (cells A/B) worked but 2/4/8 (cells C-F)
    either under-unpacked ("expected 3, got 2"), collapsed to B=1 (cell D
    shape assert), or over-unpacked ("too many values to unpack").
    """
    import torch

    from p1.stability.cli import _collate_bilateral_batch

    # Distinct per-sample content so a silent "keep only item 0" regression
    # (the old cell-D path) would corrupt the stacked values, not just shapes.
    batch = [
        (
            torch.full((3, 8, 8), float(i)),
            torch.full((3, 8, 8), float(i) + 100.0),
            torch.full((8,), float(i) + 200.0),
            float(i),  # cpu_ms, must be dropped
        )
        for i in range(bsize)
    ]
    out = _collate_bilateral_batch(batch)
    assert len(out) == 3, "collate must return a 3-tuple (left, right, labels)"
    left, right, labels = out
    assert left.shape == (bsize, 3, 8, 8)
    assert right.shape == (bsize, 3, 8, 8)
    assert labels.shape == (bsize, 8)
    # Order and content preserved per sample (not collapsed to item 0).
    for i in range(bsize):
        assert torch.all(left[i] == float(i))
        assert torch.all(right[i] == float(i) + 100.0)
        assert torch.all(labels[i] == float(i) + 200.0)


# ---------------------------------------------------------------------------
# Test 5: _RealDataLoaderFactory imports from p1.benchmark.cuda_runtime
# ---------------------------------------------------------------------------


def test_real_dataloader_factory_uses_benchmark_dataset() -> None:
    """The factory must import BilateralEyeDataset from p1.benchmark.cuda_runtime,
    not from p1.training.datasets (which does not have it)."""

    # Stub: prevent torch / PIL / etc. from being loaded by the dataset module.
    # We only need to verify the import path the factory uses.
    from p1.stability import cli

    src = Path(cli.__file__).read_text(encoding="utf-8")
    assert "from p1.benchmark.cuda_runtime import BilateralEyeDataset" in src, (
        "CLI must import BilateralEyeDataset from p1.benchmark.cuda_runtime"
    )
    assert "from p1.training.datasets import BilateralEyeDataset" not in src, (
        "CLI must NOT import from p1.training.datasets (BilateralEyeDataset does not exist there)"
    )


# ---------------------------------------------------------------------------
# Test 6: factory's __call__ reads the fold assignment path attribute
# ---------------------------------------------------------------------------


def test_real_dataloader_factory_call_reads_fold_assignment_path() -> None:
    """The factory stores fold_assignment_path and reads it as self.fold_assignment_path.

    Regression test for the bug where the dataclass field was named
    ``fold_assignment_path`` but ``__call__`` read ``self._fold_assignment_path``
    (with leading underscore). The attribute access failed at runtime; the
    probe's ``dataloader_create`` stage then short-circuited with AttributeError.
    """
    from p1.stability import cli

    # 1. The __call__ method must reference self.fold_assignment_path
    # (without underscore), matching the dataclass field name.
    src = Path(cli.__file__).read_text(encoding="utf-8")
    assert "self.fold_assignment_path" in src, (
        "__call__ must read self.fold_assignment_path (matches dataclass field name)"
    )
    assert "self._fold_assignment_path" not in src, (
        "__call__ must NOT read self._fold_assignment_path (no such attribute)"
    )

    # 2. Building a factory and inspecting the dataclass fields confirms
    # the attribute exists and is named correctly.
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(cli._RealDataLoaderFactory)}
    assert "fold_assignment_path" in field_names
    assert "_fold_assignment_path" not in field_names


# ---------------------------------------------------------------------------
# Test 7: CLI passes a real AdamW optimizer_factory to build_probe
# ---------------------------------------------------------------------------


def test_cli_passes_optimizer_factory_to_build_probe() -> None:
    """The CLI must construct build_probe with an ``optimizer_factory`` kwarg.

    If no optimizer_factory is passed, the probe installs a no-op
    ``_NullOptimizer`` that has no ``step`` method, and the
    ``optimizer_step`` stage crashes on the real-CUDA run.
    """
    from p1.stability import cli

    src = Path(cli.__file__).read_text(encoding="utf-8")
    # The 'main' function must include optimizer_factory in its build_probe call.
    assert "optimizer_factory=" in src, (
        "CLI must pass optimizer_factory=... to build_probe (probe's _NullOptimizer has no .step())"
    )


def test_make_real_optimizer_factory_returns_adamw() -> None:
    """The factory must build a torch.optim.AdamW with frozen config.

    Per the project memory (p2-02-pipeline-and-first-round-config):
    AdamW, lr=1e-4, weight_decay=1e-4. The factory takes a model and
    returns an AdamW instance with lr=1e-4 and weight_decay=1e-4.
    """
    from p1.stability.cli import make_real_optimizer_factory

    import torch

    model = torch.nn.Linear(8, 1)
    factory = make_real_optimizer_factory()
    optimizer = factory(model)
    assert isinstance(optimizer, torch.optim.AdamW)
    assert optimizer.defaults["lr"] == 1e-4
    assert optimizer.defaults["weight_decay"] == 1e-4
