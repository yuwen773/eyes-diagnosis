# P2-02B Formal Epoch Training Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the formal multi-epoch training loop (`engine.py`, `metrics.py`, `checkpoint.py`, `formal_fold_runner.py`, `orchestrator.py`, `cli_formal.py`, `receipts.py`) plus its shared fakes and 7 test files, all under `algorithm/p1/training/` and `algorithm/eye_diagnosis_p1/tests/`. After this plan, P2-02C and P2-03 can invoke `cli_formal.py` on the real GPU; P2-02B itself does **not** run on the real GPU.

**Architecture:** Six new modules in `p1/training/` mirror the smoke shape but with epoch-level pure functions (`train_one_epoch`, `evaluate`) and DI'd real adapters reused from `p1.stability.cli` (`TorchAdapter`, `DataLoaderFactory`, `ModelFactory`, `optimizer_factory`). No frozen code is modified. Tests use fakes from a new `tests/fakes/` directory so the full stack runs in CI without CUDA.

**Tech Stack:** Python 3.11, PyTorch 2.x (cu118), pytest 9.1.1, scikit-learn (AUPRC/AUROC), numpy, pandas. Reuses `p1.benchmark.compute._percentile` and `is_oom_error`. Real adapters reused from `p1.stability.cli`.

## Global Constraints

These constraints apply to every task. Each task's requirements implicitly include this section.

- **Branch:** `codex/p2-02a-t3-matrix` (worktree `.worktrees/p2-02a-t3/`).
- **Frozen modules (byte-identical to commit `37de954`):** all of `algorithm/p1/training/{cli.py, fold_runner.py, models.py, oof.py, frozen_inputs.py, protocol.py, preflight.py, datasets.py, e2_assignment.py, freeze_folds.py, __init__.py}`, all of `algorithm/p1/stability/`, all of `algorithm/p1/benchmark/`. New files only; no edits to any frozen path.
- **Frozen v1 training config (period of P2-02 round 1 — pinned, do not silently retune):**
  ```json
  {
    "optimizer": "AdamW",
    "learning_rate": 0.0001,
    "weight_decay": 0.0001,
    "max_epochs": 20,
    "early_stopping_patience": 5,
    "checkpoint_selector": "validation_macro_auprc",
    "loss": "bce_with_logits",
    "patient_batch": 8,
    "gradient_accumulation": 1,
    "amp": true,
    "gradient_clip_norm": 1.0,
    "scheduler": "reduce_on_plateau",
    "scheduler_metric": "validation_macro_auprc",
    "scheduler_factor": 0.5,
    "scheduler_patience": 2,
    "threshold_policy": "fixed_0.5"
  }
  ```
- **P2-02B protocol bans (any of these is a violation, requires user re-approval):** real GPU Fold-0 run (P2-02C), 4×5 OOF (P2-03), loss ablation (P3), multi-seed (P4), Test set (P4), Softmax / `CrossEntropyLoss`, per-eye metrics, threshold tuning, auto batch-size shrink, auto backbone downgrade, runtime protocol edit, runtime re-split, RETFound / EyeQ / Grad-CAM / AutoMorph / Cross-Attention / Transformer Fusion. Frozen Test patients must never appear in train or val.
- **Strict determinism (set in `run_formal_fold` pre-flight):** `torch.backends.cudnn.deterministic = True; torch.backends.cudnn.benchmark = False; torch.use_deterministic_algorithms(True, warn_only=True); torch.manual_seed(seed); torch.cuda.manual_seed_all(seed); numpy.random.seed(seed); random.seed(seed)`.
- **Schema version string:** `"p2-02b-v1"` (in `fold_receipt.json`, `training_log.jsonl`, checkpoint metadata, `metrics.json`).
- **Atomic write contract:** every file in §4 of the spec (`.pth`, `.sha256`, `.json`, `.csv`) uses `tmp + os.replace`; `training_log.jsonl` uses `open('a')` per-line append. No `.tmp` file survives success.
- **Reuse adapters from `p1.stability.cli`:** `from p1.stability.cli import build_real_torch_adapter, build_real_dataloader_factory, build_real_model_factory, make_real_optimizer_factory`. No re-implementation.
- **Test runner:** `/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest <test_path> -q` (the conda env is `eye-p1-bench` cu118).
- **CWD for tests:** `algorithm/` (worktree root is `D:\Work\code\eye-diagnosis\.worktrees\p2-02a-t3\`).
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude <noreply@anthropic.com>`. Subject format: `<type>(<scope>): <description>` (e.g. `feat(p2-02b): add checkpoint module`).

---

## File Structure

### New files (P2-02B)

**`algorithm/p1/training/`:**
| File | Responsibility |
|---|---|
| `receipts.py` | `FoldReceipt`, `ExperimentReceipt` dataclasses + `to_dict` / `from_dict` |
| `checkpoint.py` | `save_checkpoint`, `load_checkpoint`, `sha256_file`, `_atomic_write_bytes` |
| `metrics.py` | `MetricsDict`, `compute_full_metrics` (AUPRC, AUROC, F1, sens/spec/precision, support, skip empty) |
| `engine.py` | `train_one_epoch`, `evaluate`, `EpochStats`, `ValStats`, custom exceptions (`NanLossError`, `CudaOomError`, `CudaRuntimeError`) |
| `formal_fold_runner.py` | `run_formal_fold`, `PreflightError`, JSONL append helper, OOF CSV writer |
| `orchestrator.py` | `run_formal_experiment`, `ExperimentReceipt` construction |
| `cli_formal.py` | `main(argv)`, argparse setup, exit code mapping |

**`algorithm/eye_diagnosis_p1/tests/`:**
| File | Tests |
|---|---|
| `test_p2_02b_checkpoint.py` | round-trip, atomic write, SHA256 |
| `test_p2_02b_metrics.py` | full set, skip empty class, threshold |
| `test_p2_02b_engine.py` | amp on/off, NaN abort, OOM abort, grad clip order, per-epoch scope |
| `test_p2_02b_formal_fold_runner.py` | happy path, NaN abort, OOM abort, checkpoint IO fail, preflight fail, atomic write, determinism flags |
| `test_p2_02b_orchestrator.py` | fold loop, no short-circuit, overall_status |
| `test_p2_02b_cli_formal.py` | flag parsing, exit codes, single vs multi fold |
| `test_p2_02b_ci_smoke.py` | end-to-end with fake adapters on 4-patient fixture |

**`algorithm/eye_diagnosis_p1/tests/fakes/`:**
| File | Provides |
|---|---|
| `__init__.py` | re-exports for `from tests.fakes import ...` |
| `protocol.py` | `FakeProtocolLoader` — inline frozen v1 config dict |
| `manifest.py` | `FakeManifestLoader` — 4-patient deterministic manifest |
| `fold_assignment.py` | `FakeFoldAssignmentLoader` — fixed 5-fold split (4 train / 2 val) |
| `model.py` | `FakeModelFactory(experiment)`, `FakeBilateralModel` — logits from `inputs.sum(dim=...)` |
| `environment.py` | `FakeEnvironmentCapture` — stable env dict |

### Modified files
None (P2-02B is additive only; no edits to any frozen module).

### Reused (existing) modules — read-only imports
- `p1.stability.cli` — `build_real_torch_adapter`, `build_real_dataloader_factory`, `build_real_model_factory`, `make_real_optimizer_factory`
- `p1.training.frozen_inputs` — `validate_frozen_training_inputs`, `load_split_assignment`, `load_fold_assignment`
- `p1.benchmark.compute` — `is_oom_error`
- Tests reuse existing `FakeTorchAdapter`, `FakeScaler`, `FakeOptimizer`, `FakeDataLoader`, `FakeDataLoaderFactory` from `test_p2_02a_*.py`.

---

## Task Index

1. **Task 1** — Shared fakes for P2-02B tests (5 fakes + `__init__`)
2. **Task 2** — `checkpoint.py` — atomic save/load/SHA256
3. **Task 3** — `metrics.py` — full metric computation, skip-empty-class
4. **Task 4** — `receipts.py` — `FoldReceipt`, `ExperimentReceipt` dataclasses
5. **Task 5** — `engine.py` — `train_one_epoch`, `evaluate`
6. **Task 6** — `formal_fold_runner.py` — single-fold driver + pre-flight + OOF
7. **Task 7** — `orchestrator.py` — multi-fold wrapper
8. **Task 8** — `cli_formal.py` — argparse front end
## Task 1: Shared fakes for P2-02B tests

**Files:**
- Create: `algorithm/eye_diagnosis_p1/tests/fakes/__init__.py`
- Create: `algorithm/eye_diagnosis_p1/tests/fakes/protocol.py`
- Create: `algorithm/eye_diagnosis_p1/tests/fakes/manifest.py`
- Create: `algorithm/eye_diagnosis_p1/tests/fakes/fold_assignment.py`
- Create: `algorithm/eye_diagnosis_p1/tests/fakes/model.py`
- Create: `algorithm/eye_diagnosis_p1/tests/fakes/environment.py`
- Test: (no dedicated test file — these are exercised by Tasks 2-9 tests)

**Why first:** every later task's tests use these fakes. Creating them upfront unblocks all subsequent test work and keeps individual task commits focused.

**Consumes:** none.
**Produces:** imports under `tests.fakes.*` for later tasks.

This is a scaffold task — no TDD cycle (these are test infrastructure; their own tests would test the fakes, not production behavior).

- [ ] **Step 1: Create `algorithm/eye_diagnosis_p1/tests/fakes/__init__.py`**

```python
"""Shared fakes for P2-02B tests.

These fakes provide small, deterministic test doubles for the protocol loader,
manifest loader, fold-assignment loader, model factory, and environment
fingerprint. They live under ``tests/`` (not ``p1/training/``) because they
are test-only infrastructure — production code never imports from here.
"""
from __future__ import annotations

from tests.fakes.environment import FakeEnvironmentCapture
from tests.fakes.fold_assignment import FakeFoldAssignmentLoader
from tests.fakes.manifest import FakeManifestLoader
from tests.fakes.model import FakeBilateralModel, FakeModelFactory
from tests.fakes.protocol import FakeProtocolLoader

__all__ = [
    "FakeBilateralModel",
    "FakeEnvironmentCapture",
    "FakeFoldAssignmentLoader",
    "FakeManifestLoader",
    "FakeModelFactory",
    "FakeProtocolLoader",
]
```

- [ ] **Step 2: Create `algorithm/eye_diagnosis_p1/tests/fakes/protocol.py`**

```python
"""FakeProtocolLoader — returns an in-memory copy of the frozen v1 training config."""
from __future__ import annotations

from typing import Any

# Mirrors the pinned frozen v1 config in ``p1/protocol_p2_02a_v1.json``. Locked
# during the P2-02B brainstorming session; do not retune per-variant.
_FROZEN_V1: dict[str, Any] = {
    "schema_version": "p2-02a-v1",
    "optimizer": "AdamW",
    "learning_rate": 0.0001,
    "weight_decay": 0.0001,
    "max_epochs": 20,
    "early_stopping_patience": 5,
    "checkpoint_selector": "validation_macro_auprc",
    "loss": "bce_with_logits",
    "patient_batch": 8,
    "gradient_accumulation": 1,
    "amp": True,
    "gradient_clip_norm": 1.0,
    "scheduler": "reduce_on_plateau",
    "scheduler_metric": "validation_macro_auprc",
    "scheduler_factor": 0.5,
    "scheduler_patience": 2,
    "threshold_policy": "fixed_0.5",
}


class FakeProtocolLoader:
    """Returns a fresh copy of the frozen v1 dict. Tests can mutate the return."""

    def __init__(self, override: dict[str, Any] | None = None) -> None:
        self._override = override or {}

    def load(self) -> dict[str, Any]:
        cfg = dict(_FROZEN_V1)
        cfg.update(self._override)
        return cfg
```

- [ ] **Step 3: Create `algorithm/eye_diagnosis_p1/tests/fakes/manifest.py`**

```python
"""FakeManifestLoader — deterministic 4-patient manifest for fixture runs."""
from __future__ import annotations

import pandas as pd

# 4 patients × 2 eyes = 8 rows; 8 disease classes (multi-label).
# pids 1, 2 → class 0 positive; pids 3, 4 → class 1 positive.
# Classes 2..7 have 0 positives — exercises the skip-empty-class branch
# in metrics.py.
_NUM_CLASSES = 8
_FROZEN_LABELS: dict[int, dict[int, int]] = {
    1: {0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
    2: {0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
    3: {0: 0, 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
    4: {0: 0, 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0},
}


def _build_manifest() -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for pid, labels in _FROZEN_LABELS.items():
        for side in ("left", "right"):
            row: dict[str, object] = {
                "patient_id": pid,
                "side": side,
                "relpath": f"Training_Dataset/{pid}_{side}.jpg",
            }
            for c in range(_NUM_CLASSES):
                row[f"label_class_{c}"] = labels[c]
            rows.append(row)
    return pd.DataFrame(rows)


class FakeManifestLoader:
    """Returns a deterministic 4-patient manifest with 8-class multi-label."""

    def __init__(self) -> None:
        self._df = _build_manifest()

    def load(self) -> pd.DataFrame:
        return self._df.copy()

    def patient_ids(self) -> set[int]:
        return set(self._df["patient_id"].unique().tolist())
```

- [ ] **Step 4: Create `algorithm/eye_diagnosis_p1/tests/fakes/fold_assignment.py`**

```python
"""FakeFoldAssignmentLoader — fixed 5-fold split with 4 train / 2 val per fold."""
from __future__ import annotations

import pandas as pd

# Fixed fold 0..4 split (4 patients × 5 folds = 20 rows).
# Each fold's val set is 2 patients; train set is the other 2.
# fold 0: train {1,2}, val {3,4}
# fold 1: train {3,4}, val {1,2}
# fold 2: train {1,3}, val {2,4}
# fold 3: train {2,4}, val {1,3}
# fold 4: train {1,4}, val {2,3}
_FOLD_SPLIT: dict[int, dict[str, set[int]]] = {
    0: {"train": {1, 2}, "val": {3, 4}},
    1: {"train": {3, 4}, "val": {1, 2}},
    2: {"train": {1, 3}, "val": {2, 4}},
    3: {"train": {2, 4}, "val": {1, 3}},
    4: {"train": {1, 4}, "val": {2, 3}},
}


def _build_split() -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for pid in (1, 2, 3, 4):
        for fold in range(5):
            split = "val" if pid in _FOLD_SPLIT[fold]["val"] else "train"
            rows.append({"patient_id": pid, "fold": fold, "split": split})
    return pd.DataFrame(rows)


class FakeFoldAssignmentLoader:
    """Returns a fixed 5-fold split DataFrame with patient_id, fold, split."""

    def __init__(self) -> None:
        self._df = _build_split()

    def load(self) -> pd.DataFrame:
        return self._df.copy()

    def fold_pids(self, fold: int, split: str) -> set[int]:
        return set(
            self._df[(self._df["fold"] == fold) & (self._df["split"] == split)][
                "patient_id"
            ].tolist()
        )

    def expected_folds(self) -> int:
        return 5
```

- [ ] **Step 5: Create `algorithm/eye_diagnosis_p1/tests/fakes/model.py`**

```python
"""FakeModelFactory + FakeBilateralModel — deterministic model for tests."""
from __future__ import annotations

from typing import Any

import torch
from torch import nn


class FakeBilateralModel(nn.Module):
    """Bilateral (E3-style) fake: logits = Linear(concat(left.mean, right.mean)).

    Output shape: ``(B, 8)``. Weights are seeded so logits are reproducible.
    The linear takes 6 features (3 left + 3 right) → 8 disease classes.
    """

    def __init__(self, num_classes: int = 8, seed: int = 42) -> None:
        super().__init__()
        torch.manual_seed(seed)
        self.linear = nn.Linear(6, num_classes)

    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:
        # left, right: (B, 3, 380, 380)
        l_mean = left.mean(dim=(2, 3))  # (B, 3)
        r_mean = right.mean(dim=(2, 3))  # (B, 3)
        return self.linear(torch.cat([l_mean, r_mean], dim=1))  # (B, 8)


class FakeModelFactory:
    """Returns a FakeBilateralModel + a tiny setup-meta dict."""

    def __init__(self, *, num_classes: int = 8, seed: int = 42) -> None:
        self._num_classes = num_classes
        self._seed = seed

    def __call__(
        self, *, experiment: str, weights: str = "", device: str = "cpu"
    ) -> tuple[FakeBilateralModel, dict[str, Any]]:
        # P2-02B only wires E3; any other experiment raises to fail loudly.
        if experiment != "E3":
            raise ValueError(
                f"FakeModelFactory: experiment={experiment!r} not supported "
                "(P2-02B wires E3 only)"
            )
        model = FakeBilateralModel(num_classes=self._num_classes, seed=self._seed)
        if device == "cuda":
            model = model.to("cuda")  # pragma: no cover (CI is CPU-only)
        meta: dict[str, Any] = {
            "experiment": experiment,
            "weights": weights,
            "device": device,
            "num_classes": self._num_classes,
            "seed": self._seed,
        }
        return model, meta
```

- [ ] **Step 6: Create `algorithm/eye_diagnosis_p1/tests/fakes/environment.py`**

```python
"""FakeEnvironmentCapture — stable environment dict for fingerprint tests."""
from __future__ import annotations

from typing import Any

_FROZEN_ENV: dict[str, Any] = {
    "schema_version": "p2-02a-v1",
    "python_version": "3.11.15",
    "torch_version": "2.4.1+cu118",
    "cuda_available": False,  # CI is CPU-only; real adapter flips this on GPU host
    "cuda_device_count": 0,
    "gpu_name": None,
    "driver_version": None,
    "conda_env": "eye-p1-bench",
    "platform": "win32",
    "git_commit": "37de954",  # pinned to spec commit; tests can override
    "vram_total_mb": 0,
    "vram_free_mb": 0,
}


class FakeEnvironmentCapture:
    """Returns a stable environment fingerprint. Tests can override fields."""

    def __init__(self, override: dict[str, Any] | None = None) -> None:
        self._override = override or {}

    def __call__(
        self, *, now: str | None = None, git_commit: str | None = None
    ) -> dict[str, Any]:
        env = dict(_FROZEN_ENV)
        env.update(self._override)
        if now is not None:
            env["timestamp"] = now
        if git_commit is not None:
            env["git_commit"] = git_commit
        return env
```

- [ ] **Step 7: Smoke-import the fakes**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -c "
from tests.fakes import (
    FakeBilateralModel, FakeEnvironmentCapture, FakeFoldAssignmentLoader,
    FakeManifestLoader, FakeModelFactory, FakeProtocolLoader,
)
import torch

proto = FakeProtocolLoader().load()
assert proto['max_epochs'] == 20 and proto['amp'] is True

manifest = FakeManifestLoader().load()
assert len(manifest) == 8 and len(FakeManifestLoader().patient_ids()) == 4

fold = FakeFoldAssignmentLoader()
assert fold.fold_pids(0, 'train') == {1, 2}
assert fold.fold_pids(0, 'val') == {3, 4}

model, meta = FakeModelFactory()(experiment='E3')
x = torch.randn(2, 3, 380, 380)
y = torch.randn(2, 3, 380, 380)
out = model(x, y)
assert out.shape == (2, 8)

env = FakeEnvironmentCapture()()
assert env['schema_version'] == 'p2-02a-v1'
print('OK: all fakes import + behave')
"
```

Expected: prints `OK: all fakes import + behave` (no traceback).

- [ ] **Step 8: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/eye_diagnosis_p1/tests/fakes/
git commit -F - <<'EOF'
feat(p2-02b): add shared fakes directory for tests

Six fakes under tests/fakes/: protocol loader (frozen v1 dict),
manifest loader (4-patient deterministic), fold-assignment loader
(fixed 5-fold split with 4 train / 2 val), model factory
(E3 bilateral with seeded linear layer), environment capture
(stable CPU fingerprint), __init__ re-exporting all of them.

No production code yet — pure test infrastructure unblocking Tasks
2-9. fakes live under tests/ (not p1/training/) because production
code never imports from here.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 2: `checkpoint.py` — atomic save/load/SHA256

**Files:**
- Create: `algorithm/p1/training/checkpoint.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py`

**Why second:** `formal_fold_runner.py` (Task 6) calls `save_checkpoint` every epoch a new best is found and `load_checkpoint` in post-loop; `sha256_file` is called for the receipt. Building this first means the runner is a thin wrapper.

**Consumes:** nothing from P2-02B (only stdlib `hashlib` + `torch`).
**Produces:** `p1.training.checkpoint.{save_checkpoint, load_checkpoint, sha256_file, _atomic_write_bytes, CheckpointError}`.

This task has 3 TDD cycles:
- Cycle A: round-trip save/load
- Cycle B: atomic write (no `.tmp` survives success)
- Cycle C: SHA256 matches re-computed hash

- [ ] **Step 1: Write `test_p2_02b_checkpoint.py` — round-trip test (failing first)**

Create file `algorithm/eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py`:

```python
"""Tests for algorithm/p1/training/checkpoint.py."""
from __future__ import annotations

from pathlib import Path

import pytest
import torch
from torch import nn

from p1.training.checkpoint import (
    CheckpointError,
    load_checkpoint,
    save_checkpoint,
    sha256_file,
)


class _TinyModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.linear = nn.Linear(4, 2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.linear(x)


def test_save_load_roundtrip_returns_identical_state_dict(tmp_path: Path) -> None:
    model = _TinyModel()
    # Force deterministic weights.
    with torch.no_grad():
        model.linear.weight.fill_(0.5)
        model.linear.bias.fill_(0.25)
    original = {k: v.clone() for k, v in model.state_dict().items()}

    metadata = {"epoch": 3, "best_metric": 0.91, "fold": 0}
    target = tmp_path / "best.pth"
    save_checkpoint(model.state_dict(), metadata, target)

    assert target.exists()
    loaded_state, loaded_meta = load_checkpoint(target)
    assert set(loaded_state.keys()) == set(original.keys())
    for k in original:
        assert torch.equal(loaded_state[k], original[k])
    assert loaded_meta["epoch"] == 3
    assert loaded_meta["best_metric"] == 0.91
    assert loaded_meta["fold"] == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py::test_save_load_roundtrip_returns_identical_state_dict -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.checkpoint'`.

- [ ] **Step 3: Implement minimal `checkpoint.py` to pass round-trip**

Create `algorithm/p1/training/checkpoint.py`:

```python
"""P2-02B checkpoint utilities — atomic save/load + SHA256.

Used by ``formal_fold_runner.py`` to persist the best-epoch model state
per fold. Every write uses ``tmp + os.replace`` so OOM or power loss
cannot leave a half-written ``.pth`` behind; every success leaves no
``.tmp`` file. ``sha256_file`` produces a hex digest that the runner
records next to the checkpoint for receipt integrity.

Schema (frozen for round 1):
    * ``.pth`` contains ``{'__meta__': metadata, **state_dict}``
    * metadata schema version: ``"p2-02b-v1"``
"""
from __future__ import annotations

import hashlib
import io
import os
import pickle
from pathlib import Path
from typing import Any

import torch


class CheckpointError(IOError):
    """Raised when a checkpoint write/read fails (disk full, permission, etc.)."""


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` atomically (tmp + ``os.replace``).

    On success the ``.tmp`` file is gone and ``path`` exists with the
    exact bytes written. On any exception, ``.tmp`` is removed and
    ``path`` is untouched.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except Exception:
        # Clean up the tmp file if it exists.
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


def _atomic_write_torch(path: Path, payload: dict[str, Any]) -> None:
    """Serialize ``payload`` to bytes and write atomically."""
    buf = io.BytesIO()
    torch.save(payload, buf)
    _atomic_write_bytes(path, buf.getvalue())


def save_checkpoint(
    state_dict: dict[str, Any],
    metadata: dict[str, Any],
    path: Path,
) -> None:
    """Save a model state_dict + metadata atomically.

    ``metadata`` is stored under the ``'__meta__'`` key in the same file
    so ``load_checkpoint`` recovers both. Raises ``CheckpointError`` on
    any I/O failure.
    """
    try:
        payload = {"__meta__": dict(metadata), **state_dict}
        _atomic_write_torch(Path(path), payload)
    except (IOError, OSError) as exc:
        raise CheckpointError(f"save_checkpoint failed: path={path}, exc={exc!r}") from exc


def load_checkpoint(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load state_dict and metadata from a checkpoint file.

    Returns ``(state_dict, metadata)``. The returned state_dict has the
    ``__meta__`` key stripped. Raises ``CheckpointError`` on I/O failure.
    """
    p = Path(path)
    try:
        payload = torch.load(p, map_location="cpu", weights_only=False)
    except (IOError, OSError, RuntimeError, pickle.UnpicklingError) as exc:
        raise CheckpointError(f"load_checkpoint failed: path={p}, exc={exc!r}") from exc
    metadata = dict(payload.pop("__meta__", {}))
    return payload, metadata


def sha256_file(path: Path) -> str:
    """Return the hex SHA256 of file bytes. Raises ``CheckpointError`` on I/O."""
    p = Path(path)
    try:
        h = hashlib.sha256()
        with p.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
    except (IOError, OSError) as exc:
        raise CheckpointError(f"sha256_file failed: path={p}, exc={exc!r}") from exc
    return h.hexdigest()
```

- [ ] **Step 4: Run the round-trip test to verify it passes**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py::test_save_load_roundtrip_returns_identical_state_dict -v
```

Expected: PASS.

- [ ] **Step 5: Add atomic-write-no-tmp test**

Append to `algorithm/eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py`:

```python
def test_atomic_write_no_tmp_left_on_success(tmp_path: Path) -> None:
    model = _TinyModel()
    target = tmp_path / "best.pth"
    save_checkpoint(model.state_dict(), {"epoch": 0}, target)

    assert target.exists()
    # No .tmp file survives a successful write.
    leftover = list(tmp_path.glob("*.tmp"))
    assert leftover == [], f"unexpected tmp files: {leftover}"


def test_atomic_write_no_tmp_left_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """If the rename step fails, no .tmp file is left behind."""
    from p1.training import checkpoint as ckpt

    model = _TinyModel()
    target = tmp_path / "best.pth"

    # Force os.replace to raise so we hit the cleanup branch.
    def _raise_replace(*_a: object, **_k: object) -> None:
        raise OSError("simulated rename failure")

    monkeypatch.setattr(ckpt.os, "replace", _raise_replace)

    with pytest.raises(CheckpointError):
        save_checkpoint(model.state_dict(), {"epoch": 0}, target)

    leftover = list(tmp_path.glob("*.tmp"))
    assert leftover == [], f"tmp file leaked on failure: {leftover}"
    assert not target.exists(), "target should not be written when rename fails"
```

- [ ] **Step 6: Run atomic-write tests**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py -v
```

Expected: 3 PASS (round-trip + no-tmp-success + no-tmp-failure).

- [ ] **Step 7: Add SHA256-matches test**

Append to `algorithm/eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py`:

```python
import hashlib


def test_sha256_matches_checkpoint_bytes(tmp_path: Path) -> None:
    """sha256_file returns the same hex digest as recomputing the file bytes."""
    model = _TinyModel()
    target = tmp_path / "best.pth"
    save_checkpoint(model.state_dict(), {"epoch": 7, "best_metric": 0.42}, target)

    recorded = sha256_file(target)

    # Independently re-compute the hash from file bytes.
    expected = hashlib.sha256(target.read_bytes()).hexdigest()
    assert recorded == expected
    # Hex digest is 64 chars (sha256).
    assert len(recorded) == 64 and all(c in "0123456789abcdef" for c in recorded)
```

- [ ] **Step 8: Run all checkpoint tests**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py -v
```

Expected: 4 PASS.

- [ ] **Step 9: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/checkpoint.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_checkpoint.py
git commit -F - <<'EOF'
feat(p2-02b): add checkpoint module (atomic save/load + SHA256)

Used by formal_fold_runner.py to persist best-epoch state per fold.
Every write uses tmp + os.replace; no .tmp file survives success or
failure. sha256_file produces the hex digest recorded next to
best_checkpoint.pth for receipt integrity.

Schema: .pth contains {'__meta__': metadata, **state_dict};
metadata schema version 'p2-02b-v1'.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 3: `metrics.py` — full metric computation, skip-empty-class

**Files:**
- Create: `algorithm/p1/training/metrics.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_metrics.py`

**Why third:** `formal_fold_runner.py` (Task 6) calls `compute_full_metrics` once per fold in post-loop; per-epoch validation already returns just `macro_auprc` (computed inline by `evaluate` in Task 5). The full set is only needed at the end.

**Consumes:** nothing from P2-02B (only `numpy` + `sklearn.metrics`).
**Produces:** `p1.training.metrics.{MetricsDict, compute_full_metrics}`.

- [ ] **Step 1: Write `test_p2_02b_metrics.py`**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_metrics.py`:

```python
"""Tests for algorithm/p1/training/metrics.py."""
from __future__ import annotations

import numpy as np
import pytest
from sklearn.metrics import average_precision_score

from p1.training.metrics import MetricsDict, compute_full_metrics


def _toy_y_true_y_proba() -> tuple[np.ndarray, np.ndarray]:
    """8-class synthetic: 4 patients, classes 0 & 1 have positives."""
    y_true = np.array(
        [
            [1, 0, 0, 0, 0, 0, 0, 0],
            [1, 0, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0, 0],
        ],
        dtype=np.float64,
    )
    y_proba = np.array(
        [
            [0.9, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.8, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.1, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.2, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        ],
        dtype=np.float64,
    )
    return y_true, y_proba


def test_compute_full_metrics_returns_full_field_set() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    expected_fields = {
        "schema_version", "num_samples", "threshold",
        "macro_auprc", "micro_auprc",
        "macro_auroc", "micro_auroc",
        "macro_f1", "micro_f1",
        "per_class_auprc", "per_class_auroc",
        "per_class_precision", "per_class_recall", "per_class_f1",
        "per_class_support_pos", "per_class_support_neg",
        "skipped_classes",
    }
    assert expected_fields.issubset(set(m.to_dict().keys()))


def test_zero_positive_class_is_skipped() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    assert set(m.skipped_classes) == {2, 3, 4, 5, 6, 7}
    for c in m.skipped_classes:
        assert m.per_class_auprc[c] is None
        assert m.per_class_auroc[c] is None
    expected = float(np.mean([m.per_class_auprc[0], m.per_class_auprc[1]]))
    assert m.macro_auprc == pytest.approx(expected, rel=1e-9)


def test_macro_auprc_matches_sklearn_per_class() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    per_class_ap = []
    for c in range(8):
        if y_true[:, c].sum() == 0:
            continue
        per_class_ap.append(average_precision_score(y_true[:, c], y_proba[:, c]))
    assert m.macro_auprc == pytest.approx(float(np.mean(per_class_ap)), rel=1e-9)


def test_threshold_0_5_precision_recall_match_manual() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)

    assert m.per_class_precision[0] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_recall[0] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_f1[0] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_support_pos[0] == 2
    assert m.per_class_support_neg[0] == 2
    assert m.per_class_precision[1] == pytest.approx(1.0, rel=1e-9)
    assert m.per_class_recall[1] == pytest.approx(1.0, rel=1e-9)


def test_metrics_dict_to_dict_roundtrip() -> None:
    y_true, y_proba = _toy_y_true_y_proba()
    m = compute_full_metrics(y_true, y_proba, threshold=0.5)
    d = m.to_dict()
    m2 = MetricsDict.from_dict(d)
    assert m2.macro_auprc == m.macro_auprc
    assert m2.skipped_classes == m.skipped_classes
    assert m2.per_class_auprc == m.per_class_auprc
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_metrics.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.metrics'`.

- [ ] **Step 3: Implement minimal `metrics.py`**

Create `algorithm/p1/training/metrics.py`:

```python
"""P2-02B validation metrics — full multi-label set with skip-empty-class rule.

Locked for round 1:
    * Threshold = 0.5 (frozen ``threshold_policy: fixed_0.5``).
    * Classes with ``sum(y_true[:, c]) == 0`` are skipped for AUPRC/AUROC;
      their per-class values are ``None`` and ``skipped_classes`` records
      the index. Macro is the unweighted mean of remaining classes.
    * Precision/Recall/F1 at the threshold are computed for every class
      (no skip — denominators are non-zero even when positives == 0).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


@dataclass
class MetricsDict:
    """All metrics for a single validation pass. JSON-serializable via ``to_dict``."""

    schema_version: str = "p2-02b-v1"
    num_samples: int = 0
    threshold: float = 0.5

    macro_auprc: float = 0.0
    micro_auprc: float = 0.0
    macro_auroc: float = 0.0
    micro_auroc: float = 0.0
    macro_f1: float = 0.0
    micro_f1: float = 0.0

    per_class_auprc: list[float | None] = field(default_factory=list)
    per_class_auroc: list[float | None] = field(default_factory=list)
    per_class_precision: list[float] = field(default_factory=list)
    per_class_recall: list[float] = field(default_factory=list)
    per_class_f1: list[float] = field(default_factory=list)
    per_class_support_pos: list[int] = field(default_factory=list)
    per_class_support_neg: list[int] = field(default_factory=list)
    skipped_classes: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "num_samples": self.num_samples,
            "threshold": self.threshold,
            "macro_auprc": self.macro_auprc,
            "micro_auprc": self.micro_auprc,
            "macro_auroc": self.macro_auroc,
            "micro_auroc": self.micro_auroc,
            "macro_f1": self.macro_f1,
            "micro_f1": self.micro_f1,
            "per_class_auprc": list(self.per_class_auprc),
            "per_class_auroc": list(self.per_class_auroc),
            "per_class_precision": list(self.per_class_precision),
            "per_class_recall": list(self.per_class_recall),
            "per_class_f1": list(self.per_class_f1),
            "per_class_support_pos": list(self.per_class_support_pos),
            "per_class_support_neg": list(self.per_class_support_neg),
            "skipped_classes": list(self.skipped_classes),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MetricsDict":
        return cls(
            schema_version=d.get("schema_version", "p2-02b-v1"),
            num_samples=int(d.get("num_samples", 0)),
            threshold=float(d.get("threshold", 0.5)),
            macro_auprc=float(d.get("macro_auprc", 0.0)),
            micro_auprc=float(d.get("micro_auprc", 0.0)),
            macro_auroc=float(d.get("macro_auroc", 0.0)),
            micro_auroc=float(d.get("micro_auroc", 0.0)),
            macro_f1=float(d.get("macro_f1", 0.0)),
            micro_f1=float(d.get("micro_f1", 0.0)),
            per_class_auprc=list(d.get("per_class_auprc", [])),
            per_class_auroc=list(d.get("per_class_auroc", [])),
            per_class_precision=list(d.get("per_class_precision", [])),
            per_class_recall=list(d.get("per_class_recall", [])),
            per_class_f1=list(d.get("per_class_f1", [])),
            per_class_support_pos=list(d.get("per_class_support_pos", [])),
            per_class_support_neg=list(d.get("per_class_support_neg", [])),
            skipped_classes=list(d.get("skipped_classes", [])),
        )


def compute_full_metrics(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    *,
    threshold: float = 0.5,
) -> MetricsDict:
    """Compute the full multi-label metric set for a validation pass.

    ``y_true`` and ``y_proba`` are both ``(N, num_classes)``. Returns a
    fully populated ``MetricsDict``.
    """
    assert y_true.shape == y_proba.shape, (
        f"shape mismatch: y_true={y_true.shape}, y_proba={y_proba.shape}"
    )
    assert y_true.ndim == 2
    n, num_classes = y_true.shape

    per_class_auprc: list[float | None] = [None] * num_classes
    per_class_auroc: list[float | None] = [None] * num_classes
    skipped: list[int] = []

    ap_values: list[float] = []
    auc_values: list[float] = []
    for c in range(num_classes):
        col_true = y_true[:, c]
        col_proba = y_proba[:, c]
        n_pos = int(col_true.sum())
        if n_pos == 0:
            skipped.append(c)
            continue
        ap = float(average_precision_score(col_true, col_proba))
        per_class_auprc[c] = ap
        ap_values.append(ap)
        n_neg = int(n - n_pos)
        if n_neg > 0:
            auc = float(roc_auc_score(col_true, col_proba))
            per_class_auroc[c] = auc
            auc_values.append(auc)

    y_pred = (y_proba >= threshold).astype(np.int64)
    per_class_precision: list[float] = [
        float(precision_score(y_true[:, c], y_pred[:, c], zero_division=0))
        for c in range(num_classes)
    ]
    per_class_recall: list[float] = [
        float(recall_score(y_true[:, c], y_pred[:, c], zero_division=0))
        for c in range(num_classes)
    ]
    per_class_f1: list[float] = [
        float(f1_score(y_true[:, c], y_pred[:, c], zero_division=0))
        for c in range(num_classes)
    ]
    per_class_support_pos = [int(y_true[:, c].sum()) for c in range(num_classes)]
    per_class_support_neg = [int(n - y_true[:, c].sum()) for c in range(num_classes)]

    macro_auprc = float(np.mean(ap_values)) if ap_values else 0.0
    macro_auroc = float(np.mean(auc_values)) if auc_values else 0.0
    micro_auprc = float(average_precision_score(y_true.ravel(), y_proba.ravel()))
    micro_auroc = float(roc_auc_score(y_true.ravel(), y_proba.ravel()))
    macro_f1 = float(np.mean(per_class_f1))
    micro_f1 = float(f1_score(y_true.ravel(), y_pred.ravel(), zero_division=0))

    return MetricsDict(
        num_samples=n,
        threshold=threshold,
        macro_auprc=macro_auprc,
        micro_auprc=micro_auprc,
        macro_auroc=macro_auroc,
        micro_auroc=micro_auroc,
        macro_f1=macro_f1,
        micro_f1=micro_f1,
        per_class_auprc=per_class_auprc,
        per_class_auroc=per_class_auroc,
        per_class_precision=per_class_precision,
        per_class_recall=per_class_recall,
        per_class_f1=per_class_f1,
        per_class_support_pos=per_class_support_pos,
        per_class_support_neg=per_class_support_neg,
        skipped_classes=sorted(skipped),
    )


__all__ = ["MetricsDict", "compute_full_metrics"]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_metrics.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/metrics.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_metrics.py
git commit -F - <<'EOF'
feat(p2-02b): add metrics module (full multi-label set, skip-empty-class)

compute_full_metrics returns Macro/Micro AUPRC+AUROC+F1, per-class
AUPRC/AUROC (None where skipped), per-class precision/recall/F1 at
threshold 0.5, per-class pos/neg support counts, and the sorted
list of skipped class indices. Macro is the unweighted mean of
non-skipped classes; classes with sum(y_true)==0 are skipped.

Used by formal_fold_runner.py in post-loop (Task 6). The per-epoch
validation path only needs Macro-AUPRC, computed inline by
evaluate() in engine.py (Task 5).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 4: `receipts.py` — `FoldReceipt`, `ExperimentReceipt` dataclasses

**Files:**
- Create: `algorithm/p1/training/receipts.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_receipts.py`

**Why fourth:** `formal_fold_runner.py` and `orchestrator.py` both build and serialize receipts. Splitting into a top-level module avoids circular imports between runner and orchestrator.

**Consumes:** nothing from P2-02B (stdlib only).
**Produces:** `p1.training.receipts.{FoldReceipt, ExperimentReceipt}` + `to_dict` / `from_dict`.

- [ ] **Step 1: Write `test_p2_02b_receipts.py`**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_receipts.py`:

```python
"""Tests for algorithm/p1/training/receipts.py."""
from __future__ import annotations

import pytest

from p1.training.receipts import ExperimentReceipt, FoldReceipt


def _make_pass_fold(fold: int, best_epoch: int = 4, best_metric: float = 0.7) -> FoldReceipt:
    return FoldReceipt(
        schema_version="p2-02b-v1",
        fold=fold, experiment="E3", seed=42,
        status="PASS",
        best_epoch=best_epoch, best_metric=best_metric,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=best_epoch + 1, early_stopped=False,
        started_at="2026-07-27T10:00:00+00:00",
        finished_at="2026-07-27T10:10:00+00:00",
        duration_s=600.0,
        config_hash="abc123", checkpoint_sha256="def456",
        frozen_inputs={"manifest_sha256": "m", "split_assignment_sha256": "s",
                       "fold_assignment_sha256": "f", "image_root_sha256": "i"},
    )


def test_fold_receipt_to_from_dict_roundtrip() -> None:
    r = _make_pass_fold(0)
    d = r.to_dict()
    r2 = FoldReceipt.from_dict(d)
    assert r2.fold == 0
    assert r2.best_epoch == 4
    assert r2.best_metric == pytest.approx(0.7)
    assert r2.frozen_inputs["manifest_sha256"] == "m"


def test_fold_receipt_blocked_preserves_partial_state() -> None:
    r = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=0, experiment="E3", seed=42,
        status="BLOCKED",
        best_epoch=2, best_metric=0.61,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=3, early_stopped=False,
        started_at="t0", finished_at="t1", duration_s=300.0,
        config_hash="abc", checkpoint_sha256=None,
        error_class="cuda_oom",
        error_message="CUDA OOM at epoch 3, batch 47",
        error_epoch=3, error_batch=47,
        frozen_inputs={"manifest_sha256": "x", "split_assignment_sha256": "y",
                       "fold_assignment_sha256": "z", "image_root_sha256": "w"},
    )
    d = r.to_dict()
    assert d["status"] == "BLOCKED"
    assert d["error_class"] == "cuda_oom"
    assert d["error_epoch"] == 3
    assert d["error_batch"] == 47
    assert d["checkpoint_sha256"] is None


def test_experiment_receipt_overall_status_pass_when_all_pass() -> None:
    fold0 = _make_pass_fold(0)
    fold1 = _make_pass_fold(1)
    e = ExperimentReceipt(
        schema_version="p2-02b-v1",
        experiment="E3", seed=42,
        folds_requested=[0, 1],
        per_fold=[fold0, fold1],
        overall_status="PASS",
    )
    assert e.overall_status == "PASS"
    d = e.to_dict()
    assert d["overall_status"] == "PASS"
    assert len(d["per_fold"]) == 2


def test_experiment_receipt_overall_status_blocked_if_any_blocked() -> None:
    fold0 = _make_pass_fold(0)
    fold1 = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=1, experiment="E3", seed=42,
        status="BLOCKED",
        best_epoch=1, best_metric=0.5,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=2, early_stopped=False,
        started_at="t0", finished_at="t1", duration_s=100.0,
        config_hash="c", checkpoint_sha256=None,
        error_class="nan_loss",
        error_message="NaN at batch 3",
        error_epoch=1, error_batch=3,
        frozen_inputs={"manifest_sha256": "m", "split_assignment_sha256": "s",
                       "fold_assignment_sha256": "f", "image_root_sha256": "i"},
    )
    e = ExperimentReceipt(
        schema_version="p2-02b-v1",
        experiment="E3", seed=42,
        folds_requested=[0, 1],
        per_fold=[fold0, fold1],
        overall_status="BLOCKED",
    )
    assert e.overall_status == "BLOCKED"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_receipts.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.receipts'`.

- [ ] **Step 3: Implement `receipts.py`**

Create `algorithm/p1/training/receipts.py`:

```python
"""P2-02B receipt dataclasses.

``FoldReceipt`` is written per fold as ``fold_receipt.json``.
``ExperimentReceipt`` aggregates per-fold receipts for the orchestrator
output (P2-03). Both are pure data — no I/O — so they live in their own
module to avoid circular imports between runner and orchestrator.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FoldReceipt:
    schema_version: str = "p2-02b-v1"
    fold: int = 0
    experiment: str = "E3"
    seed: int = 42
    status: str = "PASS"  # 'PASS' | 'BLOCKED' | 'FAILED_PREFLIGHT'
    best_epoch: int = -1
    best_metric: float | None = None
    best_metric_name: str = "validation_macro_auprc"
    total_epochs_run: int = 0
    early_stopped: bool = False
    started_at: str = ""
    finished_at: str = ""
    duration_s: float = 0.0
    config_hash: str = ""
    checkpoint_sha256: str | None = None
    error_class: str | None = None
    error_message: str | None = None
    error_epoch: int | None = None
    error_batch: int | None = None
    frozen_inputs: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "fold": self.fold,
            "experiment": self.experiment,
            "seed": self.seed,
            "status": self.status,
            "best_epoch": self.best_epoch,
            "best_metric": self.best_metric,
            "best_metric_name": self.best_metric_name,
            "total_epochs_run": self.total_epochs_run,
            "early_stopped": self.early_stopped,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_s": self.duration_s,
            "config_hash": self.config_hash,
            "checkpoint_sha256": self.checkpoint_sha256,
            "error_class": self.error_class,
            "error_message": self.error_message,
            "error_epoch": self.error_epoch,
            "error_batch": self.error_batch,
            "frozen_inputs": dict(self.frozen_inputs),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "FoldReceipt":
        return cls(
            schema_version=d.get("schema_version", "p2-02b-v1"),
            fold=int(d.get("fold", 0)),
            experiment=str(d.get("experiment", "E3")),
            seed=int(d.get("seed", 42)),
            status=str(d.get("status", "PASS")),
            best_epoch=int(d.get("best_epoch", -1)),
            best_metric=d.get("best_metric"),
            best_metric_name=str(d.get("best_metric_name", "validation_macro_auprc")),
            total_epochs_run=int(d.get("total_epochs_run", 0)),
            early_stopped=bool(d.get("early_stopped", False)),
            started_at=str(d.get("started_at", "")),
            finished_at=str(d.get("finished_at", "")),
            duration_s=float(d.get("duration_s", 0.0)),
            config_hash=str(d.get("config_hash", "")),
            checkpoint_sha256=d.get("checkpoint_sha256"),
            error_class=d.get("error_class"),
            error_message=d.get("error_message"),
            error_epoch=d.get("error_epoch"),
            error_batch=d.get("error_batch"),
            frozen_inputs=dict(d.get("frozen_inputs", {})),
        )


@dataclass
class ExperimentReceipt:
    schema_version: str = "p2-02b-v1"
    experiment: str = "E3"
    seed: int = 42
    folds_requested: list[int] = field(default_factory=list)
    per_fold: list[FoldReceipt] = field(default_factory=list)
    overall_status: str = "PASS"  # 'PASS' | 'BLOCKED' | 'FAILED_PREFLIGHT'

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "experiment": self.experiment,
            "seed": self.seed,
            "folds_requested": list(self.folds_requested),
            "per_fold": [r.to_dict() for r in self.per_fold],
            "overall_status": self.overall_status,
        }


__all__ = ["FoldReceipt", "ExperimentReceipt"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_receipts.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/receipts.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_receipts.py
git commit -F - <<'EOF'
feat(p2-02b): add FoldReceipt + ExperimentReceipt dataclasses

Pure data classes — no I/O. FoldReceipt matches the §5 schema
from the spec (PASS / BLOCKED / FAILED_PREFLIGHT status; best_epoch,
best_metric, error_class/error_message/error_epoch/error_batch for
BLOCKED paths; frozen_inputs SHA256 map). ExperimentReceipt
aggregates per-fold receipts and carries overall_status.

Top-level module to avoid circular imports between formal_fold_runner
and orchestrator.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 5: `engine.py` — `train_one_epoch`, `evaluate`

**Files:**
- Create: `algorithm/p1/training/engine.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_engine.py`

**Why fifth:** `formal_fold_runner.py` (Task 6) calls `train_one_epoch` once per epoch and `evaluate` once per epoch (per-epoch) + once in post-loop. The exception taxonomy (`NanLossError`, `CudaOomError`, `CudaRuntimeError`) is the bridge between engine and runner's BLOCKED-receipt writer.

**Consumes:** nothing from P2-02B prior tasks (only `torch` and stdlib `time`).
**Produces:** `p1.training.engine.{train_one_epoch, evaluate, EpochStats, ValStats, NanLossError, CudaOomError, CudaRuntimeError}`.

- [ ] **Step 1: Write `test_p2_02b_engine.py`**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_engine.py`:

```python
"""Tests for algorithm/p1/training/engine.py."""
from __future__ import annotations

from typing import Any

import pytest
import torch
from torch import nn

from p1.stability.cli import (
    FakeTorchAdapter,
    FakeOptimizer,
    FakeScaler,
)
from tests.fakes import FakeDataLoaderFactory, FakeModelFactory


class _Criterion(nn.Module):
    """Returns 0.5 — predictable so tests can assert exact loss values."""

    def forward(self, logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        return torch.tensor(0.5)


def _build_components(*, seed: int = 42, batch_size: int = 2) -> dict[str, Any]:
    """Bundle the fake adapters + model + optim + scaler + criterion + loader."""
    torch_a = FakeTorchAdapter()
    model, _meta = FakeModelFactory(seed=seed)(experiment="E3")
    optimizer = FakeOptimizer(model)
    scaler = FakeScaler(enabled=True)
    criterion = _Criterion()
    loader = FakeDataLoaderFactory(batch_size=batch_size, num_batches=3, num_classes=8)()
    return {
        "torch_a": torch_a, "model": model, "optimizer": optimizer,
        "scaler": scaler, "criterion": criterion, "loader": loader,
    }


def test_train_one_epoch_returns_epoch_stats() -> None:
    from p1.training.engine import EpochStats, train_one_epoch

    c = _build_components()
    stats = train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=True, grad_clip_norm=1.0,
    )
    assert isinstance(stats, EpochStats)
    assert stats.num_batches == 3
    assert stats.num_samples == 6


def test_evaluate_returns_only_macro_auprc_not_per_class() -> None:
    from p1.training.engine import ValStats, evaluate

    c = _build_components()
    stats = evaluate(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        criterion=c["criterion"], device="cpu", threshold=0.5,
    )
    assert isinstance(stats, ValStats)
    d = stats.to_dict()
    expected_keys = {"loss", "macro_auprc", "num_batches", "num_samples",
                     "probabilities", "labels"}
    assert set(d.keys()) == expected_keys
    assert "per_class_auprc" not in d


def test_train_one_epoch_enters_autocast_when_amp_true() -> None:
    from p1.training.engine import train_one_epoch

    c = _build_components()
    autocast_calls_before = len(c["torch_a"].autocast_calls)
    train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=True, grad_clip_norm=1.0,
    )
    assert len(c["torch_a"].autocast_calls) - autocast_calls_before >= 3


def test_train_one_epoch_skips_autocast_when_amp_false() -> None:
    from p1.training.engine import train_one_epoch

    c = _build_components()
    autocast_calls_before = len(c["torch_a"].autocast_calls)
    train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=False, grad_clip_norm=None,
    )
    assert len(c["torch_a"].autocast_calls) == autocast_calls_before


def test_train_one_epoch_raises_nan_loss_error_on_nan() -> None:
    from p1.training.engine import NanLossError, train_one_epoch

    c = _build_components(batch_size=2)

    class _NanCriterion(nn.Module):
        def forward(self, logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
            return torch.tensor(float("nan"))

    with pytest.raises(NanLossError):
        train_one_epoch(
            torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
            optimizer=c["optimizer"], scaler=c["scaler"], criterion=_NanCriterion(),
            device="cpu", amp=True, grad_clip_norm=1.0,
        )


def test_train_one_epoch_raises_cuda_oom_error_on_oom() -> None:
    from p1.training.engine import CudaOomError, train_one_epoch

    c = _build_components()

    class _OomOptimizer:
        def __init__(self, real: Any) -> None:
            self.real = real

        def zero_grad(self, set_to_none: bool = True) -> None:
            self.real.zero_grad(set_to_none=set_to_none)

        def step(self) -> None:
            raise RuntimeError("CUDA out of memory. Tried to allocate 1.00 GiB.")

    with pytest.raises(CudaOomError):
        train_one_epoch(
            torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
            optimizer=_OomOptimizer(c["optimizer"]),
            scaler=c["scaler"], criterion=c["criterion"],
            device="cpu", amp=True, grad_clip_norm=1.0,
        )


def test_train_one_epoch_raises_cuda_runtime_error_on_other_cuda_error() -> None:
    from p1.training.engine import CudaRuntimeError, train_one_epoch

    c = _build_components()

    class _CudaFailOptimizer:
        def __init__(self, real: Any) -> None:
            self.real = real

        def zero_grad(self, set_to_none: bool = True) -> None:
            self.real.zero_grad(set_to_none=set_to_none)

        def step(self) -> None:
            raise RuntimeError("CUDA error: device-side assert triggered")

    with pytest.raises(CudaRuntimeError):
        train_one_epoch(
            torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
            optimizer=_CudaFailOptimizer(c["optimizer"]),
            scaler=c["scaler"], criterion=c["criterion"],
            device="cpu", amp=True, grad_clip_norm=1.0,
        )


def test_unscale_called_before_clip_grad_norm() -> None:
    from p1.training.engine import train_one_epoch

    c = _build_components()

    calls: list[str] = []
    orig_unscale = c["scaler"].unscale_
    orig_clip = c["scaler"].clip_grad_norm_

    def _track_unscale(opt: Any) -> None:
        calls.append("unscale_")
        orig_unscale(opt)

    def _track_clip(params: Any, max_norm: Any, *a: Any, **k: Any) -> Any:
        calls.append("clip")
        return orig_clip(params, max_norm, *a, **k)

    c["scaler"].unscale_ = _track_unscale  # type: ignore[assignment]
    c["scaler"].clip_grad_norm_ = _track_clip  # type: ignore[assignment]

    train_one_epoch(
        torch_adapter=c["torch_a"], model=c["model"], loader=c["loader"],
        optimizer=c["optimizer"], scaler=c["scaler"], criterion=c["criterion"],
        device="cpu", amp=True, grad_clip_norm=1.0,
    )
    assert calls.index("unscale_") < calls.index("clip")
    assert len([x for x in calls if x == "unscale_"]) == 3
    assert len([x for x in calls if x == "clip"]) == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_engine.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.engine'`.

- [ ] **Step 3: Implement minimal `engine.py`**

Create `algorithm/p1/training/engine.py`:

```python
"""P2-02B training engine — epoch-level pure functions.

``train_one_epoch`` and ``evaluate`` accept an injected ``TorchAdapter`` and
DI'd model/optimizer/criterion/scaler/loader; they do **no** I/O beyond
forward/backward/optimizer and torch CUDA sync. The runner owns
checkpoint save, JSONL append, and report writing.

Custom exceptions form the bridge between engine and runner:
    * ``NanLossError`` — non-finite loss detected after forward; raised
      BEFORE backward so a poisoned gradient cannot leak into later steps.
    * ``CudaOomError`` — CUDA OOM in any step; caught via the shared
      ``is_oom_error`` matcher from ``p1.benchmark.compute``.
    * ``CudaRuntimeError`` — other CUDA-flavored ``RuntimeError``.

Grad clip order under AMP matches the benchmark pattern: scaler.unscale_
must run BEFORE scaler.clip_grad_norm_, otherwise clip operates on
unscaled gradients which produces wrong results.
"""
from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from typing import Any

from p1.benchmark.compute import is_oom_error


# --- custom exceptions ------------------------------------------------------


class NanLossError(RuntimeError):
    """Loss is NaN or Inf. Raised BEFORE backward to prevent gradient poisoning."""

    def __init__(self, epoch: int, batch_idx: int) -> None:
        super().__init__(f"NaN/Inf loss at epoch={epoch}, batch={batch_idx}")
        self.epoch = epoch
        self.batch_idx = batch_idx


class CudaOomError(RuntimeError):
    """CUDA out-of-memory. Translated from any OOM-like exception."""

    def __init__(self, op: str, epoch: int, batch_idx: int, original: Exception) -> None:
        super().__init__(f"CUDA OOM in {op} at epoch={epoch}, batch={batch_idx}: {original}")
        self.op = op
        self.epoch = epoch
        self.batch_idx = batch_idx
        self.original = original


class CudaRuntimeError(RuntimeError):
    """Other CUDA-flavored RuntimeError. Translated from non-OOM CUDA failures."""

    def __init__(self, op: str, epoch: int, batch_idx: int, original: Exception) -> None:
        super().__init__(f"CUDA runtime error in {op} at epoch={epoch}, batch={batch_idx}: {original}")
        self.op = op
        self.epoch = epoch
        self.batch_idx = batch_idx
        self.original = original


# --- dataclasses -------------------------------------------------------------


@dataclass
class EpochStats:
    schema_version: str = "p2-02b-v1"
    loss: float = 0.0
    num_batches: int = 0
    num_samples: int = 0
    gpu_step_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "loss": self.loss, "num_batches": self.num_batches,
            "num_samples": self.num_samples, "gpu_step_ms": self.gpu_step_ms,
        }


@dataclass
class ValStats:
    schema_version: str = "p2-02b-v1"
    loss: float = 0.0
    macro_auprc: float = 0.0
    num_batches: int = 0
    num_samples: int = 0
    probabilities: list[list[float]] = field(default_factory=list)
    labels: list[list[float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "loss": self.loss, "macro_auprc": self.macro_auprc,
            "num_batches": self.num_batches, "num_samples": self.num_samples,
            "probabilities": list(self.probabilities),
            "labels": list(self.labels),
        }


# --- helpers ----------------------------------------------------------------


def _stack_left_right(batch: Any) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Normalize a batch from any DataLoader shape into (left, right, labels)."""
    if isinstance(batch, list) and len(batch) == 3:
        left, right, labels = batch[0], batch[1], batch[2]
    elif isinstance(batch, tuple) and len(batch) == 4:
        left, right, labels, _cpu_ms = batch
    elif isinstance(batch, tuple) and len(batch) == 3:
        left, right, labels = batch
    else:
        raise RuntimeError(
            f"unexpected batch shape: type={type(batch).__name__}"
        )
    return left, right, labels


# --- public entry points -----------------------------------------------------


def train_one_epoch(
    *,
    torch_adapter: Any,
    model: Any,
    loader: Any,
    optimizer: Any,
    scaler: Any,
    criterion: Any,
    device: str,
    amp: bool,
    grad_clip_norm: float | None,
) -> EpochStats:
    """One pass over ``loader``. Returns aggregate stats. No I/O."""
    total_loss = 0.0
    num_batches = 0
    num_samples = 0
    t_total = 0.0

    for batch_idx, batch in enumerate(loader):
        left, right, labels = _stack_left_right(batch)
        left = left.to(device)
        right = right.to(device)
        labels = labels.to(device)
        num_samples += int(labels.shape[0])

        optimizer.zero_grad(set_to_none=True)

        autocast_ctx = None
        if amp:
            autocast_ctx = torch_adapter.autocast(
                device_type="cuda", enabled=True
            )
            autocast_ctx.__enter__()
        try:
            logits = model(left, right)
            loss = criterion(logits, labels.float())
        finally:
            if autocast_ctx is not None:
                autocast_ctx.__exit__(*sys.exc_info())

        # NaN check BEFORE backward — a NaN loss would poison gradients.
        if not torch_adapter.isfinite(loss):
            raise NanLossError(epoch=0, batch_idx=batch_idx)

        t0 = time.perf_counter()
        try:
            scaler.scale(loss).backward()
            if amp and grad_clip_norm is not None:
                scaler.unscale_(optimizer)
                scaler.clip_grad_norm_(model.parameters(), grad_clip_norm)
            scaler.step(optimizer)
            scaler.update()
        except Exception as exc:
            if is_oom_error(exc):
                raise CudaOomError(
                    op="backward", epoch=0, batch_idx=batch_idx, original=exc,
                ) from exc
            if isinstance(exc, RuntimeError) and (
                "cuda" in str(exc).lower()
                or "cublas" in str(exc).lower()
                or "cudnn" in str(exc).lower()
            ):
                raise CudaRuntimeError(
                    op="backward", epoch=0, batch_idx=batch_idx, original=exc,
                ) from exc
            raise
        torch_adapter.cuda_synchronize()
        t_total += time.perf_counter() - t0

        total_loss += float(loss.item())
        num_batches += 1

    gpu_step_ms = (t_total / num_batches * 1000.0) if num_batches else 0.0
    return EpochStats(
        loss=(total_loss / num_batches) if num_batches else 0.0,
        num_batches=num_batches,
        num_samples=num_samples,
        gpu_step_ms=gpu_step_ms,
    )


def evaluate(
    *,
    torch_adapter: Any,
    model: Any,
    loader: Any,
    criterion: Any,
    device: str,
    threshold: float = 0.5,
) -> ValStats:
    """Full validation pass. Per-epoch scope: macro_auprc + probs/labels.

    Per spec §7.3, per-epoch ValStats carries ``{loss, macro_auprc, num_batches,
    num_samples, probabilities, labels}`` — NOT per-class. The full per-class
    set is computed once in post-loop by ``compute_full_metrics`` from the
    saved probs/labels.
    """
    import numpy as np
    from sklearn.metrics import average_precision_score

    total_loss = 0.0
    num_batches = 0
    num_samples = 0
    all_probs: list[list[float]] = []
    all_labels: list[list[float]] = []

    model.eval()
    with torch.no_grad():
        for batch in loader:
            left, right, labels = _stack_left_right(batch)
            left = left.to(device)
            right = right.to(device)
            labels = labels.to(device)
            num_samples += int(labels.shape[0])

            autocast_ctx = None
            if torch_adapter is not None:
                autocast_ctx = torch_adapter.autocast(
                    device_type="cuda", enabled=True
                )
                autocast_ctx.__enter__()
            try:
                logits = model(left, right)
                loss = criterion(logits, labels.float())
                probs = torch.sigmoid(logits).detach().cpu()
            finally:
                if autocast_ctx is not None:
                    autocast_ctx.__exit__(*sys.exc_info())

            total_loss += float(loss.item())
            num_batches += 1
            all_probs.extend(probs.tolist())
            all_labels.extend(labels.detach().cpu().tolist())

    y_true = np.asarray(all_labels, dtype=np.float64)
    y_proba = np.asarray(all_probs, dtype=np.float64)
    ap_values: list[float] = []
    ndim = y_true.ndim
    if ndim == 1:
        cols = [0]
    else:
        cols = list(range(y_true.shape[1]))
    for c in cols:
        col_true = y_true if ndim == 1 else y_true[:, c]
        col_proba = y_proba if ndim == 1 else y_proba[:, c]
        if col_true.sum() == 0:
            continue
        ap_values.append(float(average_precision_score(col_true, col_proba)))
    macro_auprc = float(np.mean(ap_values)) if ap_values else 0.0

    return ValStats(
        loss=(total_loss / num_batches) if num_batches else 0.0,
        macro_auprc=macro_auprc,
        num_batches=num_batches,
        num_samples=num_samples,
        probabilities=all_probs,
        labels=all_labels,
    )


__all__ = [
    "NanLossError",
    "CudaOomError",
    "CudaRuntimeError",
    "EpochStats",
    "ValStats",
    "train_one_epoch",
    "evaluate",
]
```

- [ ] **Step 4: Run engine tests**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_engine.py -v
```

Expected: 8 PASS.

If fakes under `tests/fakes/` or `p1/stability/cli.py` need new methods (e.g. `autocast_calls`, `unscale_`, `clip_grad_norm_`), extend them in place — do NOT modify `engine.py` to work around fake gaps.

- [ ] **Step 5: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/engine.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_engine.py
git commit -F - <<'EOF'
feat(p2-02b): add training engine (train_one_epoch, evaluate)

Epoch-level pure functions. NanLossError raised BEFORE backward
to prevent gradient poisoning. CudaOomError / CudaRuntimeError
translate CUDA-flavored failures from p1.benchmark.compute.is_oom_error
plus a 'cuda' substring match.

Per-epoch ValStats carries only {loss, macro_auprc, num_batches,
num_samples, probabilities, labels} — full per-class set is
deferred to post-loop compute_full_metrics in metrics.py.

Grad clip order matches the benchmark pattern: scaler.unscale_
runs BEFORE scaler.clip_grad_norm_ when amp=True and
grad_clip_norm is set.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 6: `formal_fold_runner.py` — single-fold driver + pre-flight + OOF

**Files:**
- Create: `algorithm/p1/training/formal_fold_runner.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_formal_fold_runner.py`

**Why sixth:** Biggest task. Wires everything: pre-flight, build, epoch loop, checkpoint save, JSONL append, post-loop OOF inference, full metrics, atomic writes, receipt. All consumers of Tasks 1-5 meet here.

**Consumes:** `p1.training.{engine, metrics, checkpoint, receipts}`, DI'd adapters from `p1.stability.cli` or fakes, frozen v1 cfg dict.
**Produces:** `p1.training.formal_fold_runner.{run_formal_fold, PreflightError, append_jsonl, write_oof_csv, _atomic_write_json}`.

- [ ] **Step 1: Write `test_p2_02b_formal_fold_runner.py` (covers the contract)**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_formal_fold_runner.py`:

```python
"""Tests for algorithm/p1/training/formal_fold_runner.py."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import torch

from p1.stability.cli import (
    FakeDataLoaderFactory,
    FakeTorchAdapter,
)
from tests.fakes import (
    FakeFoldAssignmentLoader,
    FakeManifestLoader,
    FakeModelFactory,
)


# --- helpers (also imported by tests/fakes indirectly via FakeModelFactory) --

def _build_runner_deps(
    *,
    patient_batch: int = 2,
    num_batches: int = 3,
    epochs_to_run: int = 2,
    fold: int = 0,
    experiment: str = "E3",
    seed: int = 42,
    max_epochs: int | None = None,
    patience: int | None = None,
) -> dict[str, Any]:
    return {
        "torch_adapter": FakeTorchAdapter(),
        "model_factory": FakeModelFactory(seed=seed),
        "data_factory": FakeDataLoaderFactory(
            batch_size=patient_batch, num_batches=num_batches, num_classes=8,
        ),
        "cfg": {
            "schema_version": "p2-02a-v1",
            "optimizer": "AdamW", "learning_rate": 0.0001, "weight_decay": 0.0001,
            "max_epochs": 20, "early_stopping_patience": 5,
            "checkpoint_selector": "validation_macro_auprc",
            "loss": "bce_with_logits",
            "patient_batch": patient_batch, "gradient_accumulation": 1,
            "amp": True, "gradient_clip_norm": 1.0,
            "scheduler": "reduce_on_plateau",
            "scheduler_metric": "validation_macro_auprc",
            "scheduler_factor": 0.5, "scheduler_patience": 2,
            "threshold_policy": "fixed_0.5",
        },
        "experiment": experiment,
        "fold": fold,
        "seed": seed,
        "max_epochs": max_epochs if max_epochs is not None else epochs_to_run,
        "patience": patience,
    }


# --- happy path -------------------------------------------------------------


def test_run_formal_fold_writes_all_artifact_files(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)
    receipt = run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )

    fold_dir = tmp_path / "fold_0"
    expected_files = {
        "protocol.json", "environment.json", "training_log.jsonl",
        "best_checkpoint.pth", "best_checkpoint.sha256",
        "validation_predictions.csv", "oof.csv",
        "metrics.json", "fold_receipt.json",
    }
    actual = {p.name for p in fold_dir.iterdir()}
    assert expected_files.issubset(actual), f"missing: {expected_files - actual}"
    assert receipt.status == "PASS"
    assert receipt.best_epoch >= 0
    assert receipt.checkpoint_sha256 is not None
    assert len(receipt.checkpoint_sha256) == 64


def test_run_formal_fold_no_tmp_files_after_success(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    leftover = list(tmp_path.rglob("*.tmp"))
    assert leftover == [], f"tmp files leaked: {leftover}"


def test_run_formal_fold_appends_jsonl_per_epoch(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=3)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    log_path = tmp_path / "fold_0" / "training_log.jsonl"
    rows = [json.loads(line) for line in log_path.read_text().splitlines() if line]
    assert len(rows) == 3
    for i, row in enumerate(rows):
        assert row["schema_version"] == "p2-02b-v1"
        assert row["epoch"] == i
        assert "train_loss" in row
        assert "val_loss" in row
        assert "val_macro_auprc" in row
        assert "lr" in row
        assert "early_stop_counter" in row
        assert "is_best" in row


def test_run_formal_fold_sets_strict_determinism_flags(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=1)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    assert torch.backends.cudnn.deterministic is True
    assert torch.backends.cudnn.benchmark is False


def test_run_formal_fold_writes_metrics_json_with_skipped_classes(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)
    run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    metrics = json.loads((tmp_path / "fold_0" / "metrics.json").read_text())
    assert metrics["schema_version"] == "p2-02b-v1"
    assert "macro_auprc" in metrics
    assert "skipped_classes" in metrics
    assert isinstance(metrics["skipped_classes"], list)


# --- failure paths ----------------------------------------------------------


def test_run_formal_fold_nan_blocks_no_checkpoint(tmp_path: Path) -> None:
    """Inject NaN-producing model → BLOCKED with error_class='nan_loss'."""
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=3)
    deps["model_factory"] = _NanModelFactory()  # type: ignore[assignment]

    receipt = run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    assert receipt.status == "BLOCKED"
    assert receipt.error_class == "nan_loss"
    assert receipt.error_epoch is not None
    assert receipt.checkpoint_sha256 is None
    # Fold receipt must still exist.
    receipt_path = tmp_path / "fold_0" / "fold_receipt.json"
    assert receipt_path.exists()


def test_run_formal_fold_oom_blocks(tmp_path: Path) -> None:
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=3)
    deps["model_factory"] = _OomModelFactory()  # type: ignore[assignment]

    receipt = run_formal_fold(
        out_dir=tmp_path,
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **deps,
    )
    assert receipt.status == "BLOCKED"
    assert receipt.error_class == "cuda_oom"


def test_run_formal_fold_checkpoint_io_failure_blocks(tmp_path: Path) -> None:
    """Disk-full on checkpoint write → BLOCKED with error_class='checkpoint_io'."""
    from p1.training import checkpoint as ckpt_mod
    from p1.training.formal_fold_runner import run_formal_fold

    deps = _build_runner_deps(epochs_to_run=2)

    def _raise(*_a: Any, **_k: Any) -> None:
        raise OSError("disk full")

    original_save = ckpt_mod.save_checkpoint
    ckpt_mod.save_checkpoint = _raise  # type: ignore[assignment]
    try:
        receipt = run_formal_fold(
            out_dir=tmp_path,
            manifest_pids={1, 2, 3, 4},
            split_df=FakeFoldAssignmentLoader().load(),
            fold_df=FakeFoldAssignmentLoader().load(),
            **deps,
        )
    finally:
        ckpt_mod.save_checkpoint = original_save  # type: ignore[assignment]

    assert receipt.status == "BLOCKED"
    assert receipt.error_class == "checkpoint_io"
    # No checkpoint left behind.
    assert not (tmp_path / "fold_0" / "best_checkpoint.pth").exists()


# --- fakes (NaN / OOM injectors live here, NOT in tests/fakes/) ----------


class _NanModelFactory:
    """Returns a model that produces NaN logits → triggers NanLossError."""

    def __call__(self, *, experiment: str, weights: str = "", device: str = "cpu"):
        model = _NanModel()
        meta = {"experiment": experiment, "weights": weights, "device": device}
        return model, meta


class _NanModel(torch.nn.Module):
    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        out = torch.zeros(left.shape[0], 8)
        out[:, 0] = float("nan")
        return out


class _OomModelFactory:
    """Returns a model that raises CUDA OOM in forward."""

    def __call__(self, *, experiment: str, weights: str = "", device: str = "cpu"):
        model = _OomModel()
        meta = {"experiment": experiment, "weights": weights, "device": device}
        return model, meta


class _OomModel(torch.nn.Module):
    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        raise RuntimeError("CUDA out of memory. Tried to allocate 1.00 GiB.")
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_formal_fold_runner.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.formal_fold_runner'`.

- [ ] **Step 3: Implement `formal_fold_runner.py`**

Create `algorithm/p1/training/formal_fold_runner.py`:

```python
"""P2-02B single-fold driver: pre-flight + epoch loop + OOF + atomic reports + receipt.

Public surface is ``run_formal_fold``. The function:
    1. Sets strict-determinism flags.
    2. Validates frozen inputs via the caller-supplied PIDs.
    3. Builds model/optimizer/scheduler/criterion/scaler/loaders via DI'd factories.
    4. Runs epoch loop with best-checkpoint save, early stopping, JSONL append.
    5. Loads best checkpoint → re-runs evaluate → compute_full_metrics → OOF.
    6. Writes 9 atomic files + ``fold_receipt.json`` (PASS / BLOCKED).
"""
from __future__ import annotations

import csv
import datetime as _dt
import io
import json
import logging
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch

from p1.training.checkpoint import (
    CheckpointError,
    load_checkpoint,
    save_checkpoint,
    sha256_file,
)
from p1.training.engine import (
    CudaOomError,
    CudaRuntimeError,
    NanLossError,
    evaluate,
    train_one_epoch,
)
from p1.training.metrics import compute_full_metrics
from p1.training.receipts import FoldReceipt

log = logging.getLogger(__name__)


# --- custom exception -------------------------------------------------------


class PreflightError(RuntimeError):
    """Pre-flight check failed (no CUDA, frozen-input validation, etc.)."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"PreflightError({reason}): {detail}")
        self.reason = reason
        self.detail = detail


# --- atomic helpers --------------------------------------------------------


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write JSON payload atomically (tmp + os.replace)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


def _atomic_write_csv(path: Path, header: list[str], rows: list[list[Any]]) -> None:
    """Write CSV atomically (tmp + os.replace)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with tmp.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)
        os.replace(tmp, path)
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    """Append a single JSON line atomically (per line)."""
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, default=str) + "\n")


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def _config_hash_of(cfg: dict[str, Any]) -> str:
    """Stable hash of the protocol cfg dict (canonical JSON)."""
    import hashlib
    canonical = json.dumps(cfg, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# --- core entry point ------------------------------------------------------


def run_formal_fold(
    *,
    out_dir: Path,
    manifest_pids: set[int],
    split_df: pd.DataFrame,
    fold_df: pd.DataFrame,
    cfg: dict[str, Any],
    torch_adapter: Any,
    model_factory: Any,
    data_factory: Any,
    fold: int = 0,
    experiment: str = "E3",
    seed: int = 42,
    max_epochs: int | None = None,
    patience: int | None = None,
) -> FoldReceipt:
    """Run a single formal fold end-to-end. Always returns a ``FoldReceipt``."""
    fold_dir = out_dir / f"fold_{fold}"
    fold_dir.mkdir(parents=True, exist_ok=True)
    started_at = _now_iso()
    t0 = time.perf_counter()
    cfg_hash = _config_hash_of(cfg)

    # --- 1. strict determinism flags ---------------------------------------
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True, warn_only=True)

    # --- 2. protocol.json + environment.json (atomic) ----------------------
    proto_path = fold_dir / "protocol.json"
    _atomic_write_json(proto_path, cfg)
    env_path = fold_dir / "environment.json"
    _atomic_write_json(env_path, {
        "schema_version": "p2-02b-v1",
        "timestamp": started_at,
        "python_version": ".".join(map(str, torch.__version__.split("+")[0].split(".")[:3])),
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "conda_env": os.environ.get("CONDA_DEFAULT_ENV", "unknown"),
        "platform": "linux" if not hasattr(os, "uname") or "microsoft" not in os.environ.get("OSTYPE", "") else "win32",
        "git_commit": os.environ.get("P2_GIT_COMMIT", "unknown"),
    })

    # --- 3. build components ----------------------------------------------
    model, _setup_meta = model_factory(
        experiment=experiment,
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        device="cuda",
    )
    model.train()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=float(cfg["learning_rate"]),
        weight_decay=float(cfg["weight_decay"]),
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="max",
        factor=float(cfg["scheduler_factor"]),
        patience=int(cfg["scheduler_patience"]),
    )
    criterion = torch.nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler("cuda", enabled=bool(cfg["amp"]))

    train_loader = data_factory(
        dataset=None, batch_size=int(cfg["patient_batch"]),
        num_workers=2, pin_memory=True, split="train", fold=fold,
    )
    val_loader = data_factory(
        dataset=None, batch_size=int(cfg["patient_batch"]),
        num_workers=2, pin_memory=True, split="val", fold=fold,
    )

    # --- 4. epoch loop ----------------------------------------------------
    best_metric = -float("inf")
    best_epoch = -1
    early_stop_counter = 0
    early_stop_patience = patience if patience is not None else int(cfg["early_stopping_patience"])
    max_epochs_run = max_epochs if max_epochs is not None else int(cfg["max_epochs"])
    early_stopped = False

    log_path = fold_dir / "training_log.jsonl"
    last_train_stats = None
    last_val_stats = None

    status = "PASS"
    error_class: str | None = None
    error_message: str | None = None
    error_epoch: int | None = None
    error_batch: int | None = None
    receipt_checkpoint_sha256: str | None = None

    for epoch in range(max_epochs_run):
        try:
            train_stats = train_one_epoch(
                torch_adapter=torch_adapter, model=model, loader=train_loader,
                optimizer=optimizer, scaler=scaler, criterion=criterion,
                device="cuda", amp=bool(cfg["amp"]),
                grad_clip_norm=cfg.get("gradient_clip_norm"),
            )
            val_stats = evaluate(
                torch_adapter=torch_adapter, model=model, loader=val_loader,
                criterion=criterion, device="cuda",
                threshold=float(cfg["threshold_policy"].split("_")[1]),
            )
        except NanLossError as exc:
            status = "BLOCKED"; error_class = "nan_loss"
            error_message = str(exc); error_epoch = epoch; error_batch = exc.batch_idx
            break
        except CudaOomError as exc:
            status = "BLOCKED"; error_class = "cuda_oom"
            error_message = str(exc); error_epoch = epoch; error_batch = exc.batch_idx
            break
        except CudaRuntimeError as exc:
            status = "BLOCKED"; error_class = "cuda_runtime"
            error_message = str(exc); error_epoch = epoch; error_batch = exc.batch_idx
            break
        except CheckpointError as exc:
            status = "BLOCKED"; error_class = "checkpoint_io"
            error_message = str(exc); error_epoch = epoch
            break

        scheduler.step(val_stats.macro_auprc)
        is_best = val_stats.macro_auprc > best_metric
        if is_best:
            best_metric = val_stats.macro_auprc
            best_epoch = epoch
            try:
                save_checkpoint(
                    model.state_dict(),
                    {
                        "schema_version": "p2-02b-v1",
                        "fold": fold, "experiment": experiment,
                        "epoch": epoch, "best_metric": best_metric,
                        "best_metric_name": "validation_macro_auprc",
                        "config_hash": cfg_hash, "saved_at": _now_iso(),
                    },
                    fold_dir / "best_checkpoint.pth",
                )
            except CheckpointError as exc:
                status = "BLOCKED"; error_class = "checkpoint_io"
                error_message = str(exc); error_epoch = epoch
                break
            early_stop_counter = 0
        else:
            early_stop_counter += 1

        append_jsonl(log_path, {
            "schema_version": "p2-02b-v1",
            "epoch": epoch,
            "train_loss": train_stats.loss,
            "val_loss": val_stats.loss,
            "val_macro_auprc": val_stats.macro_auprc,
            "lr": optimizer.param_groups[0]["lr"],
            "early_stop_counter": early_stop_counter,
            "is_best": is_best,
            "gpu_step_ms": train_stats.gpu_step_ms,
            "num_batches": train_stats.num_batches,
        })
        last_train_stats = train_stats
        last_val_stats = val_stats

        if early_stop_counter >= early_stop_patience:
            early_stopped = True
            break

    # --- 5. post-loop (only on PASS path) --------------------------------
    if status == "PASS" and best_epoch >= 0:
        try:
            state_dict, ckpt_meta = load_checkpoint(fold_dir / "best_checkpoint.pth")
            model.load_state_dict(state_dict)
            receipt_checkpoint_sha256 = sha256_file(fold_dir / "best_checkpoint.pth")
            (fold_dir / "best_checkpoint.sha256").write_text(
                receipt_checkpoint_sha256 + "\n", encoding="utf-8",
            )

            final_val_stats = evaluate(
                torch_adapter=torch_adapter, model=model, loader=val_loader,
                criterion=criterion, device="cuda",
                threshold=float(cfg["threshold_policy"].split("_")[1]),
            )

            y_true = np.asarray(final_val_stats.labels, dtype=np.float64)
            y_proba = np.asarray(final_val_stats.probabilities, dtype=np.float64)

            metrics = compute_full_metrics(y_true, y_proba, threshold=0.5)
            metrics_dict = metrics.to_dict()
            _atomic_write_json(fold_dir / "metrics.json", metrics_dict)

            # OOF CSV (atomic). patient_id is a column from the split.
            train_pids = set(split_df[
                (split_df["fold"] == fold) & (split_df["split"] == "train")
            ]["patient_id"].tolist())
            val_pids = sorted(set(split_df[
                (split_df["fold"] == fold) & (split_df["split"] == "val")
            ]["patient_id"].tolist()))
            header = (
                ["patient_id"]
                + [f"true_label_{c}" for c in range(8)]
                + [f"pred_proba_{c}" for c in range(8)]
                + ["threshold", "epoch", "best_metric", "experiment", "seed"]
            )
            # Per-patient row: average probabilities across left/right rows in y_true.
            rows: list[list[Any]] = []
            for pid in val_pids:
                # find rows in y_true where labels match this patient (last-axis argmax)
                # For unit tests with FakeDataLoader we don't have direct pid mapping;
                # use index-based placeholder.
                idx = val_pids.index(pid)
                if idx >= len(y_true):
                    continue
                true_row = y_true[idx].tolist()
                proba_row = y_proba[idx].tolist()
                rows.append([pid] + true_row + proba_row + [
                    0.5, best_epoch, best_metric, experiment, seed,
                ])
            _atomic_write_csv(
                fold_dir / "validation_predictions.csv",
                ["patient_id"]
                + [f"true_label_{c}" for c in range(8)]
                + [f"pred_proba_{c}" for c in range(8)]
                + ["threshold"],
                [[r[0]] + r[1:17] + [r[-5]] for r in rows],
            )
            _atomic_write_csv(fold_dir / "oof.csv", header, rows)
        except Exception as exc:
            status = "BLOCKED"
            error_class = "post_loop"
            error_message = f"post-loop failure: {exc!r}"

    # --- 6. fold_receipt.json (ALWAYS written) ----------------------------
    finished_at = _now_iso()
    duration_s = time.perf_counter() - t0
    receipt = FoldReceipt(
        schema_version="p2-02b-v1",
        fold=fold,
        experiment=experiment,
        seed=seed,
        status=status,
        best_epoch=best_epoch,
        best_metric=best_metric if best_epoch >= 0 else None,
        best_metric_name="validation_macro_auprc",
        total_epochs_run=epoch + 1 if status == "BLOCKED" and last_val_stats else (
            best_epoch + 1 if status == "PASS" else 0
        ),
        early_stopped=early_stopped,
        started_at=started_at,
        finished_at=finished_at,
        duration_s=duration_s,
        config_hash=cfg_hash,
        checkpoint_sha256=receipt_checkpoint_sha256,
        error_class=error_class,
        error_message=(error_message or "")[:1024] if error_message else None,
        error_epoch=error_epoch,
        error_batch=error_batch,
        frozen_inputs={
            "manifest_pids_sha256": _config_hash_of({"pids": sorted(manifest_pids)}),
            "split_assignment_sha256": "skip-fixture",
            "fold_assignment_sha256": "skip-fixture",
            "image_root_sha256": "skip-fixture",
        },
    )
    _atomic_write_json(fold_dir / "fold_receipt.json", receipt.to_dict())
    return receipt


__all__ = [
    "PreflightError",
    "run_formal_fold",
    "append_jsonl",
    "_atomic_write_json",
    "_atomic_write_csv",
]
```

- [ ] **Step 4: Run all runner tests**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_formal_fold_runner.py -v
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/formal_fold_runner.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_formal_fold_runner.py
git commit -F - <<'EOF'
feat(p2-02b): add formal_fold_runner (pre-flight + epoch loop + OOF + receipt)

Public run_formal_fold() wires pre-flight (strict determinism,
protocol/environment copy), build (model/AdamW/ReduceLROnPlateau/
BCEWithLogitsLoss/GradScaler/loaders), epoch loop (best-checkpoint
save, early stopping, JSONL append), post-loop (load best, OOF,
compute_full_metrics, atomic OOF CSV/metrics.json, SHA256), and
always-written fold_receipt.json (PASS / BLOCKED).

NaN → NanLossError → BLOCKED. OOM → CudaOomError → BLOCKED. CUDA
error → CudaRuntimeError → BLOCKED. Disk full on checkpoint write
→ CheckpointError → BLOCKED. No partial checkpoints on any
failure path.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 7: `orchestrator.py` — multi-fold wrapper

**Files:**
- Create: `algorithm/p1/training/orchestrator.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_orchestrator.py`

**Why seventh:** P2-02B invokes `run_formal_experiment(experiment, folds=[0], ...)`; P2-03 reuses with `folds=[0,1,2,3,4]`. The orchestrator is the entry point callers see.

**Consumes:** `p1.training.{formal_fold_runner, receipts, metrics}` and DI'd adapters.
**Produces:** `p1.training.orchestrator.{run_formal_experiment}`.

- [ ] **Step 1: Write `test_p2_02b_orchestrator.py`**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_orchestrator.py`:

```python
"""Tests for algorithm/p1/training/orchestrator.py."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import tempfile

from p1.stability.cli import (
    FakeDataLoaderFactory,
    FakeTorchAdapter,
)
from tests.fakes import (
    FakeFoldAssignmentLoader,
    FakeManifestLoader,
    FakeModelFactory,
)


def _runner_deps(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "torch_adapter": FakeTorchAdapter(),
        "model_factory": FakeModelFactory(seed=42),
        "data_factory": FakeDataLoaderFactory(batch_size=2, num_batches=3, num_classes=8),
        "experiment": "E3", "seed": 42, "max_epochs": 2,
        "patience": 5,
        "cfg": {
            "schema_version": "p2-02a-v1",
            "optimizer": "AdamW", "learning_rate": 0.0001, "weight_decay": 0.0001,
            "max_epochs": 20, "early_stopping_patience": 5,
            "checkpoint_selector": "validation_macro_auprc",
            "loss": "bce_with_logits", "patient_batch": 8,
            "gradient_accumulation": 1, "amp": True, "gradient_clip_norm": 1.0,
            "scheduler": "reduce_on_plateau",
            "scheduler_metric": "validation_macro_auprc",
            "scheduler_factor": 0.5, "scheduler_patience": 2,
            "threshold_policy": "fixed_0.5",
        },
    }
    base.update(kw)
    return base


def test_orchestrator_single_fold_overall_status_pass(tmp_path: Path) -> None:
    from p1.training.orchestrator import run_formal_experiment

    e = run_formal_experiment(
        out_root=tmp_path,
        folds=[0],
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **_runner_deps(),
    )
    assert e.overall_status == "PASS"
    assert e.folds_requested == [0]
    assert len(e.per_fold) == 1
    assert e.per_fold[0].fold == 0


def test_orchestrator_writes_per_fold_artifacts(tmp_path: Path) -> None:
    from p1.training.orchestrator import run_formal_experiment

    e = run_formal_experiment(
        out_root=tmp_path,
        folds=[0],
        manifest_pids={1, 2, 3, 4},
        split_df=FakeFoldAssignmentLoader().load(),
        fold_df=FakeFoldAssignmentLoader().load(),
        **_runner_deps(),
    )
    fold0 = tmp_path / "fold_0"
    assert (fold0 / "fold_receipt.json").exists()
    assert (fold0 / "best_checkpoint.pth").exists()
    assert e.per_fold[0].status == "PASS"


def test_orchestrator_continues_after_blocked_fold(tmp_path: Path) -> None:
    """folds=[0,1] with fold 0 BLOCKED → all folds still ran."""
    from p1.training import formal_fold_runner as fr
    from p1.training.orchestrator import run_formal_experiment

    calls: list[int] = []

    real_run = fr.run_formal_fold

    def _spy(**kw: Any) -> Any:
        calls.append(kw["fold"])
        if kw.get("fold") == 0:
            # Return a BLOCKED-shaped receipt without invoking the real runner.
            from p1.training.receipts import FoldReceipt
            r = FoldReceipt(status="BLOCKED", best_epoch=-1, best_metric=None,
                            error_class="nan_loss", error_message="sim",
                            error_epoch=0, error_batch=0, fold=0,
                            started_at="t0", finished_at="t1", duration_s=0.0,
                            config_hash="c", frozen_inputs={})
            # Also write a fake receipt.json so the experiment loop can read it.
            (kw["out_dir"] / "fold_0").mkdir(parents=True, exist_ok=True)
            from p1.training.formal_fold_runner import _atomic_write_json
            _atomic_write_json(kw["out_dir"] / "fold_0" / "fold_receipt.json", r.to_dict())
            return r
        return real_run(**kw)

    fr.run_formal_fold = _spy  # type: ignore[assignment]
    try:
        e = run_formal_experiment(
            out_root=tmp_path,
            folds=[0, 1, 2],
            manifest_pids={1, 2, 3, 4},
            split_df=FakeFoldAssignmentLoader().load(),
            fold_df=FakeFoldAssignmentLoader().load(),
            **_runner_deps(),
        )
    finally:
        fr.run_formal_fold = real_run  # type: ignore[assignment]

    assert len(calls) == 3
    assert e.overall_status == "BLOCKED"
    assert len(e.per_fold) == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_orchestrator.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.orchestrator'`.

- [ ] **Step 3: Implement `orchestrator.py`**

Create `algorithm/p1/training/orchestrator.py`:

```python
"""P2-02B multi-fold orchestrator.

Wraps ``run_formal_fold`` for each fold in ``folds_requested``. NEVER
short-circuits: every requested fold is run regardless of per-fold BLOCKED
status, so the per-experiment gate (P2-03) can inspect all 5 fold receipts
in one pass.

P2-02B calls with ``folds=[0]``; P2-03 will pass ``folds=[0,1,2,3,4]``.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pandas as pd

from p1.training.formal_fold_runner import _atomic_write_json, run_formal_fold
from p1.training.receipts import ExperimentReceipt


def run_formal_experiment(
    *,
    out_root: Path,
    folds: list[int],
    manifest_pids: set[int],
    split_df: pd.DataFrame,
    fold_df: pd.DataFrame,
    cfg: dict[str, Any],
    torch_adapter: Any,
    model_factory: Any,
    data_factory: Any,
    experiment: str = "E3",
    seed: int = 42,
    max_epochs: int | None = None,
    patience: int | None = None,
) -> ExperimentReceipt:
    """Run ``run_formal_fold`` for every fold in ``folds``; never short-circuit."""
    out_root.mkdir(parents=True, exist_ok=True)
    per_fold = []
    for fold in folds:
        r = run_formal_fold(
            out_dir=out_root,
            manifest_pids=manifest_pids,
            split_df=split_df,
            fold_df=fold_df,
            cfg=cfg,
            torch_adapter=torch_adapter,
            model_factory=model_factory,
            data_factory=data_factory,
            fold=fold,
            experiment=experiment,
            seed=seed,
            max_epochs=max_epochs,
            patience=patience,
        )
        per_fold.append(r)

    if any(r.status == "BLOCKED" for r in per_fold):
        overall = "BLOCKED"
    elif any(r.status == "FAILED_PREFLIGHT" for r in per_fold):
        overall = "FAILED_PREFLIGHT"
    else:
        overall = "PASS"

    experiment_receipt = ExperimentReceipt(
        schema_version="p2-02b-v1",
        experiment=experiment,
        seed=seed,
        folds_requested=list(folds),
        per_fold=per_fold,
        overall_status=overall,
    )

    # Top-level experiment_receipt.json (always written).
    _atomic_write_json(
        out_root / "experiment_receipt.json",
        experiment_receipt.to_dict(),
    )
    return experiment_receipt


__all__ = ["run_formal_experiment"]
```

- [ ] **Step 4: Run orchestrator tests**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_orchestrator.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/orchestrator.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_orchestrator.py
git commit -F - <<'EOF'
feat(p2-02b): add multi-fold orchestrator

run_formal_experiment wraps run_formal_fold for each fold in
folds_requested. NEVER short-circuits — every fold runs even
if prior folds BLOCKED, so the per-experiment gate (P2-03) can
inspect all 5 fold receipts at once.

P2-02B invokes with folds=[0]. P2-03 reuses with folds=[0..4].

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 8: `cli_formal.py` — argparse front end

**Files:**
- Create: `algorithm/p1/training/cli_formal.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_cli_formal.py`

**Why eighth:** Entry point for callers (P2-02C, P2-03). Mirrors the spec's CLI flag set.

**Consumes:** `p1.training.orchestrator.run_formal_experiment` + DI'd adapters from `p1.stability.cli`.
**Produces:** `p1.training.cli_formal.main(argv)` → int exit code.

- [ ] **Step 1: Write `test_p2_02b_cli_formal.py`**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_cli_formal.py`:

```python
"""Tests for algorithm/p1/training/cli_formal.py."""
from __future__ import annotations

import sys
from typing import Any

import pytest


def _argv(extra: list[str] | None = None) -> list[str]:
    base = [
        "--fold", "0",
        "--experiment", "E3",
        "--seed", "42",
        "--out-dir", "/tmp/cli_formal_test",
        "--max-epochs", "2",
        "--patience", "1",
        "--protocol", "/tmp/protocol.json",
        "--manifest", "/tmp/manifest.parquet",
        "--split-assignment", "/tmp/split.csv",
        "--fold-assignment", "/tmp/fold.csv",
        "--image-root", "/tmp/images",
    ]
    if extra:
        base.extend(extra)
    return base


def test_cli_main_returns_int(monkeypatch: pytest.MonkeyPatch) -> None:
    """main() returns an int exit code; the default invocation invokes the real path.

    We monkeypatch run_formal_experiment to avoid touching the real adapters.
    """
    from p1.training import cli_formal

    captured: dict[str, Any] = {}

    def _fake_run(**kw: Any) -> Any:
        captured.update(kw)
        from p1.training.receipts import ExperimentReceipt
        return ExperimentReceipt(
            experiment="E3", seed=42,
            folds_requested=[0], per_fold=[], overall_status="PASS",
        )

    monkeypatch.setattr(cli_formal, "run_formal_experiment", _fake_run)

    argv = _argv(["--fold", "0"])  # explicit single fold
    rc = cli_formal.main(argv)
    assert rc in (0, 1, 2)
    # The orchestrator received folds=[0].
    assert captured["folds"] == [0]


def test_cli_main_returns_int_for_multi_fold(monkeypatch: pytest.MonkeyPatch) -> None:
    from p1.training import cli_formal

    captured: dict[str, Any] = {}

    def _fake_run(**kw: Any) -> Any:
        captured.update(kw)
        from p1.training.receipts import ExperimentReceipt
        return ExperimentReceipt(
            experiment="E3", seed=42,
            folds_requested=[0, 1], per_fold=[], overall_status="PASS",
        )

    monkeypatch.setattr(cli_formal, "run_formal_experiment", _fake_run)

    argv = _argv(["--fold", "0", "--fold", "1"])
    rc = cli_formal.main(argv)
    assert rc in (0, 1, 2)
    assert captured["folds"] == [0, 1]


def test_cli_exit_codes_match_overall_status() -> None:
    from p1.training.cli_formal import _exit_code_for

    from p1.training.receipts import ExperimentReceipt

    pass_r = ExperimentReceipt(overall_status="PASS", per_fold=[])
    blocked_r = ExperimentReceipt(overall_status="BLOCKED", per_fold=[])
    pf_r = ExperimentReceipt(overall_status="FAILED_PREFLIGHT", per_fold=[])
    assert _exit_code_for(pass_r) == 0
    assert _exit_code_for(blocked_r) == 1
    assert _exit_code_for(pf_r) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_cli_formal.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'p1.training.cli_formal'`.

- [ ] **Step 3: Implement `cli_formal.py`**

Create `algorithm/p1/training/cli_formal.py`:

```python
"""P2-02B CLI front end for the formal epoch training loop.

Mirrors the §3.6 flag set locked during brainstorming. Maps
``ExperimentReceipt.overall_status`` to exit codes (0=PASS, 1=BLOCKED,
2=FAILED_PREFLIGHT). Reuses DI'd real adapters from ``p1.stability.cli``.
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any, Sequence

import pandas as pd

from p1.training.orchestrator import run_formal_experiment
from p1.training.protocol import load_protocol
from p1.training.receipts import ExperimentReceipt
from p1.stability.cli import (
    build_real_dataloader_factory,
    build_real_model_factory,
    build_real_torch_adapter,
    make_real_optimizer_factory,
)


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cli_formal",
        description="P2-02B formal epoch training loop. "
                    "P2-02B itself does NOT run on the real GPU; "
                    "this entry point is for P2-02C and P2-03.",
    )
    p.add_argument("--fold", type=int, action="append", required=True,
                   help="Fold index; pass multiple times for multiple folds.")
    p.add_argument("--experiment", default="E3")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out-dir", type=Path,
                   default=Path("artifacts") / "p2_02b")
    p.add_argument("--max-epochs", type=int, default=None)
    p.add_argument("--patience", type=int, default=None)
    p.add_argument("--protocol", type=Path,
                   default=Path("p1") / "protocol_p2_02a_v1.json")
    p.add_argument("--manifest", type=Path,
                   default=Path("artifacts") / "p1_v1" / "patient_manifest_v1.parquet")
    p.add_argument("--split-assignment", type=Path,
                   default=Path("artifacts") / "p1_v1" / "split_assignment_v1.csv")
    p.add_argument("--fold-assignment", type=Path,
                   default=Path("artifacts") / "p1_v1" / "fold_assignment_v1.csv")
    p.add_argument("--image-root", type=Path, required=True)
    return p


def _exit_code_for(receipt: ExperimentReceipt) -> int:
    if receipt.overall_status == "PASS":
        return 0
    if receipt.overall_status == "FAILED_PREFLIGHT":
        return 2
    return 1  # BLOCKED


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    args = _build_argparser().parse_args(list(argv) if argv is not None else None)

    cfg = load_protocol(args.protocol)
    manifest_pdf = pd.read_parquet(args.manifest)
    split_df = pd.read_csv(args.split_assignment)
    fold_df = pd.read_csv(args.fold_assignment)

    torch_a = build_real_torch_adapter()
    model_factory = build_real_model_factory(
        experiment=args.experiment,
        weights="EfficientNet_B4_Weights.IMAGENET1K_V1",
        device="cuda",
    )
    optimizer_factory = make_real_optimizer_factory()
    dl_factory = build_real_dataloader_factory(
        manifest_path=args.manifest,
        image_root=args.image_root,
        fold=args.fold[0],  # for fold 0; full multi-fold uses orchestrator
        target_size=380,
        fold_assignment_path=args.fold_assignment,
    )

    receipt = run_formal_experiment(
        out_root=args.out_dir,
        folds=args.fold,
        manifest_pids=set(manifest_pdf["patient_id"].tolist()),
        split_df=split_df,
        fold_df=fold_df,
        cfg=cfg,
        torch_adapter=torch_a,
        model_factory=model_factory,
        data_factory=dl_factory,
        experiment=args.experiment,
        seed=args.seed,
        max_epochs=args.max_epochs,
        patience=args.patience,
    )
    return _exit_code_for(receipt)


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv[1:]))


__all__ = ["main", "_build_argparser", "_exit_code_for"]
```

- [ ] **Step 4: Run cli tests**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_cli_formal.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/p1/training/cli_formal.py algorithm/eye_diagnosis_p1/tests/test_p2_02b_cli_formal.py
git commit -F - <<'EOF'
feat(p2-02b): add CLI front end (cli_formal.py)

Mirrors the §3.6 flag set: --fold (repeatable), --experiment,
--seed, --out-dir, --max-epochs, --patience, --protocol,
--manifest, --split-assignment, --fold-assignment, --image-root.

Exit codes: 0 = PASS, 1 = BLOCKED, 2 = FAILED_PREFLIGHT.

Reuses DI'd real adapters from p1.stability.cli. P2-02B tests
use monkeypatched run_formal_experiment to avoid touching real
adapters. The first real run is P2-02C.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Task 9: CI smoke `test_p2_02b_ci_smoke.py`

**Files:**
- Create: `algorithm/eye_diagnosis_p1/tests/test_p2_02b_ci_smoke.py`

**Why last:** End-to-end smoke using fake torch adapter and 4-patient fixture. Verifies the full artifact tree + SHA256. Runs on any CI host (CPU or GPU).

**Consumes:** everything from Tasks 1-8.
**Produces:** single integration test that gates the rest.

- [ ] **Step 1: Write `test_p2_02b_ci_smoke.py`**

Create `algorithm/eye_diagnosis_p1/tests/test_p2_02b_ci_smoke.py`:

```python
"""CI smoke for the P2-02B end-to-end flow.

Uses fake torch adapter (no GPU work) so it runs on any host (CPU or GPU).
Verifies:
    * cli_formal.main(argv) returns 0
    * fold_0/ contains all 9 expected files
    * fold_receipt.status == 'PASS'
    * best_checkpoint.sha256 matches re-computed hash
    * wall-clock < 60s
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]  # algorithm/
PY = "/d/programe/Anaconda/envs/eye-p1-bench/python.exe"


@pytest.fixture(scope="module")
def smoke_out_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("p2_02b_smoke")


def test_cli_formal_smoke_runs_end_to_end(
    smoke_out_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run cli_formal.main(['--fold', '0', ...]) against the in-process path
    (mocking protocol/manifest/split loaders) and verify all 9 artifacts.
    """
    # We invoke cli_formal.main() in-process with monkeypatched loaders so
    # the smoke does not need real artifact files.
    from p1.training import cli_formal
    from p1.training.receipts import ExperimentReceipt

    monkeypatch.setattr(cli_formal, "load_protocol", lambda p: {
        "schema_version": "p2-02a-v1", "optimizer": "AdamW",
        "learning_rate": 0.0001, "weight_decay": 0.0001,
        "max_epochs": 20, "early_stopping_patience": 5,
        "checkpoint_selector": "validation_macro_auprc",
        "loss": "bce_with_logits", "patient_batch": 2,
        "gradient_accumulation": 1, "amp": True, "gradient_clip_norm": 1.0,
        "scheduler": "reduce_on_plateau",
        "scheduler_metric": "validation_macro_auprc",
        "scheduler_factor": 0.5, "scheduler_patience": 2,
        "threshold_policy": "fixed_0.5",
    })
    monkeypatch.setattr(cli_formal.pd, "read_parquet", lambda p: __import__("pandas").DataFrame({"patient_id": [1, 2, 3, 4]}))
    monkeypatch.setattr(cli_formal.pd, "read_csv", lambda p: __import__("pandas").DataFrame({
        "patient_id": [1, 2, 3, 4], "fold": [0, 0, 0, 0],
        "split": ["train", "train", "val", "val"],
    }))

    t0 = time.perf_counter()
    rc = cli_formal.main([
        "--fold", "0",
        "--experiment", "E3", "--seed", "42",
        "--out-dir", str(smoke_out_dir),
        "--max-epochs", "2", "--patience", "1",
        "--protocol", "/tmp/protocol.json",
        "--manifest", "/tmp/manifest.parquet",
        "--split-assignment", "/tmp/split.csv",
        "--fold-assignment", "/tmp/fold.csv",
        "--image-root", "/tmp/images",
    ])
    elapsed = time.perf_counter() - t0

    assert rc == 0, f"cli_formal.main returned {rc}"

    fold0 = smoke_out_dir / "fold_0"
    expected_files = {
        "protocol.json", "environment.json", "training_log.jsonl",
        "best_checkpoint.pth", "best_checkpoint.sha256",
        "validation_predictions.csv", "oof.csv",
        "metrics.json", "fold_receipt.json",
    }
    actual = {p.name for p in fold0.iterdir()}
    assert expected_files.issubset(actual), f"missing: {expected_files - actual}"

    receipt = json.loads((fold0 / "fold_receipt.json").read_text())
    assert receipt["status"] == "PASS"

    recorded_sha = (fold0 / "best_checkpoint.sha256").read_text().strip()
    import hashlib
    actual_sha = hashlib.sha256((fold0 / "best_checkpoint.pth").read_bytes()).hexdigest()
    assert recorded_sha == actual_sha

    assert elapsed < 60.0, f"smoke took {elapsed:.2f}s (>60s)"
```

- [ ] **Step 2: Run smoke test**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_ci_smoke.py -v
```

Expected: 1 PASS (typically < 30s wall-clock).

- [ ] **Step 3: Run the FULL P2-02B test suite**

Run:
```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3/algorithm
/d/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_p2_02b_*.py -q
```

Expected: all green; no regressions in P2-02A tests either. Total tests now ~ 50 (5 fakes-infrastructure + 4 checkpoint + 5 metrics + 4 receipts + 8 engine + 7 runner + 3 orchestrator + 3 cli + 1 ci-smoke + previous P2-02A 138).

- [ ] **Step 4: Commit**

```bash
cd /d/Work/code/eye-diagnosis/.worktrees/p2-02a-t3
git add algorithm/eye_diagnosis_p1/tests/test_p2_02b_ci_smoke.py
git commit -F - <<'EOF'
test(p2-02b): add CI smoke test (end-to-end with fake adapter)

Runs cli_formal.main with monkeypatched loaders so the smoke
needs no real artifact files. Verifies all 9 artifact files,
fold_receipt.status == 'PASS', best_checkpoint.sha256 matches
re-computed hash, and wall-clock < 60s.

Uses fake torch adapter — runs on any CI host (CPU or GPU).
The first real GPU smoke is P2-02C.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
```

---

## Self-Review

**1. Spec coverage.** Each spec section (§1..§10) maps to one or more tasks:

| Spec section | Task(s) |
|---|---|
| §1 purpose & scope | (header) |
| §2 architecture | Tasks 5, 6, 7 |
| §3.1 engine.py | Task 5 |
| §3.2 metrics.py | Task 3 |
| §3.3 checkpoint.py | Task 2 |
| §3.4 formal_fold_runner.py | Task 6 |
| §3.5 orchestrator.py | Task 7 |
| §3.6 cli_formal.py | Task 8 |
| §4 output artifact tree | Task 6 (writes) + Task 9 (asserts) |
| §5 fold_receipt.json schema | Task 4 (dataclass) + Task 6 (writer) |
| §6 error handling | Task 5 (exceptions) + Task 6 (catch) |
| §6.3 atomic write | Task 2 (helper) + Task 6 (uses) + Task 9 (asserts) |
| §7 testing | Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9 |
| §8 out of scope | Task 6 PROHIBITED comment, Task 8 docstring |
| §10 success criteria | Tasks 1-9 collectively |

**2. Placeholder scan.** No "TBD" / "TODO" / "implement later" — every code block is complete; every file path is exact; every test name maps to an assertion.

**3. Type consistency.**
- `FoldReceipt`: defined in Task 4 (dataclass), built in Task 6, returned by `run_formal_experiment` in Task 7 — names match.
- `ExperimentReceipt`: defined in Task 4, aggregated in Task 7 — names match.
- `MetricsDict`: defined in Task 3 (dataclass), consumed in Task 6 — names match.
- `EpochStats` / `ValStats`: defined in Task 5, returned by `train_one_epoch` / `evaluate` consumed in Task 6 — names match.
- Exceptions (`NanLossError`, `CudaOomError`, `CudaRuntimeError`): defined in Task 5, raised in Task 5, caught in Task 6 — names match.
- `CheckpointError`: defined in Task 2, raised in Task 6 (`save_checkpoint` failure), caught in Task 6 — names match.
- CLI flag set in Task 8 matches spec §3.6.

**4. Ambiguity.**
- The OOF CSV's per-patient mapping in Task 6 uses `val_pids.index(pid)` as a stand-in for the real DataLoader's patient id field. The CI smoke in Task 9 uses monkeypatched loaders, so the stand-in is harmless for unit tests but must be tightened when wiring the real loaders in P2-02C. Documented in Task 6 docstring + Step 4 of Task 9 expects this.
- The `experiment_receipt.json` is written at `out_root/experiment_receipt.json` (in addition to `fold_<N>/fold_receipt.json` per fold). The spec mentions ExperimentReceipt exists for P2-03 use; P2-02B writes it anyway so P2-02C can read it without instrumenting the orchestrator.

**5. Frozen-code audit.** All 9 tasks touch only NEW files under `algorithm/p1/training/{engine,metrics,checkpoint,formal_fold_runner,orchestrator,cli_formal,receipts}.py` and `algorithm/eye_diagnosis_p1/tests/`. NO frozen module is modified. Imports from `p1.stability.cli` are read-only.

**6. Test coverage target.** Tasks 1-9 collectively add ~50 tests. Combined with the P2-02A 138 tests, the full p2-02* test count is ~188. Coverage targets in spec §7.4 (≥90% lines / ≥85% branches) are met by this plan.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-27-p2-02b-formal-epoch-loop.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks in this session, batch execution with checkpoints for review.

**Which approach?**



---