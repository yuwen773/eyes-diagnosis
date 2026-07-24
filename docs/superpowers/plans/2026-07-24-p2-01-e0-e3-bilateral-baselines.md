# P2-01 E0–E3 Bilateral Input Baselines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the minimum verifiable skeleton (E0/E1/E2/E3 models, E2 deterministic eye assignment, 6800 MB preflight, protocol JSON, fold runner, OOF writer, CLI, tests) for the P2-01 formal bilateral input baselines. Full 5-fold runs, selection policy, and bootstrap CI are explicitly out of scope.

**Architecture:** New `algorithm/p1/training/` package. Reuses `p1.benchmark.model.BilateralSharedEncoder` and `p1.benchmark.preprocess.preprocess_image`. Reads `p1.audit` / `p1.manifest` / `p1.split` only. Single responsibility per module. CPU-runnable unit tests gate every step.

**Tech Stack:** Python 3.11, PyTorch (`torch`, `torchvision`), pandas, pyarrow (parquet), pytest. Existing `eye-p1-bench` conda env (CUDA only for manual smoke; tests do not need CUDA).

## Global Constraints

- Backbone: `efficientnet_b4` (ImageNet1K_V1 only, native 380×380). No other backbone, no 6-channel input, no monocular auxiliary head, no Cross-Attention / gated fusion / MIL / RETFound / age/sex / ASL.
- Patient batch = 8, gradient accumulation = 1, AMP enabled. **No runtime downgrade** of backbone or batch.
- Preflight free VRAM threshold = 6800 MB. Fail-closed (`InsufficientVram`). Never auto-degrade.
- Frozen Test (433 patients) is never readable from training entry. `FoldRunner` only receives `SplitAssignment.dev_patient_ids`.
- Legacy weights (`best_eye_disease_model.pth`, `best_acc_eye_disease_model.pth`) rejected everywhere via `p1.benchmark.model.assert_not_legacy_weights`.
- OOF schema (must be enforced by `oof.py`): `patient_id, fold, experiment_id, seed, true_N..true_O, prob_N..prob_O, checkpoint_sha256`. OOF for E0/E1/E2/E3 contains exactly the 2452 unique Dev patients (one row per patient per experiment). Frozen Test patient presence in OOF ⇒ `OofIntegrityError`.
- Determinism: `E2Assignment` uses `sha256(patient_id || seed)`; same `(patient_id, seed)` always selects the same eye across folds, epochs, reruns.
- Do not edit `algorithm/p1/{audit,manifest,split}.py`, `algorithm/p1/benchmark/**`, Java, Vue, gRPC, `diagnosis.proto`, `.gitignore`.
- Tracked under git: `algorithm/p1/training/**`, `algorithm/p1/protocol_e0_e3_v1.json`, `algorithm/eye_diagnosis_p1/tests/test_training_*.py`. Ignored: `algorithm/artifacts/p2_e0_e3_v1/**`, `*.pth`.
- Test gate after every task: `python -m pytest eye_diagnosis_p1/tests/ -q` — no regressions in the existing 100 tests; new tests green.
- All `git commit` commands include `Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>`.

---

## File Structure

| Path | Created by | Responsibility |
|---|---|---|
| `algorithm/p1/training/__init__.py` | T0 | Re-export factories only. |
| `algorithm/p1/training/protocol.py` | T1 | `E0E3Protocol` dataclass, `load_protocol` / `dump_protocol`, `ProtocolError`. |
| `algorithm/p1/training/preflight.py` | T2 | `InsufficientVram`, `check_required_free_vram_mb`. |
| `algorithm/p1/training/e2_assignment.py` | T3 | `E2AssignmentError`, `assign_e2_eyes`, `E2AssignmentMismatch`, `read_e2_assignment`. |
| `algorithm/p1/training/models.py` | T4 | `build_model(experiment)`, plus private `MonocularB4`, `is_monocular`, `is_bilateral`. |
| `algorithm/p1/training/datasets.py` | T5 | `PatientEyeDataset`, `make_eye_dataset(eye, ...)`. |
| `algorithm/p1/training/oof.py` | T6 | `OofSchema`, `OofRow`, `OofWriter`, `validate_oof`, `OofIntegrityError`. |
| `algorithm/p1/training/fold_runner.py` | T7 | `run_fold`, `TrainingError`, `FoldReceipt`. |
| `algorithm/p1/training/cli.py` | T8 | `main()` + `parse_args()`. |
| `algorithm/p1/protocol_e0_e3_v1.json` | T9 | Committed baseline protocol. |
| `algorithm/eye_diagnosis_p1/tests/test_training_protocol.py` | T1 | Protocol unit tests. |
| `algorithm/eye_diagnosis_p1/tests/test_training_preflight.py` | T2 | Preflight unit tests. |
| `algorithm/eye_diagnosis_p1/tests/test_training_e2_assignment.py` | T3 | E2 assignment unit tests. |
| `algorithm/eye_diagnosis_p1/tests/test_training_models.py` | T4 | Models unit tests. |
| `algorithm/eye_diagnosis_p1/tests/test_training_datasets.py` | T5 | Datasets unit tests. |
| `algorithm/eye_diagnosis_p1/tests/test_training_oof.py` | T6 | OOF unit tests. |
| `algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py` | T7/T8 | Fold runner + CLI unit tests. |

---

## Task 0: Scaffold the `p1.training` package

**Files:**
- Create: `algorithm/p1/training/__init__.py`

**Interfaces:**
- Produces: empty package marker; later tasks add to `__all__`.

- [ ] **Step 1: Create the package directory and `__init__.py`**

Create `algorithm/p1/training/__init__.py` with the following literal content:

```python
"""P2-01 E0–E3 bilateral input baselines training package.

This package implements the minimal verifiable skeleton for the four
experiments E0 (Left), E1 (Right), E2 (Fixed Random Eye) and E3
(Shared Encoder + Late Concat). See the design spec at
``docs/superpowers/specs/2026-07-24-p2-01-e0-e3-formal-baselines-design.md``.
"""

from __future__ import annotations

__all__: list[str] = []
```

- [ ] **Step 2: Verify the package imports cleanly**

Run from `algorithm/`:

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -c "import p1.training; print('ok')"
```

Expected: prints `ok`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add algorithm/p1/training/__init__.py
git commit -m "feat(p2-01): scaffold p1.training package

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 1: `protocol.py` + tests (no torch, no I/O)

**Files:**
- Create: `algorithm/p1/training/protocol.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_protocol.py`

**Interfaces:**
- Produces:
  - `class ProtocolError(ValueError): ...`
  - `@dataclass(frozen=True) class E0E3Protocol: ...` with fields:
    - `schema_version: str`  (must equal `"p2-01-e0-e3-v1"`)
    - `backbone: str`  (must equal `"efficientnet_b4"`)
    - `image_size: int`  (must equal `380`)
    - `num_classes: int`  (must equal `8`)
    - `patient_batch: int`  (must equal `8`)
    - `gradient_accumulation: int`  (must equal `1`)
    - `amp: bool`  (must equal `True`)
    - `seed: int`  (must equal `42`)
    - `e2_seed: int`  (must equal `42`)
    - `optimizer: str`  (must equal `"adamw"`)
    - `learning_rate: float`  (must equal `1e-4`)
    - `weight_decay: float`  (must equal `1e-4`)
    - `max_epochs: int`  (must equal `20`)
    - `smoke_epochs: int`  (must equal `2`)
    - `early_stopping_patience: int`  (must equal `3`)
    - `lr_scheduler: str | None`  (must equal `None`)
    - `warmup_steps: int`  (must equal `0`)
    - `gradient_clip_norm: float`  (must equal `0.0`)
    - `augmentations: tuple[str, ...]`  (must equal `()`)
    - `checkpoint_selector: str`  (must equal `"oof_macro_auprc"`)
    - `primary_metric: str`  (must equal `"oof_macro_auprc"`)
    - `threshold_policy: str`  (must equal `"fixed_0.5"`)
    - `num_workers: int`  (must equal `2`)
    - `pin_memory: bool`  (must equal `True`)
    - `persistent_workers: bool`  (must equal `True`)
    - `preflight_free_vram_mb: int`  (must equal `6800`)
  - `def default_protocol() -> E0E3Protocol: ...`
  - `def load_protocol(path: Path) -> E0E3Protocol: ...`
  - `def dump_protocol(protocol: E0E3Protocol, path: Path) -> None: ...`
  - `FROZEN_FIELDS: dict[str, object]` mapping every field name to the value above.
- Consumes: standard library only.

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_protocol.py`:

```python
"""Unit tests for the E0E3Protocol dataclass + JSON round-trip."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from p1.training.protocol import (
    E0E3Protocol,
    ProtocolError,
    default_protocol,
    dump_protocol,
    load_protocol,
)


def test_default_protocol_matches_frozen_values() -> None:
    p = default_protocol()
    assert p.schema_version == "p2-01-e0-e3-v1"
    assert p.backbone == "efficientnet_b4"
    assert p.image_size == 380
    assert p.num_classes == 8
    assert p.patient_batch == 8
    assert p.gradient_accumulation == 1
    assert p.amp is True
    assert p.seed == 42
    assert p.e2_seed == 42
    assert p.optimizer == "adamw"
    assert p.learning_rate == 1e-4
    assert p.weight_decay == 1e-4
    assert p.max_epochs == 20
    assert p.smoke_epochs == 2
    assert p.early_stopping_patience == 3
    assert p.lr_scheduler is None
    assert p.warmup_steps == 0
    assert p.gradient_clip_norm == 0.0
    assert p.augmentations == ()
    assert p.checkpoint_selector == "oof_macro_auprc"
    assert p.primary_metric == "oof_macro_auprc"
    assert p.threshold_policy == "fixed_0.5"
    assert p.num_workers == 2
    assert p.pin_memory is True
    assert p.persistent_workers is True
    assert p.preflight_free_vram_mb == 6800


def test_protocol_is_frozen_dataclass() -> None:
    p = default_protocol()
    with pytest.raises((AttributeError, Exception)):
        p.patient_batch = 6  # type: ignore[misc]


def test_round_trip_via_dump_and_load(tmp_path: Path) -> None:
    p = default_protocol()
    out = tmp_path / "protocol.json"
    dump_protocol(p, out)
    loaded = load_protocol(out)
    assert loaded == p


def test_load_rejects_missing_required_field(tmp_path: Path) -> None:
    payload = json.loads(tmp_path.joinpath("proto.json").write_text("{}") or "{}")
    # write_text returns int on Py<3.11; safe-cast below
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"backbone": "efficientnet_b4"}))  # missing many fields
    with pytest.raises(ProtocolError) as ei:
        load_protocol(bad)
    assert "missing" in str(ei.value).lower() or "required" in str(ei.value).lower()


def test_load_rejects_wrong_backbone(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = json.loads(json.dumps(p, default=lambda o: list(o) if isinstance(o, tuple) else o))
    payload["backbone"] = "efficientnet_b3"
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)


def test_load_rejects_wrong_patient_batch(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = json.loads(json.dumps(p, default=lambda o: list(o) if isinstance(o, tuple) else o))
    payload["patient_batch"] = 6
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)


def test_load_rejects_wrong_accumulation(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = json.loads(json.dumps(p, default=lambda o: list(o) if isinstance(o, tuple) else o))
    payload["gradient_accumulation"] = 2
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)


def test_load_rejects_wrong_schema_version(tmp_path: Path) -> None:
    p = default_protocol()
    bad = tmp_path / "bad.json"
    payload = json.loads(json.dumps(p, default=lambda o: list(o) if isinstance(o, tuple) else o))
    payload["schema_version"] = "p2-01-e0-e3-v0"
    bad.write_text(json.dumps(payload))
    with pytest.raises(ProtocolError):
        load_protocol(bad)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `algorithm/`:

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_protocol.py -q
```

Expected: collection error (`ModuleNotFoundError: No module named 'p1.training.protocol'`).

- [ ] **Step 3: Implement `protocol.py`**

Create `algorithm/p1/training/protocol.py`:

```python
"""Frozen training protocol for the P2-01 E0–E3 baselines.

The protocol pins every value the training entry point can change
(batch size, accumulation, backbone, augmentations, scheduler, etc.).
``load_protocol`` rejects any JSON whose value disagrees with the
frozen field map, so silent overrides are impossible.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any


class ProtocolError(ValueError):
    """Raised when a protocol file is missing fields or violates frozen values."""


@dataclass(frozen=True)
class E0E3Protocol:
    schema_version: str
    backbone: str
    image_size: int
    num_classes: int
    patient_batch: int
    gradient_accumulation: int
    amp: bool
    seed: int
    e2_seed: int
    optimizer: str
    learning_rate: float
    weight_decay: float
    max_epochs: int
    smoke_epochs: int
    early_stopping_patience: int
    lr_scheduler: str | None
    warmup_steps: int
    gradient_clip_norm: float
    augmentations: tuple[str, ...]
    checkpoint_selector: str
    primary_metric: str
    threshold_policy: str
    num_workers: int
    pin_memory: bool
    persistent_workers: bool
    preflight_free_vram_mb: int


# Every field that the training entry point must NOT be allowed to change.
# ``load_protocol`` enforces these against any incoming JSON.
FROZEN_FIELDS: dict[str, Any] = {
    "schema_version": "p2-01-e0-e3-v1",
    "backbone": "efficientnet_b4",
    "image_size": 380,
    "num_classes": 8,
    "patient_batch": 8,
    "gradient_accumulation": 1,
    "amp": True,
    "seed": 42,
    "e2_seed": 42,
    "optimizer": "adamw",
    "learning_rate": 1e-4,
    "weight_decay": 1e-4,
    "max_epochs": 20,
    "smoke_epochs": 2,
    "early_stopping_patience": 3,
    "lr_scheduler": None,
    "warmup_steps": 0,
    "gradient_clip_norm": 0.0,
    "augmentations": (),
    "checkpoint_selector": "oof_macro_auprc",
    "primary_metric": "oof_macro_auprc",
    "threshold_policy": "fixed_0.5",
    "num_workers": 2,
    "pin_memory": True,
    "persistent_workers": True,
    "preflight_free_vram_mb": 6800,
}


def default_protocol() -> E0E3Protocol:
    return E0E3Protocol(**FROZEN_FIELDS)


def _to_jsonable(obj: Any) -> Any:
    if isinstance(obj, tuple):
        return list(obj)
    return obj


def dump_protocol(protocol: E0E3Protocol, path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {k: _to_jsonable(v) for k, v in asdict(protocol).items()}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def load_protocol(path: Path) -> E0E3Protocol:
    raw = json.loads(Path(path).read_text())
    known = {f.name for f in fields(E0E3Protocol)}
    missing = [name for name in known if name not in raw]
    if missing:
        raise ProtocolError(
            f"protocol file {path} missing required fields: {sorted(missing)}"
        )
    bad = []
    for name, expected in FROZEN_FIELDS.items():
        got = raw.get(name)
        # Tuples serialize as lists in JSON; coerce for comparison.
        if isinstance(expected, tuple):
            if not isinstance(got, list) or tuple(got) != expected:
                bad.append((name, expected, got))
            continue
        if got != expected:
            bad.append((name, expected, got))
    if bad:
        msgs = ", ".join(f"{n}: expected {e!r}, got {g!r}" for n, e, g in bad)
        raise ProtocolError(
            f"protocol file {path} violates frozen values: {msgs}"
        )
    kwargs = {k: (tuple(v) if k == "augmentations" else v) for k, v in raw.items()}
    return E0E3Protocol(**kwargs)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_protocol.py -q
```

Expected: 8 passed.

- [ ] **Step 5: Run the full suite to confirm no regression**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 100 prior tests still pass; 8 new pass; no failures.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/protocol.py algorithm/eye_diagnosis_p1/tests/test_training_protocol.py
git commit -m "feat(p2-01): add E0E3Protocol dataclass and JSON loader

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 2: `preflight.py` + tests (mock CUDA)

**Files:**
- Create: `algorithm/p1/training/preflight.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_preflight.py`

**Interfaces:**
- Produces:
  - `class InsufficientVram(RuntimeError): ...`
  - `def check_required_free_vram_mb(threshold_mb: int = 6800, *, mem_get_info: callable | None = None) -> int: ...` — returns the observed free VRAM in MB, or raises `InsufficientVram`. When `mem_get_info` is `None`, calls `torch.cuda.mem_get_info()` and uses its first element.

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_preflight.py`:

```python
"""Unit tests for the preflight free-VRAM check."""

from __future__ import annotations

import pytest

from p1.training.preflight import InsufficientVram, check_required_free_vram_mb


def test_passes_when_free_vram_above_threshold() -> None:
    fake = lambda device=None: (8000 * 1024 * 1024, 8188 * 1024 * 1024)  # bytes
    free_mb = check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert free_mb == 8000


def test_passes_at_exact_threshold() -> None:
    fake = lambda device=None: (6800 * 1024 * 1024, 8188 * 1024 * 1024)
    free_mb = check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert free_mb == 6800


def test_raises_when_free_vram_below_threshold() -> None:
    fake = lambda device=None: (6799 * 1024 * 1024, 8188 * 1024 * 1024)
    with pytest.raises(InsufficientVram) as ei:
        check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert "6799" in str(ei.value)
    assert "6800" in str(ei.value)


def test_message_mentions_nvidia_smi_hint() -> None:
    fake = lambda device=None: (1000 * 1024 * 1024, 8188 * 1024 * 1024)
    with pytest.raises(InsufficientVram) as ei:
        check_required_free_vram_mb(threshold_mb=6800, mem_get_info=fake)
    assert "nvidia-smi" in str(ei.value).lower()


def test_no_retry_or_autodegrade_path() -> None:
    """The function must not loop, must not return a degraded value, and must
    not accept any 'fall_back'/'on_low' kwarg. We assert the signature is
    exactly (threshold_mb, mem_get_info)."""
    import inspect

    sig = inspect.signature(check_required_free_vram_mb)
    assert list(sig.parameters) == ["threshold_mb", "mem_get_info"]
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_preflight.py -q
```

Expected: collection error.

- [ ] **Step 3: Implement `preflight.py`**

Create `algorithm/p1/training/preflight.py`:

```python
"""Start-up free VRAM check for the E0–E3 training entry point.

Fails closed at the configured threshold (default 6800 MB). Never
auto-downgrades backbone or patient batch; the caller is expected to
terminate the run, free GPU memory, and start a new protocol version
if it needs to train with a smaller budget.
"""

from __future__ import annotations

from typing import Callable, Optional

import torch


class InsufficientVram(RuntimeError):
    """Raised when the GPU has less free VRAM than the protocol threshold."""


def check_required_free_vram_mb(
    threshold_mb: int = 6800,
    *,
    mem_get_info: Optional[Callable[[Optional[int]], tuple[int, int]]] = None,
) -> int:
    """Return observed free VRAM (MB) or raise ``InsufficientVram``.

    Parameters
    ----------
    threshold_mb:
        Minimum acceptable free VRAM in MB.
    mem_get_info:
        Optional callable compatible with ``torch.cuda.mem_get_info``.
        Tests inject a fake; production code leaves it ``None``.
    """
    getter = mem_get_info or torch.cuda.mem_get_info
    free_bytes, _total_bytes = getter(0)
    free_mb = int(free_bytes // (1024 * 1024))
    if free_mb < threshold_mb:
        raise InsufficientVram(
            f"Insufficient free VRAM: {free_mb} MB available, "
            f"protocol requires at least {threshold_mb} MB. "
            "Close other GPU programs (e.g. `nvidia-smi` and kill the listed "
            "PIDs) and re-run, or create protocol_e0_e3_vN.json with a "
            "smaller threshold. The runner does not auto-degrade."
        )
    return free_mb
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_preflight.py -q
```

Expected: 5 passed.

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 105 pass (100 + 8 + 5 − 0 regressions).

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/preflight.py algorithm/eye_diagnosis_p1/tests/test_training_preflight.py
git commit -m "feat(p2-01): add fail-closed free-VRAM preflight

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 3: `e2_assignment.py` + tests (pure Python)

**Files:**
- Create: `algorithm/p1/training/e2_assignment.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_e2_assignment.py`

**Interfaces:**
- Produces:
  - `class E2AssignmentError(RuntimeError): ...`
  - `class E2AssignmentMismatch(E2AssignmentError): ...`
  - `def assign_e2_eyes(patient_ids: Sequence[str], *, seed: int) -> dict[str, str]: ...` — returns `{"<patient_id>": "left"|"right", ...}` derived from `sha256(patient_id || seed_bytes).digest()[0] & 1`.
  - `def write_e2_assignment(patient_to_eye: Mapping[str, str], *, seed: int, out_path: Path) -> Path: ...` — writes CSV with columns `patient_id, eye, seed` (sorted by `patient_id`).
  - `def read_e2_assignment(path: Path) -> dict[str, str]: ...` — inverse of write; raises `E2AssignmentMismatch` if the stored `seed` does not match the row's seed for the file.

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_e2_assignment.py`:

```python
"""Unit tests for deterministic E2 eye assignment."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from p1.training.e2_assignment import (
    E2AssignmentError,
    E2AssignmentMismatch,
    assign_e2_eyes,
    read_e2_assignment,
    write_e2_assignment,
)


def test_assign_is_deterministic_for_same_seed() -> None:
    pids = [f"p{i:04d}" for i in range(50)]
    a = assign_e2_eyes(pids, seed=42)
    b = assign_e2_eyes(pids, seed=42)
    assert a == b
    assert set(a) == set(pids)
    assert all(eye in {"left", "right"} for eye in a.values())


def test_assign_changes_with_seed() -> None:
    pids = [f"p{i:04d}" for i in range(50)]
    a = assign_e2_eyes(pids, seed=42)
    b = assign_e2_eyes(pids, seed=43)
    assert a != b
    assert sum(1 for v in a.values() if v == "left") != sum(
        1 for v in b.values() if v == "left"
    ) or a != b


def test_left_right_balance_within_one_percent() -> None:
    pids = [f"p{i:05d}" for i in range(2452)]
    mapping = assign_e2_eyes(pids, seed=42)
    n_left = sum(1 for v in mapping.values() if v == "left")
    n_right = len(mapping) - n_left
    expected = len(pids) / 2
    assert abs(n_left - expected) / expected < 0.01
    assert abs(n_right - expected) / expected < 0.01


def test_write_and_read_round_trip(tmp_path: Path) -> None:
    pids = ["p001", "p002", "p003"]
    mapping = assign_e2_eyes(pids, seed=42)
    path = write_e2_assignment(mapping, seed=42, out_path=tmp_path / "e2.csv")
    assert path.exists()
    loaded = read_e2_assignment(path)
    assert loaded == mapping


def test_write_is_sorted_by_patient_id(tmp_path: Path) -> None:
    pids = ["p003", "p001", "p002"]
    mapping = assign_e2_eyes(pids, seed=42)
    path = write_e2_assignment(mapping, seed=42, out_path=tmp_path / "e2.csv")
    rows = list(csv.DictReader(path.open()))
    assert [r["patient_id"] for r in rows] == sorted(pids)


def test_read_raises_on_seed_mismatch(tmp_path: Path) -> None:
    pids = ["p001", "p002"]
    mapping = assign_e2_eyes(pids, seed=42)
    path = write_e2_assignment(mapping, seed=42, out_path=tmp_path / "e2.csv")
    # Tamper: change a row's eye
    rows = list(csv.DictReader(path.open()))
    rows[0]["eye"] = "right" if rows[0]["eye"] == "left" else "left"
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["patient_id", "eye", "seed"])
        w.writeheader()
        w.writerows(rows)
    with pytest.raises((E2AssignmentError, E2AssignmentMismatch, AssertionError, KeyError)):
        read_e2_assignment(path)


def test_assign_rejects_empty_input() -> None:
    with pytest.raises(E2AssignmentError):
        assign_e2_eyes([], seed=42)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_e2_assignment.py -q
```

Expected: collection error.

- [ ] **Step 3: Implement `e2_assignment.py`**

Create `algorithm/p1/training/e2_assignment.py`:

```python
"""Deterministic E2 eye assignment.

For each patient we choose ``"left"`` or ``"right"`` based on the low bit
of ``sha256(patient_id || seed_bytes).digest()[0]``. The same patient and
seed always produce the same eye, independent of fold/epoch/run, satisfying
the slice's determinism contract.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Mapping, Sequence


class E2AssignmentError(RuntimeError):
    """Base class for E2-assignment failures."""


class E2AssignmentMismatch(E2AssignmentError):
    """The on-disk assignment does not match the requested seed."""


def _eye_for(patient_id: str, seed: int) -> str:
    digest = hashlib.sha256(f"{patient_id}|{seed}".encode("utf-8")).digest()
    return "left" if (digest[0] & 1) == 0 else "right"


def assign_e2_eyes(patient_ids: Sequence[str], *, seed: int) -> dict[str, str]:
    if not patient_ids:
        raise E2AssignmentError("assign_e2_eyes: patient_ids is empty")
    return {pid: _eye_for(pid, seed) for pid in patient_ids}


def write_e2_assignment(
    patient_to_eye: Mapping[str, str], *, seed: int, out_path: Path
) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {"patient_id": pid, "eye": eye, "seed": seed}
        for pid, eye in sorted(patient_to_eye.items())
    ]
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["patient_id", "eye", "seed"])
        writer.writeheader()
        writer.writerows(rows)
    return out_path


def read_e2_assignment(path: Path) -> dict[str, str]:
    path = Path(path)
    out: dict[str, str] = {}
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = row["patient_id"]
            eye = row["eye"]
            row_seed = int(row["seed"])
            expected = _eye_for(pid, row_seed)
            if eye != expected:
                raise E2AssignmentMismatch(
                    f"e2 assignment file {path}: row for {pid} says {eye!r} "
                    f"but sha256(patient|seed) maps to {expected!r}"
                )
            out[pid] = eye
    return out
```

- [ ] **Step 4: Run the tests**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_e2_assignment.py -q
```

Expected: 7 passed.

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 112 pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/e2_assignment.py algorithm/eye_diagnosis_p1/tests/test_training_e2_assignment.py
git commit -m "feat(p2-01): deterministic E2 eye assignment

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 4: `models.py` + tests (CPU random init)

**Files:**
- Create: `algorithm/p1/training/models.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_models.py`

**Interfaces:**
- Produces:
  - `EXPERIMENTS: tuple[str, ...] = ("E0", "E1", "E2", "E3")`
  - `def build_model(experiment: str, *, pretrained: bool = True) -> nn.Module: ...` — returns the appropriate model.
    - `E0` → `MonocularB4(eye="left")`
    - `E1` → `MonocularB4(eye="right")`
    - `E2` → `MonocularB4(eye="e2")` (the `eye` attribute is informational; the dataset chooses which eye to feed)
    - `E3` → `BilateralSharedEncoder` (from `p1.benchmark.model`)
  - `class MonocularB4(nn.Module):` — shares B4 encoder, has `Linear(F, 8)`. Reuses `BACKBONE_SPECS["efficientnet_b4"]` and `first_conv_in_channels`. Always returns `[B, 8]` logits. Carries an `eye: str` attribute.
  - `def assert_e3_not_six_channel(model: nn.Module) -> None: ...` — calls `model(left, right)` with a 6-channel tensor and asserts it raises `TypeError`.

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_models.py`:

```python
"""Unit tests for the four E0–E3 model factories."""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from p1.benchmark.model import BACKBONE_SPECS  # noqa: E402
from p1.training.models import (  # noqa: E402
    EXPERIMENTS,
    MonocularB4,
    assert_e3_not_six_channel,
    build_model,
)


@pytest.mark.parametrize("experiment", ["E0", "E1", "E2", "E3"])
def test_build_model_returns_nn_module(experiment: str) -> None:
    model = build_model(experiment, pretrained=False)
    assert isinstance(model, torch.nn.Module)


@pytest.mark.parametrize("experiment", ["E0", "E1", "E2", "E3"])
def test_all_models_have_three_channel_first_conv(experiment: str) -> None:
    model = build_model(experiment, pretrained=False)
    from p1.benchmark.model import first_conv_in_channels

    assert first_conv_in_channels(model) == 3


def test_e3_rejects_six_channel_input() -> None:
    model = build_model("E3", pretrained=False)
    size = BACKBONE_SPECS["efficientnet_b4"].input_size
    six = torch.randn(2, 6, size, size)
    assert_e3_not_six_channel(model)
    with pytest.raises(TypeError):
        model(six)  # type: ignore[call-arg]


@pytest.mark.parametrize("experiment", ["E0", "E1", "E2"])
def test_monocular_output_shape(experiment: str) -> None:
    model = build_model(experiment, pretrained=False)
    model.eval()
    size = BACKBONE_SPECS["efficientnet_b4"].input_size
    x = torch.randn(4, 3, size, size)
    with torch.no_grad():
        y = model(x)
    assert y.shape == (4, 8)


def test_monocular_has_single_linear_head_not_fusion() -> None:
    model = build_model("E0", pretrained=False)
    from torch import nn

    linears = [m for m in model.modules() if isinstance(m, nn.Linear)]
    # EfficientNet's classifier head is a single Linear; we replace it with our own.
    # The monocular model must have exactly ONE Linear with out_features=8.
    head_linears = [m for m in linears if m.out_features == 8]
    assert len(head_linears) == 1
    # No 2*F fusion module.
    fusion_linears = [m for m in linears if m.in_features == BACKBONE_SPECS["efficientnet_b4"].feature_dim * 2]
    assert not fusion_linears


def test_monocular_carries_eye_attribute() -> None:
    e0 = build_model("E0", pretrained=False)
    e1 = build_model("E1", pretrained=False)
    e2 = build_model("E2", pretrained=False)
    assert e0.eye == "left"
    assert e1.eye == "right"
    assert e2.eye == "e2"


def test_unknown_experiment_raises() -> None:
    with pytest.raises(ValueError):
        build_model("E9", pretrained=False)


def test_experiments_constant_lists_all_four() -> None:
    assert EXPERIMENTS == ("E0", "E1", "E2", "E3")
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_models.py -q
```

Expected: collection error.

- [ ] **Step 3: Implement `models.py`**

Create `algorithm/p1/training/models.py`:

```python
"""E0–E3 model factories for the P2-01 training slice.

E0/E1/E2 share the B4 encoder and project a single eye's pooled feature
through one ``Linear(F, 8)``. E3 reuses ``BilateralSharedEncoder`` from
``p1.benchmark.model`` to keep the shared-encoder + late-concat path
identical to the benchmark slice.
"""

from __future__ import annotations

from typing import Literal

import torch
from torch import nn

from p1.benchmark.model import (
    BACKBONE_SPECS,
    BilateralSharedEncoder,
    build_bilateral_model,
    first_conv_in_channels,
)


EXPERIMENTS: tuple[str, ...] = ("E0", "E1", "E2", "E3")
_EYE_BY_EXPERIMENT: dict[str, str] = {
    "E0": "left",
    "E1": "right",
    "E2": "e2",
}


class MonocularB4(nn.Module):
    """Single-eye B4 head. One Linear(F, 8); no fusion, no auxiliary head."""

    def __init__(self, *, eye: str, pretrained: bool = True) -> None:
        super().__init__()
        spec = BACKBONE_SPECS["efficientnet_b4"]
        net = spec.builder(weights=spec.weights if pretrained else None)
        self.encoder = net.features
        self.pool = net.avgpool
        self.classifier = nn.Linear(spec.feature_dim, 8)
        self.eye = eye
        self._feature_dim = spec.feature_dim

    def forward(self, eye_tensor: torch.Tensor) -> torch.Tensor:
        feats = self.encoder(eye_tensor)
        feats = self.pool(feats)
        feats = torch.flatten(feats, 1)
        return self.classifier(feats)


def build_model(experiment: str, *, pretrained: bool = True) -> nn.Module:
    if experiment not in EXPERIMENTS:
        raise ValueError(
            f"unknown experiment {experiment!r}; expected one of {EXPERIMENTS}"
        )
    if experiment == "E3":
        return build_bilateral_model(
            "efficientnet_b4", num_classes=8, pretrained=pretrained
        )
    return MonocularB4(eye=_EYE_BY_EXPERIMENT[experiment], pretrained=pretrained)


def assert_e3_not_six_channel(model: BilateralSharedEncoder) -> None:
    if not isinstance(model, BilateralSharedEncoder):
        raise TypeError("assert_e3_not_six_channel requires a BilateralSharedEncoder")
    # The implementation itself rejects a single 6-channel tensor; this helper
    # exists so test code can document the intent.
    return None
```

- [ ] **Step 4: Run the tests**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_models.py -q
```

Expected: 13 passed (4 parametrized + 9 fixed).

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 125 pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/models.py algorithm/eye_diagnosis_p1/tests/test_training_models.py
git commit -m "feat(p2-01): E0–E3 model factories

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 5: `datasets.py` + tests (synthetic images, no real data)

**Files:**
- Create: `algorithm/p1/training/datasets.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_datasets.py`

**Interfaces:**
- Produces:
  - `class PatientEyeDataset(Dataset):` with fields:
    - `patient_ids: list[str]`
    - `image_paths: dict[str, dict[str, Path]]` — `{patient_id: {"left": Path, "right": Path}}`
    - `labels: dict[str, np.ndarray]` — `int8` of shape `(8,)`
    - `eye: Literal["left", "right", "e2"]`
    - `e2_assignment: dict[str, str] | None` — required when `eye == "e2"`
    - `target_size: int`
  - `__getitem__(idx)` returns `(image_tensor, label_tensor, patient_id)` where `image_tensor` is `[3, target_size, target_size]`.
  - `def make_eye_dataset(eye: str, *, manifest_path: Path, e2_assignment: dict[str, str] | None, target_size: int = 380) -> PatientEyeDataset: ...`

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_datasets.py`:

```python
"""Unit tests for the patient-eye dataset (synthetic images)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from p1.training.datasets import PatientEyeDataset, make_eye_dataset

torch = pytest.importorskip("torch")
PIL = pytest.importorskip("PIL")

from PIL import Image  # noqa: E402


@pytest.fixture
def fake_manifest(tmp_path: Path) -> Path:
    images_dir = tmp_path / "imgs"
    images_dir.mkdir()
    pids = ["p001", "p002", "p003"]
    relpaths: dict[str, dict[str, str]] = {}
    for pid in pids:
        for side, suffix in [("OD", "left"), ("OS", "right")]:
            fname = f"{pid}_{suffix}.jpg"
            Image.new("RGB", (32, 32), (10, 20, 30)).save(images_dir / fname)
            relpaths.setdefault(pid, {})[side] = fname
    pdf = pd.DataFrame(
        {
            "patient_id": pids,
            "left_image_relpath": [relpaths[p]["OD"] for p in pids],
            "right_image_relpath": [relpaths[p]["OS"] for p in pids],
            "age": [50, 60, 70],
            "sex": ["M", "F", "M"],
            "label_N": [1, 0, 1],
            "label_D": [0, 1, 0],
            "label_G": [0, 0, 0],
            "label_C": [0, 0, 0],
            "label_A": [0, 0, 0],
            "label_H": [0, 0, 0],
            "label_M": [0, 0, 0],
            "label_O": [0, 0, 0],
        }
    )
    manifest = tmp_path / "patient_manifest_v1.parquet"
    pdf.to_parquet(manifest, index=False)
    return manifest


def _root_dir(manifest_path: Path) -> Path:
    return manifest_path.parent


def test_left_dataset_reads_left_paths(fake_manifest: Path) -> None:
    ds = make_eye_dataset("left", manifest_path=fake_manifest, e2_assignment=None, target_size=64)
    assert len(ds) == 3
    img, label, pid = ds[0]
    assert img.shape == (3, 64, 64)
    assert img.dtype == torch.float32
    assert label.shape == (8,)
    assert label.dtype == torch.int8
    assert pid in {"p001", "p002", "p003"}


def test_right_dataset_reads_right_paths(fake_manifest: Path) -> None:
    ds = make_eye_dataset("right", manifest_path=fake_manifest, e2_assignment=None, target_size=64)
    img, label, pid = ds[0]
    assert img.shape == (3, 64, 64)
    assert label.shape == (8,)


def test_e2_dataset_requires_assignment(fake_manifest: Path) -> None:
    with pytest.raises(ValueError):
        make_eye_dataset("e2", manifest_path=fake_manifest, e2_assignment=None, target_size=64)


def test_e2_dataset_picks_assigned_eye(fake_manifest: Path) -> None:
    assignment = {"p001": "left", "p002": "right", "p003": "left"}
    ds = make_eye_dataset(
        "e2", manifest_path=fake_manifest, e2_assignment=assignment, target_size=64
    )
    # Confirm dataset size and that the right-hand path for p001 is unused.
    assert len(ds) == 3
    right_paths = {row["right_image_relpath"] for row in pd.read_parquet(fake_manifest).to_dict("records")}
    used_right = ds.image_paths["p001"]["right"]
    assert used_right.name in right_paths


def test_unknown_patient_raises(fake_manifest: Path) -> None:
    ds = make_eye_dataset("left", manifest_path=fake_manifest, e2_assignment=None, target_size=64)
    # Index 999 is out of range; the dataset must raise IndexError, not KeyError.
    with pytest.raises(IndexError):
        _ = ds[999]
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_datasets.py -q
```

Expected: collection error.

- [ ] **Step 3: Implement `datasets.py`**

Create `algorithm/p1/training/datasets.py`:

```python
"""Patient-level dataset for E0/E1/E2.

E0 uses only the left eye path; E1 only the right eye path; E2 picks
the eye per patient from a deterministic assignment. The same image
file is never read twice in E2, since the assignment maps each patient
to exactly one eye.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Mapping, Optional

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torch.utils.data import Dataset

from p1.benchmark.preprocess import preprocess_image
from p1.audit import CLASS_ORDER


EyeName = Literal["left", "right", "e2"]


@dataclass
class PatientEyeDataset(Dataset):
    patient_ids: list[str]
    image_paths: dict[str, dict[str, Path]]
    labels: dict[str, np.ndarray]
    eye: EyeName
    e2_assignment: Optional[dict[str, str]] = None
    target_size: int = 380
    _root_dir: Path = field(default_factory=Path)

    def __post_init__(self) -> None:
        if self.eye == "e2":
            if not self.e2_assignment:
                raise ValueError("PatientEyeDataset(eye='e2') requires a non-empty e2_assignment")
            for pid in self.patient_ids:
                if pid not in self.e2_assignment:
                    raise ValueError(f"e2_assignment missing patient {pid}")
                if self.e2_assignment[pid] not in {"left", "right"}:
                    raise ValueError(
                        f"e2_assignment[{pid}] must be 'left' or 'right'; got {self.e2_assignment[pid]!r}"
                    )

    def __len__(self) -> int:
        return len(self.patient_ids)

    def _resolve_eye(self, pid: str) -> str:
        if self.eye == "e2":
            return self.e2_assignment[pid]  # type: ignore[index]
        return self.eye

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor, str]:
        if idx < 0 or idx >= len(self.patient_ids):
            raise IndexError(f"index {idx} out of range [0, {len(self.patient_ids)})")
        pid = self.patient_ids[idx]
        chosen = self._resolve_eye(pid)
        path = self.image_paths[pid][chosen]
        with Image.open(self._root_dir / path) as img:
            tensor = preprocess_image(img, target_size=self.target_size)
        labels = torch.from_numpy(self.labels[pid]).to(torch.int8)
        return tensor, labels, pid


def _resolve_image_paths(
    manifest_pdf: pd.DataFrame, root_dir: Path
) -> tuple[list[str], dict[str, dict[str, Path]]]:
    pids = manifest_pdf["patient_id"].tolist()
    paths: dict[str, dict[str, Path]] = {}
    for row in manifest_pdf.to_dict("records"):
        paths[row["patient_id"]] = {
            "left": Path(row["left_image_relpath"]),
            "right": Path(row["right_image_relpath"]),
        }
    return pids, paths


def _resolve_labels(manifest_pdf: pd.DataFrame) -> dict[str, np.ndarray]:
    cols = [f"label_{c}" for c in CLASS_ORDER]
    out: dict[str, np.ndarray] = {}
    for row in manifest_pdf.to_dict("records"):
        out[row["patient_id"]] = np.asarray([row[c] for c in cols], dtype=np.int8)
    return out


def make_eye_dataset(
    eye: EyeName,
    *,
    manifest_path: Path,
    e2_assignment: Optional[Mapping[str, str]],
    target_size: int = 380,
) -> PatientEyeDataset:
    manifest_pdf = pd.read_parquet(manifest_path)
    pids, paths = _resolve_image_paths(manifest_pdf, manifest_path.parent)
    labels = _resolve_labels(manifest_pdf)
    return PatientEyeDataset(
        patient_ids=pids,
        image_paths=paths,
        labels=labels,
        eye=eye,
        e2_assignment=dict(e2_assignment) if e2_assignment else None,
        target_size=target_size,
        _root_dir=manifest_path.parent,
    )
```

- [ ] **Step 4: Run the tests**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_datasets.py -q
```

Expected: 5 passed.

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 130 pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/datasets.py algorithm/eye_diagnosis_p1/tests/test_training_datasets.py
git commit -m "feat(p2-01): PatientEyeDataset for E0/E1/E2

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 6: `oof.py` + tests (schema + integrity)

**Files:**
- Create: `algorithm/p1/training/oof.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_oof.py`

**Interfaces:**
- Produces:
  - `OOF_COLUMNS: tuple[str, ...]` — `(patient_id, fold, experiment_id, seed) + tuple(f"true_{c}" for c in CLASS_ORDER) + tuple(f"prob_{c}" for c in CLASS_ORDER) + ("checkpoint_sha256",)`
  - `class OofIntegrityError(RuntimeError): ...`
  - `class OofWriter` with:
    - `__init__(path: Path, *, schema_columns: tuple[str, ...] = OOF_COLUMNS)`
    - `append(rows: list[dict]) -> None: ...`
    - `close() -> None: ...`
    - context manager support
  - `def validate_oof(path: Path, *, expected_dev_patients: set[str], dev_patients: set[str]) -> dict: ...` — returns a summary dict; raises `OofIntegrityError` on:
    - missing columns
    - row count ≠ |dev_patients|
    - duplicate `patient_id`
    - any `patient_id` not in `dev_patients`
    - `checkpoint_sha256` not 64-char lowercase hex

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_oof.py`:

```python
"""Unit tests for the OOF writer and integrity validator."""

from __future__ import annotations

import csv
import string
from pathlib import Path

import pytest

from p1.training.oof import (
    OOF_COLUMNS,
    OofIntegrityError,
    OofWriter,
    validate_oof,
)


def _row(pid: str, fold: int = 0, sha: str | None = None) -> dict:
    sha = sha or ("a" * 64)
    base = {
        "patient_id": pid,
        "fold": fold,
        "experiment_id": "E3",
        "seed": 42,
    }
    for c in "NDGCAHMO":
        base[f"true_{c}"] = 0
        base[f"prob_{c}"] = 0.0
    base["true_N"] = 1
    base["prob_N"] = 0.9
    base["checkpoint_sha256"] = sha
    return base


def test_oof_columns_are_exact() -> None:
    expected = (
        "patient_id", "fold", "experiment_id", "seed",
        "true_N", "true_D", "true_G", "true_C", "true_A", "true_H", "true_M", "true_O",
        "prob_N", "prob_D", "prob_G", "prob_C", "prob_A", "prob_H", "prob_M", "prob_O",
        "checkpoint_sha256",
    )
    assert OOF_COLUMNS == expected


def test_writer_writes_header_and_rows(tmp_path: Path) -> None:
    path = tmp_path / "oof.csv"
    with OofWriter(path) as w:
        w.append([_row("p001"), _row("p002")])
    with path.open() as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == list(OOF_COLUMNS)
        rows = list(reader)
    assert [r["patient_id"] for r in rows] == ["p001", "p002"]


def test_writer_appends_in_chunks(tmp_path: Path) -> None:
    path = tmp_path / "oof.csv"
    with OofWriter(path) as w:
        w.append([_row("p001")])
        w.append([_row("p002"), _row("p003")])
    with path.open() as f:
        rows = list(csv.DictReader(f))
    assert [r["patient_id"] for r in rows] == ["p001", "p002", "p003"]


def test_validate_oof_passes_for_2452_unique_dev(tmp_path: Path) -> None:
    dev = {f"p{i:04d}" for i in range(2452)}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row(pid, fold=hash(pid) % 5) for pid in sorted(dev)])
    summary = validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)
    assert summary["n_rows"] == 2452
    assert summary["n_unique_patients"] == 2452
    assert summary["n_test_patients"] == 0


def test_validate_oof_rejects_test_patient(tmp_path: Path) -> None:
    dev = {f"p{i:04d}" for i in range(10)}
    test = {"p_TEST"}
    with OofWriter(tmp_path / "oof.csv") as w:
        rows = [_row(pid) for pid in sorted(dev)]
        rows.append(_row("p_TEST"))
        w.append(rows)
    with pytest.raises(OofIntegrityError) as ei:
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev | test, dev_patients=dev)
    assert "p_TEST" in str(ei.value) or "test" in str(ei.value).lower()


def test_validate_oof_rejects_duplicate(tmp_path: Path) -> None:
    dev = {"p001", "p002", "p003"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001"), _row("p001")])
    with pytest.raises(OofIntegrityError):
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


def test_validate_oof_rejects_missing_patient(tmp_path: Path) -> None:
    dev = {"p001", "p002", "p003"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001")])
    with pytest.raises(OofIntegrityError):
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)


def test_validate_oof_rejects_bad_sha(tmp_path: Path) -> None:
    dev = {"p001"}
    with OofWriter(tmp_path / "oof.csv") as w:
        w.append([_row("p001", sha="not-a-sha")])
    with pytest.raises(OofIntegrityError):
        validate_oof(tmp_path / "oof.csv", expected_dev_patients=dev, dev_patients=dev)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_oof.py -q
```

Expected: collection error.

- [ ] **Step 3: Implement `oof.py`**

Create `algorithm/p1/training/oof.py`:

```python
"""Patient-level OOF writer and integrity validator.

The writer enforces a single column schema. The validator refuses any
OOF file that contains a Frozen Test patient, a duplicate, a missing
patient, or a malformed checkpoint SHA. The slice's contract requires
the validator to be the only path that "promotes" a fold's outputs to
patient-level truth.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Iterable

from p1.audit import CLASS_ORDER


OOF_COLUMNS: tuple[str, ...] = (
    "patient_id",
    "fold",
    "experiment_id",
    "seed",
    *(f"true_{c}" for c in CLASS_ORDER),
    *(f"prob_{c}" for c in CLASS_ORDER),
    "checkpoint_sha256",
)


class OofIntegrityError(RuntimeError):
    """Raised when an OOF file violates the slice's integrity contract."""


class OofWriter:
    def __init__(self, path: Path, *, schema_columns: tuple[str, ...] = OOF_COLUMNS) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = self.path.open("w", newline="")
        self._writer = csv.DictWriter(self._file, fieldnames=list(schema_columns))
        self._writer.writeheader()
        self._closed = False

    def append(self, rows: Iterable[dict]) -> None:
        for row in rows:
            self._writer.writerow(row)

    def close(self) -> None:
        if not self._closed:
            self._file.close()
            self._closed = True

    def __enter__(self) -> "OofWriter":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


_SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def validate_oof(
    path: Path, *, expected_dev_patients: set[str], dev_patients: set[str]
) -> dict:
    path = Path(path)
    if not path.exists():
        raise OofIntegrityError(f"OOF file does not exist: {path}")
    with path.open() as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != list(OOF_COLUMNS):
            raise OofIntegrityError(
                f"OOF schema mismatch in {path}: expected {list(OOF_COLUMNS)}, "
                f"got {reader.fieldnames}"
            )
        rows = list(reader)

    n_rows = len(rows)
    seen: set[str] = set()
    duplicates: set[str] = set()
    test_patients: set[str] = set()
    bad_sha_rows: list[str] = []
    for r in rows:
        pid = r["patient_id"]
        if pid in seen:
            duplicates.add(pid)
        seen.add(pid)
        if pid not in dev_patients:
            test_patients.add(pid)
        if not _SHA_RE.match(r["checkpoint_sha256"]):
            bad_sha_rows.append(pid)

    missing = expected_dev_patients - seen
    extras = seen - expected_dev_patients

    if duplicates:
        raise OofIntegrityError(f"OOF {path}: duplicate patient rows: {sorted(duplicates)[:5]}")
    if missing:
        raise OofIntegrityError(
            f"OOF {path}: missing patients (showing up to 5): {sorted(missing)[:5]} "
            f"(missing={len(missing)})"
        )
    if test_patients:
        raise OofIntegrityError(
            f"OOF {path}: contains Test patients (showing up to 5): "
            f"{sorted(test_patients)[:5]}"
        )
    if extras:
        raise OofIntegrityError(
            f"OOF {path}: contains patients outside expected_dev_patients: "
            f"{sorted(extras)[:5]}"
        )
    if bad_sha_rows:
        raise OofIntegrityError(
            f"OOF {path}: invalid checkpoint_sha256 for patients (first 5): "
            f"{bad_sha_rows[:5]}"
        )

    return {
        "n_rows": n_rows,
        "n_unique_patients": len(seen),
        "n_test_patients": 0,
        "n_missing_patients": 0,
        "n_duplicate_patients": 0,
        "n_invalid_sha_patients": 0,
    }
```

- [ ] **Step 4: Run the tests**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_oof.py -q
```

Expected: 8 passed.

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 138 pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/oof.py algorithm/eye_diagnosis_p1/tests/test_training_oof.py
git commit -m "feat(p2-01): OOF writer and integrity validator

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 7: `fold_runner.py` + tests (tiny fake dataset, 1 epoch, AMP path verified)

**Files:**
- Create: `algorithm/p1/training/fold_runner.py`
- Create: `algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py`

**Interfaces:**
- Produces:
  - `class TrainingError(RuntimeError): ...`
  - `class FoldReceipt` dataclass with fields: `experiment_id, fold, dev_patient_count, val_patient_count, epoch_count, amp, checkpoint_sha256, schema_version`.
  - `def run_fold(*, experiment: str, fold_id: int, dev_patient_ids: list[str], val_patient_ids: list[str], image_paths: dict[str, dict[str, Path]], labels: dict[str, np.ndarray], root_dir: Path, protocol: E0E3Protocol, out_dir: Path) -> FoldReceipt: ...` — does:
    1. `check_required_free_vram_mb(protocol.preflight_free_vram_mb, mem_get_info=...)` when a fake is injected by tests; production calls without a fake.
    2. `torch.amp.autocast(device_type='cuda', dtype=torch.float16)` is entered **iff** `protocol.amp and torch.cuda.is_available()`.
    3. One pass of forward over a tiny batch, BCEWithLogitsLoss, backward only if `val_patient_ids` non-empty.
    4. Writes `fold_{fold_id}_receipt.json` and **appends** a per-validation-patient row to `out_dir/oof.csv` via `OofWriter`.
    5. Computes a synthetic `checkpoint_sha256` by hashing the model state dict bytes (CPU fine).
  - Module-level helper `def build_run_fold_with_mock_mem(*, mem_get_info) -> Callable[..., FoldReceipt]: ...` for tests that want to inject CUDA.

- [ ] **Step 1: Write the failing tests**

Create `algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py`:

```python
"""Unit tests for the fold runner (fake dataset, no CUDA required)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import numpy as np
import pytest
import torch

from p1.audit import CLASS_ORDER
from p1.benchmark.model import BACKBONE_SPECS
from p1.training.fold_runner import (
    FoldReceipt,
    TrainingError,
    build_run_fold_with_mock_mem,
    run_fold,
)
from p1.training.oof import OOF_COLUMNS, OofWriter
from p1.training.protocol import default_protocol


@pytest.fixture
def fake_inputs(tmp_path: Path) -> dict:
    from PIL import Image

    images_dir = tmp_path / "imgs"
    images_dir.mkdir()
    pids = [f"p{i:03d}" for i in range(8)]
    image_paths: dict[str, dict[str, Path]] = {}
    labels: dict[str, np.ndarray] = {}
    for pid in pids:
        for side, suffix in [("OD", "left"), ("OS", "right")]:
            Image.new("RGB", (32, 32), (10, 20, 30)).save(images_dir / f"{pid}_{suffix}.jpg")
        image_paths[pid] = {
            "left": Path(f"{pid}_left.jpg"),
            "right": Path(f"{pid}_right.jpg"),
        }
        labels[pid] = np.asarray([0] * len(CLASS_ORDER), dtype=np.int8)
    return {
        "root_dir": images_dir,
        "image_paths": image_paths,
        "labels": labels,
        "pids": pids,
    }


def test_run_fold_writes_receipt_and_oof(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    val = pids[:4]
    train = pids[4:]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    oof_path = out_dir / "oof.csv"

    # Pre-create the OOF writer file via the runner; we will read it after.
    receipt = run_fold(
        experiment="E3",
        fold_id=0,
        dev_patient_ids=train + val,
        val_patient_ids=val,
        image_paths=fake_inputs["image_paths"],
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=protocol,
        out_dir=out_dir,
    )
    assert isinstance(receipt, FoldReceipt)
    assert receipt.fold == 0
    assert receipt.experiment_id == "E3"
    assert receipt.amp is True
    assert len(receipt.checkpoint_sha256) == 64

    receipt_path = out_dir / "fold_0_receipt.json"
    assert receipt_path.exists()
    payload = json.loads(receipt_path.read_text())
    assert payload["experiment_id"] == "E3"
    assert payload["fold"] == 0
    assert payload["val_patient_count"] == 4

    # OOF must have one row per val patient.
    assert oof_path.exists()
    with oof_path.open() as f:
        import csv as _csv
        rows = list(_csv.DictReader(f))
    assert len(rows) == 4
    assert {r["patient_id"] for r in rows} == set(val)
    assert all(c in rows[0] for c in OOF_COLUMNS)


def test_run_fold_rejects_legacy_weights(tmp_path: Path, fake_inputs: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    pids = fake_inputs["pids"]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    monkeypatch.setattr(
        "p1.training.models.build_bilateral_model",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("legacy guard must run")),
    )
    with pytest.raises(Exception):
        run_fold(
            experiment="E3",
            fold_id=0,
            dev_patient_ids=pids,
            val_patient_ids=pids[:2],
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=protocol,
            out_dir=out_dir,
        )


def test_run_fold_never_reads_test_patients(tmp_path: Path, fake_inputs: dict) -> None:
    """A malicious caller can only supply a 'dev_patient_ids' list. The
    runner must not invoke any test-side accessor.
    """
    pids = fake_inputs["pids"]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E0" / "fold_0"
    out_dir.mkdir(parents=True)
    # Confirm the public signature does not accept a 'test_patient_ids' kwarg.
    import inspect
    sig = inspect.signature(run_fold)
    assert "test_patient_ids" not in sig.parameters


def test_run_fold_e2_smoke_via_assignment(tmp_path: Path, fake_inputs: dict) -> None:
    """E2 picks one eye per patient. We feed the runner the *image_paths*
    filtered so that each patient has only the assigned eye, and assert
    OOF rows match the val set."""
    from p1.training.e2_assignment import assign_e2_eyes

    pids = fake_inputs["pids"]
    assignment = assign_e2_eyes(pids, seed=42)
    # Filter labels/image_paths so that each patient exposes only the assigned eye.
    filtered_paths: dict[str, dict[str, Path]] = {}
    for pid, eyes in fake_inputs["image_paths"].items():
        chosen = assignment[pid]
        filtered_paths[pid] = {chosen: eyes[chosen]}
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E2" / "fold_0"
    out_dir.mkdir(parents=True)
    val = pids[:4]
    train = pids[4:]
    receipt = run_fold(
        experiment="E2",
        fold_id=0,
        dev_patient_ids=train + val,
        val_patient_ids=val,
        image_paths=filtered_paths,
        labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"],
        protocol=protocol,
        out_dir=out_dir,
    )
    assert receipt.experiment_id == "E2"
    assert receipt.val_patient_count == 4


def test_run_fold_fails_closed_on_low_vram(tmp_path: Path, fake_inputs: dict) -> None:
    pids = fake_inputs["pids"]
    protocol = default_protocol()
    out_dir = tmp_path / "artifacts" / "E3" / "fold_0"
    out_dir.mkdir(parents=True)
    fake_low = lambda device=None: (1024 * 1024 * 1024, 8188 * 1024 * 1024)  # 1 GB free
    runner = build_run_fold_with_mock_mem(mem_get_info=fake_low)
    with pytest.raises(Exception) as ei:
        runner(
            experiment="E3",
            fold_id=0,
            dev_patient_ids=pids,
            val_patient_ids=pids[:2],
            image_paths=fake_inputs["image_paths"],
            labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"],
            protocol=protocol,
            out_dir=out_dir,
        )
    # Either InsufficientVram or TrainingError wrapping it is acceptable.
    assert "vram" in str(ei.value).lower() or "insufficient" in str(ei.value).lower()
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_fold_runner.py -q
```

Expected: collection error.

- [ ] **Step 3: Implement `fold_runner.py`**

Create `algorithm/p1/training/fold_runner.py`:

```python
"""One-fold training + validation for E0/E1/E2/E3.

This is the minimum verifiable skeleton: preflight, AMP-aware forward
pass on a small batch, BCEWithLogitsLoss, OOF row append, and a fold
receipt. It does not run the full epoch loop, early stopping, or model
selection — those are P2-02 concerns. The runner refuses to read any
Test patients because its public signature does not accept them.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Mapping, Optional, Sequence

import numpy as np
import torch
from PIL import Image
from torch import nn

from p1.audit import CLASS_ORDER
from p1.benchmark.preprocess import preprocess_image
from p1.training.models import build_model
from p1.training.oof import OofWriter
from p1.training.preflight import InsufficientVram, check_required_free_vram_mb
from p1.training.protocol import E0E3Protocol


class TrainingError(RuntimeError):
    """Wraps a fatal training-time failure (NaN, OOM, etc.)."""


@dataclass
class FoldReceipt:
    experiment_id: str
    fold: int
    dev_patient_count: int
    val_patient_count: int
    epoch_count: int
    amp: bool
    checkpoint_sha256: str
    schema_version: str


def _load_image_tensor(path: Path, target_size: int) -> torch.Tensor:
    with Image.open(path) as img:
        return preprocess_image(img, target_size=target_size)


def _stack_batch(
    patient_ids: Sequence[str],
    image_paths: Mapping[str, Mapping[str, Path]],
    labels: Mapping[str, np.ndarray],
    root_dir: Path,
    target_size: int,
    eye: str,
    e2_assignment: Optional[Mapping[str, str]] = None,
) -> tuple[torch.Tensor, torch.Tensor, list[str]]:
    tensors: list[torch.Tensor] = []
    label_vecs: list[torch.Tensor] = []
    used_pids: list[str] = []
    for pid in patient_ids:
        chosen = eye if eye != "e2" else e2_assignment[pid]  # type: ignore[index]
        path = root_dir / image_paths[pid][chosen]
        tensors.append(_load_image_tensor(path, target_size))
        label_vecs.append(torch.from_numpy(labels[pid]).to(torch.int64))
        used_pids.append(pid)
    return torch.stack(tensors, dim=0), torch.stack(label_vecs, dim=0), used_pids


def _sha256_state_dict(model: nn.Module) -> str:
    h = hashlib.sha256()
    for k in sorted(model.state_dict().keys()):
        h.update(k.encode("utf-8"))
        h.update(model.state_dict()[k].detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def _forward_and_loss(
    model: nn.Module, batch: torch.Tensor, labels: torch.Tensor
) -> torch.Tensor:
    if isinstance(model, type(build_model("E3", pretrained=False))):
        # E3 path requires left/right split; the smoke harness supplies both.
        left, right = torch.chunk(batch, 2, dim=0)
        logits = model(left, right)
    else:
        logits = model(batch)
    loss = nn.functional.binary_cross_entropy_with_logits(logits, labels.float())
    return loss


def run_fold(
    *,
    experiment: str,
    fold_id: int,
    dev_patient_ids: Sequence[str],
    val_patient_ids: Sequence[str],
    image_paths: Mapping[str, Mapping[str, Path]],
    labels: Mapping[str, np.ndarray],
    root_dir: Path,
    protocol: E0E3Protocol,
    out_dir: Path,
) -> FoldReceipt:
    """Run a minimal one-step training+inference pass for one fold.

    Public signature intentionally does not accept ``test_patient_ids``.
    """
    check_required_free_vram_mb(protocol.preflight_free_vram_mb)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    oof_path = out_dir / "oof.csv"
    receipt_path = out_dir / f"fold_{fold_id}_receipt.json"

    model = build_model(experiment, pretrained=False)
    target_size = protocol.image_size
    eye_for_dataset = {"E0": "left", "E1": "right", "E2": "e2", "E3": "left"}[experiment]

    # One forward pass over the first 2 validation patients (smoke-sized).
    smoke_pids = list(val_patient_ids)[: max(2, protocol.patient_batch // 4)]
    if not smoke_pids:
        raise TrainingError("val_patient_ids is empty; cannot run a fold")

    val_batch, val_labels, used_pids = _stack_batch(
        smoke_pids, image_paths, labels, root_dir, target_size, eye_for_dataset
    )

    if experiment == "E3":
        # E3 needs paired eyes; build left/right with the same patient list.
        right_batch, right_labels, _ = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size, "right"
        )
        val_batch = torch.cat([val_batch, right_batch], dim=0)
        val_labels = torch.cat([val_labels, right_labels], dim=0)

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=protocol.learning_rate,
        weight_decay=protocol.weight_decay,
    )

    use_amp = bool(protocol.amp and torch.cuda.is_available())
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    val_batch = val_batch.to(device)
    val_labels = val_labels.to(device)

    try:
        if use_amp:
            with torch.amp.autocast(device_type="cuda", dtype=torch.float16):
                loss = _forward_and_loss(model, val_batch[: protocol.patient_batch], val_labels[: protocol.patient_batch])
        else:
            loss = _forward_and_loss(model, val_batch[: protocol.patient_batch], val_labels[: protocol.patient_batch])
        if torch.isnan(loss).any():
            raise TrainingError(f"NaN loss in fold {fold_id} experiment {experiment}")
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
    except RuntimeError as e:  # covers OOM
        raise TrainingError(f"training step failed in fold {fold_id}: {e}") from e

    # Inference pass (no grad) for the full validation set.
    model.eval()
    with torch.no_grad():
        all_rows: list[dict] = []
        for pid in val_patient_ids:
            chosen = eye_for_dataset if eye_for_dataset != "e2" else "left"  # E2 eye is fixed by the dataset, not the runner; in smoke we read left as a stand-in
            tensor = _load_image_tensor(root_dir / image_paths[pid][chosen], target_size).unsqueeze(0).to(device)
            if experiment == "E3":
                tensor_right = _load_image_tensor(
                    root_dir / image_paths[pid]["right"], target_size
                ).unsqueeze(0).to(device)
                logits = model(tensor, tensor_right)
            else:
                logits = model(tensor)
            probs = torch.sigmoid(logits).squeeze(0).detach().cpu().numpy().tolist()
            row = {
                "patient_id": pid,
                "fold": fold_id,
                "experiment_id": experiment,
                "seed": protocol.seed,
            }
            true_vec = labels[pid].tolist()
            for c, bit in zip(CLASS_ORDER, true_vec):
                row[f"true_{c}"] = int(bit)
            for c, p in zip(CLASS_ORDER, probs):
                row[f"prob_{c}"] = float(p)
            row["checkpoint_sha256"] = _sha256_state_dict(model)
            all_rows.append(row)

    with OofWriter(oof_path) as w:
        w.append(all_rows)

    receipt = FoldReceipt(
        experiment_id=experiment,
        fold=fold_id,
        dev_patient_count=len(dev_patient_ids),
        val_patient_count=len(val_patient_ids),
        epoch_count=1,
        amp=bool(protocol.amp),
        checkpoint_sha256=all_rows[0]["checkpoint_sha256"],
        schema_version=protocol.schema_version,
    )
    receipt_path.write_text(json.dumps(asdict(receipt), indent=2, sort_keys=True))
    return receipt


def build_run_fold_with_mock_mem(
    *, mem_get_info: Callable[[Optional[int]], tuple[int, int]]
) -> Callable[..., FoldReceipt]:
    """Return a runner closure that overrides the preflight CUDA probe.

    Tests inject a fake ``mem_get_info`` so the failure path is
    deterministic and independent of the local GPU state.
    """
    def _runner(**kwargs) -> FoldReceipt:
        original = check_required_free_vram_mb
        from p1.training import fold_runner as _self

        def _patched(threshold_mb: int, *, mem_get_info=None) -> int:
            return original(threshold_mb, mem_get_info=mem_get_info)
        _self.check_required_free_vram_mb = _patched
        try:
            return run_fold(**kwargs)
        finally:
            _self.check_required_free_vram_mb = original
    return _runner
```

- [ ] **Step 4: Run the tests**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_fold_runner.py -q
```

Expected: 5 passed (smoke + receipt + no-test-patients + E2-assignment smoke + low-vram).

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 143 pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/fold_runner.py algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py
git commit -m "feat(p2-01): fold runner with preflight, AMP, OOF append

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 8: `cli.py` + extra CLI parsing tests

**Files:**
- Create: `algorithm/p1/training/cli.py`
- Modify: `algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py` (append CLI tests)

**Interfaces:**
- Produces:
  - `def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace: ...` with fields: `experiment, fold, smoke, protocol, out_dir, eye_data_root, device`.
  - `def main(argv: Sequence[str] | None = None) -> int: ...` — calls `parse_args`, then for the chosen experiment/fold:
    1. Loads `p1.manifest.ManifestPaths` from `--eye-data-root`.
    2. Loads `SplitAssignment` from `split_assignment_v1.csv`.
    3. Calls `run_fold(...)` with the dev/val split for the requested fold.
    4. Returns 0 on success, non-zero on any preflight/integrity failure.

- [ ] **Step 1: Append CLI tests to `test_training_fold_runner.py`**

Append to the file:

```python
def test_cli_parse_args_defaults() -> None:
    from p1.training.cli import parse_args
    ns = parse_args(["--experiment", "E3", "--fold", "0"])
    assert ns.experiment == "E3"
    assert ns.fold == 0
    assert ns.smoke is False
    assert ns.protocol.endswith("protocol_e0_e3_v1.json")
    assert ns.eye_data_root


def test_cli_parse_args_rejects_unknown_experiment() -> None:
    from p1.training.cli import parse_args
    with pytest.raises(SystemExit):
        parse_args(["--experiment", "E9", "--fold", "0"])


def test_cli_parse_args_smoke_flag() -> None:
    from p1.training.cli import parse_args
    ns = parse_args(["--experiment", "E0", "--fold", "1", "--smoke"])
    assert ns.experiment == "E0"
    assert ns.fold == 1
    assert ns.smoke is True
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_fold_runner.py -q -k "cli"
```

Expected: 3 collection errors.

- [ ] **Step 3: Implement `cli.py`**

Create `algorithm/p1/training/cli.py`:

```python
"""CLI for the P2-01 E0–E3 training entry point.

Minimal scaffold only: parses arguments, locates the patient manifest and
split, and delegates to ``run_fold``. The full multi-fold orchestration
lives in P2-02.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Sequence

from p1.manifest import ManifestPaths
from p1.split import FoldMap, SplitAssignment
from p1.training.fold_runner import run_fold
from p1.training.protocol import default_protocol, load_protocol


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="p1.training.cli")
    parser.add_argument("--experiment", required=True, choices=["E0", "E1", "E2", "E3"])
    parser.add_argument("--fold", required=True, type=int)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument(
        "--protocol",
        default=str(Path(__file__).resolve().parent.parent / "protocol_e0_e3_v1.json"),
        help="Path to the frozen protocol JSON. Defaults to p1/protocol_e0_e3_v1.json.",
    )
    parser.add_argument(
        "--out-dir",
        default="artifacts/p2_e0_e3_v1",
        help="Where to write fold receipts and OOF CSVs.",
    )
    parser.add_argument(
        "--eye-data-root",
        default=os.environ.get("EYE_DATA_ROOT", ""),
        help="Path to the source dataset (also reads EYE_DATA_ROOT env).",
    )
    parser.add_argument("--device", default="cuda")
    return parser.parse_args(list(argv) if argv is not None else None)


def _load_manifest(root: Path) -> ManifestPaths:
    return ManifestPaths(
        patient_manifest_path=root / "patient_manifest_v1.parquet",
        eye_index_path=root / "eye_index_v1.parquet",
    )


def _load_split(root: Path) -> tuple[SplitAssignment, FoldMap]:
    import pandas as pd

    from p1.split import assign_splits, build_oof_folds

    manifest = _load_manifest(root)
    assignment = assign_splits(manifest, seed=42, test_frac=0.15, out_dir=None)
    folds = build_oof_folds(assignment, manifest, k=5, seed=42)
    return assignment, folds


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    protocol_path = Path(args.protocol)
    protocol = load_protocol(protocol_path) if protocol_path.exists() else default_protocol()
    root = Path(args.eye_data_root)
    if not root.exists():
        print(f"eye-data-root not found: {root}", file=sys.stderr)
        return 2
    assignment, folds = _load_split(root)
    val_pids = list(folds.fold_to_patients(args.fold))
    dev_pids = [pid for pid in assignment.dev_patient_ids if pid not in set(val_pids)]

    import numpy as np
    import pandas as pd

    pdf = pd.read_parquet(_load_manifest(root).patient_manifest_path)
    image_paths = {
        row["patient_id"]: {
            "left": Path(row["left_image_relpath"]),
            "right": Path(row["right_image_relpath"]),
        }
        for row in pdf.to_dict("records")
    }
    from p1.audit import CLASS_ORDER

    labels = {
        row["patient_id"]: np.asarray(
            [row[f"label_{c}"] for c in CLASS_ORDER], dtype=np.int8
        )
        for row in pdf.to_dict("records")
    }

    out_dir = Path(args.out_dir) / args.experiment / f"fold_{args.fold}"
    receipt = run_fold(
        experiment=args.experiment,
        fold_id=args.fold,
        dev_patient_ids=dev_pids,
        val_patient_ids=val_pids,
        image_paths=image_paths,
        labels=labels,
        root_dir=root,
        protocol=protocol,
        out_dir=out_dir,
    )
    print(
        f"fold {args.fold} {args.experiment} ok: "
        f"val={receipt.val_patient_count} sha={receipt.checkpoint_sha256[:12]}..."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/test_training_fold_runner.py -q
```

Expected: 8 passed (5 fold + 3 CLI).

- [ ] **Step 5: Run the full suite**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 146 pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/cli.py algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py
git commit -m "feat(p2-01): training CLI entry point

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Emit and commit the baseline protocol JSON; print the manual smoke command

**Files:**
- Create: `algorithm/p1/protocol_e0_e3_v1.json`

- [ ] **Step 1: Generate the protocol file from the dataclass**

Run from `algorithm/`:

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -c "
from pathlib import Path
from p1.training.protocol import default_protocol, dump_protocol
dump_protocol(default_protocol(), Path('p1/protocol_e0_e3_v1.json'))
print('wrote', Path('p1/protocol_e0_e3_v1.json').resolve())
"
```

Expected output ends with the resolved absolute path of `p1/protocol_e0_e3_v1.json`.

- [ ] **Step 2: Verify the file is loadable and matches the dataclass**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -c "
from pathlib import Path
from p1.training.protocol import default_protocol, load_protocol
p = load_protocol(Path('p1/protocol_e0_e3_v1.json'))
assert p == default_protocol(), 'protocol round-trip mismatch'
print('ok')
"
```

Expected: prints `ok`.

- [ ] **Step 3: Run the full test suite one final time**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q
```

Expected: 146 pass.

- [ ] **Step 4: Print the manual 1-fold smoke command for the user**

```bash
echo "D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m p1.training.cli --experiment E3 --fold 0 --smoke --protocol p1/protocol_e0_e3_v1.json --eye-data-root \"D:/Work/code/eye-diagnosis/algorithm/datasets/DataSet/Training_Dataset/Training_Dataset/\""
```

Expected: prints the command; the user will run it manually on the GPU machine. This command is **not** part of the automated gate.

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/protocol_e0_e3_v1.json
git commit -m "feat(p2-01): baseline protocol_e0_e3_v1.json

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (each section → at least one task):

- §1 Purpose/scope → Tasks 0–9 (whole slice).
- §2 Frozen decisions → T1 (ProtocolError on disagreement), T2 (preflight at 6800 MB), T4 (B4 pinned via BACKBONE_SPECS), T6 (Test patients rejected by OOF validator).
- §3 Architecture → T0 (package), T1–T8 (each module).
- §4 Data flow → T7 (fold runner wiring), T6 (OOF writer), T8 (CLI loads manifest + split).
- §5 Model rules → T4 (E0/E1/E2 single Linear; E3 reused; first_conv 3-channel; legacy guard).
- §6 Error handling → T1 (ProtocolError), T2 (InsufficientVram), T4 (LegacyWeightsRejected reused), T6 (OofIntegrityError), T7 (TrainingError), T3 (E2AssignmentMismatch).
- §7 Testing strategy → every Task ends with a per-file test + the full-suite gate.
- §8 File-level inventory → exact paths created in T0–T9.
- §9 Task decomposition → T0–T9 (matches spec order).
- §10 Acceptance checklist → verified by T1–T9 gates; final manual smoke command printed in T9 step 4 (out-of-gate).
- §11 Out of scope → not implemented (no selection policy, no bootstrap CI, no FOV).

**Placeholder scan**: No "TBD", "TODO", "fill in", "similar to", or vague steps. Each test step has the full code. Each commit message is concrete. Each command is the exact string to run.

**Type consistency**:
- `E0E3Protocol` field names defined once in T1 and used unchanged in T2 (`preflight_free_vram_mb`), T4 (no protocol use), T5 (target_size from image_size), T6 (no protocol use), T7 (preflight_free_vram_mb / image_size / amp / learning_rate / weight_decay / patient_batch / seed / schema_version), T8 (load_protocol default + schema_version).
- `E2Assignment` returns `dict[str, str]` with values in `{"left", "right"}` in T3 and consumed by T5 (E2 dataset picks the eye).
- `OofWriter` writes `OOF_COLUMNS` in T6; T7 appends rows using the same column set; T6 validator checks the same set.
- `FoldReceipt` fields used in T7 tests; written to JSON via `asdict`.

**Known caveats** (intentional, not bugs):
- The smoke run is intentionally a one-step pass; full epoch loop, early stopping, and model selection belong to P2-02.
- The 5-fold × 4-experiment orchestration is not in this slice; the CLI only handles one experiment × one fold at a time. A multi-fold driver belongs to P2-02.
- The CLI requires `--eye-data-root` to point at the real dataset; integration smoke is **not** part of the automated gate.
