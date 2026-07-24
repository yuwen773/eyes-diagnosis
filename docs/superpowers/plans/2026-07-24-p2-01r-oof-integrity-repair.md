# P2-01R — OOF Integrity & Clean-Checkout Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the four scientific-integrity blockers (validation leakage, unfrozen split/fold, disabled ImageNet weights, missing committed dependencies) plus five correctness defects in the P2-01 E0–E3 training skeleton, then prove reproducibility on a clean checkout — without re-implementing the accepted model/protocol/OOF scaffolding.

**Architecture:** The training entry point becomes strictly consumer-only: it reads a frozen `split_assignment_v1.csv` **and** a frozen `fold_assignment_v1.csv`, never regenerating either. `run_fold` trains exclusively on Development-fold patients and predicts exclusively on the held-out fold, with an explicit train∩val disjointness guarantee. All randomness-affecting inputs (manifest, split, fold, protocol, weights) are SHA-256-recorded in the fold receipt. Tests run against tiny committed synthetic fixtures so a clean checkout is green; real runs point `--split-assignment`/`--fold-assignment`/`--manifest`/`--image-root` at the gitignored `artifacts/p1_v1/` products.

**Tech Stack:** Python 3.x, PyTorch (`torch.amp` autocast + `GradScaler`), torchvision EfficientNet-B4, pandas/pyarrow (parquet), pytest. Frozen contracts in `p1/{audit,manifest,split}.py` and `p1/benchmark/{model,preprocess}.py` are read-only.

## Global Constraints

- **Frozen P1 protocol authority.** Never edit `p1/audit.py`, `p1/manifest.py`, `p1/split.py`, or `p1/benchmark/**`. New shared logic (split/fold loaders) lives in `p1/training/`. — verbatim from MEMORY `p1-protocol-frozen-authority`.
- **Backbone is EfficientNet-B4 with `EfficientNet_B4_Weights.IMAGENET1K_V1` only.** `"DEFAULT"` and any legacy `best*_eye_disease_model.pth` are prohibited (`assert_not_legacy_weights`). — `p1-shared-encoder-not-6ch`, `p1/benchmark/model.py:23`.
- **E3 is shared-encoder + late concat, never 6-channel input.** Reuse `BilateralSharedEncoder`; do not build a 6-channel first conv. — MEMORY `p1-shared-encoder-not-6ch`.
- **Preflight fails closed at `preflight_free_vram_mb` (6800 MB); never auto-degrade.** — `p1/training/preflight.py`.
- **No patient-level derived data in the public repo.** `.gitignore:58` (`/algorithm/artifacts/**`) stays. Tests use committed synthetic fixtures, NOT the real split. — `.gitignore:55-58`.
- **OOF definition:** a patient's OOF prediction must come from a checkpoint that never saw that patient in any gradient update. train∩val = ∅ is non-negotiable, even in `--smoke`.
- **All paths are `algorithm/`-relative** (execution cwd is `D:/Work/code/eye-diagnosis/algorithm`).
- **Test env:** `D:/programe/Anaconda/envs/eye-p1-bench/python.exe`. Local GPU has only ~5647 MB free (below 6800), so CPU-path tests inject a fake `mem_get_info`; real GPU smoke needs a ≥6800 MB host.

---

### Task 0: Commit the missing imported dependencies (blocker #9)

The committed `p1/training/**` imports `p1.audit`, `p1.manifest`, `p1.split`, `p1.benchmark.{model,preprocess}`, and the whole `eye_diagnosis_p1/tests/**` tree — all currently **untracked** (`git ls-tree HEAD -- algorithm/p1/audit.py` is empty). A clean checkout of the pushed branch fails at import. This must land first; every later task's test run depends on it.

**Files:**
- Commit (currently untracked): `algorithm/p1/__init__.py`, `algorithm/p1/audit.py`, `algorithm/p1/manifest.py`, `algorithm/p1/split.py`, `algorithm/p1/benchmark/**`, `algorithm/eye_diagnosis_p1/__init__.py`, `algorithm/eye_diagnosis_p1/tests/__init__.py`, `algorithm/eye_diagnosis_p1/tests/conftest.py`, and every `algorithm/eye_diagnosis_p1/tests/test_*.py` not already in HEAD.
- Do NOT commit: `algorithm/.omc/`, `algorithm/_fix_decision2.py`, `algorithm/datasets/DataSet/**`, `algorithm/artifacts/**`.

**Interfaces:**
- Produces: an importable, self-contained `p1` + `eye_diagnosis_p1` tree on the branch — the precondition for all tasks below.

- [ ] **Step 1: Enumerate exactly what is untracked and confirm none are data/scratch**

Run:
```bash
git status --porcelain=v1 --untracked-files=all -- algorithm/p1 algorithm/eye_diagnosis_p1 | grep '^??'
```
Expected: only `.py` source files and the `benchmark/` package — NO `.parquet`, `.csv`, `.jpg`, `.omc`, `_fix_decision2.py`, or `datasets/`.

- [ ] **Step 2: Confirm datasets/artifacts are excluded before any add**

Run:
```bash
git check-ignore -v algorithm/artifacts/p1_v1/split_assignment_v1.csv
git status --porcelain -- algorithm/datasets algorithm/.omc algorithm/_fix_decision2.py
```
Expected: `artifacts/**` is ignored; `datasets/`, `.omc/`, `_fix_decision2.py` remain untracked (we will NOT add them).

- [ ] **Step 3: Stage only the source tree by explicit path**

```bash
git add algorithm/p1/__init__.py algorithm/p1/audit.py algorithm/p1/manifest.py algorithm/p1/split.py
git add algorithm/p1/benchmark
git add algorithm/eye_diagnosis_p1/__init__.py algorithm/eye_diagnosis_p1/tests
```

- [ ] **Step 4: Verify the staged set contains no data files**

Run:
```bash
git diff --cached --name-only | grep -Ev '\.py$' || echo "clean: python only"
```
Expected: `clean: python only`.

- [ ] **Step 5: Prove a clean import in a throwaway worktree**

```bash
git stash --include-untracked
git worktree add ../p2-01r-verify HEAD
cd ../p2-01r-verify && git checkout $(git -C ../eye-diagnosis rev-parse HEAD)
```
Then, from the worktree's `algorithm/` dir with the staged files applied, run `python -c "import p1.training.cli, p1.training.fold_runner"`.
Expected: no `ModuleNotFoundError`. (If the worktree can't see staged-but-uncommitted files, commit first in Step 6 then re-run the import in the worktree.) Clean up: `git worktree remove ../p2-01r-verify`, `git stash pop`.

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(p2-01r): commit p1 base + benchmark deps imported by training

The p1.training package imports p1.audit/manifest/split and
p1.benchmark.{model,preprocess}, plus the P1 test suite — all were
untracked, so a clean checkout failed at import. Commit the source
tree only; datasets/, artifacts/, and scratch stay ignored."
```

---

### Task 1: E2 assignment uses the full `patient_id:seed` hash (defect: seed parity)

`_eye_for` computes `(digest[0] ^ seed) & 1`, which algebraically reduces to `(digest[0] & 1) ^ (seed & 1)` — only the seed's low bit matters, so seed 42 and seed 2026 (both even) yield identical assignments for every patient. The contract is `hash(patient_id + seed)`. Safe to change: no real E2 run has occurred.

**Files:**
- Modify: `algorithm/p1/training/e2_assignment.py:25-27` (`_eye_for`)
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_e2_assignment.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `_eye_for(patient_id: str, seed: int) -> str` and `assign_e2_eyes(patient_ids, *, seed) -> dict[str,str]` (signatures unchanged); `read_e2_assignment` continues to re-derive via the same `_eye_for`, so the on-disk validator stays consistent.

- [ ] **Step 1: Write failing tests**

Add to `test_training_e2_assignment.py`:
```python
def test_e2_seed_high_bits_change_assignment():
    from p1.training.e2_assignment import assign_e2_eyes
    pids = [f"p{i:04d}" for i in range(200)]
    a = assign_e2_eyes(pids, seed=42)
    b = assign_e2_eyes(pids, seed=2026)  # same parity as 42, different value
    changed = sum(1 for pid in pids if a[pid] != b[pid])
    assert changed > 0, "seed high bits must affect the assignment"

def test_e2_same_patient_same_seed_is_stable():
    from p1.training.e2_assignment import assign_e2_eyes
    pids = [f"p{i:04d}" for i in range(50)]
    assert assign_e2_eyes(pids, seed=7) == assign_e2_eyes(pids, seed=7)

def test_e2_both_eyes_represented():
    from p1.training.e2_assignment import assign_e2_eyes
    pids = [f"p{i:04d}" for i in range(200)]
    vals = set(assign_e2_eyes(pids, seed=42).values())
    assert vals == {"left", "right"}
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_e2_assignment.py::test_e2_seed_high_bits_change_assignment -v`
Expected: FAIL (assignments identical across 42 vs 2026).

- [ ] **Step 3: Implement the full-seed hash**

Replace `_eye_for` (lines 25-27):
```python
def _eye_for(patient_id: str, seed: int) -> str:
    payload = f"{patient_id}:{seed}".encode("utf-8")
    digest = hashlib.sha256(payload).digest()
    return "left" if (digest[0] % 2 == 0) else "right"
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_e2_assignment.py -v`
Expected: PASS (all, including any pre-existing determinism tests).

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/e2_assignment.py algorithm/eye_diagnosis_p1/tests/test_training_e2_assignment.py
git commit -m "fix(p2-01r): E2 eye assignment hashes full patient_id:seed

Old XOR-of-low-bit made only seed parity matter (seed 42 == 2026).
Hash the concatenated patient_id:seed so every seed bit participates."
```

---

### Task 2: Protocol pins the weights enum and separates checkpoint vs experiment metric (defects: pretrained, selector name)

Two frozen-value fixes in one protocol bump, so the regenerated JSON is written once. `checkpoint_selector="oof_macro_auprc"` is impossible inside a fold (OOF only exists after all folds combine); a fold selects on validation. And the protocol must name the exact weights enum so the receipt can prove ImageNet init.

**Files:**
- Modify: `algorithm/p1/training/protocol.py` (dataclass fields + `FROZEN_FIELDS`)
- Modify (regenerate): `algorithm/p1/protocol_e0_e3_v1.json`
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_protocol.py`

**Interfaces:**
- Produces: `E0E3Protocol` gains `weights: str` (= `"EfficientNet_B4_Weights.IMAGENET1K_V1"`), `checkpoint_selector` becomes `"validation_macro_auprc"`, and a new `experiment_primary_metric: str` (= `"oof_macro_auprc"`) replaces the misused `primary_metric`. Consumed by Task 3 (`build_model`) and Task 6 (receipt).
- Note: changing field set bumps `schema_version` to `"p2-01r-e0-e3-v1"` so any stale JSON is rejected.

- [ ] **Step 1: Write failing tests**

Add to `test_training_protocol.py`:
```python
def test_protocol_pins_imagenet_weights():
    from p1.training.protocol import default_protocol
    p = default_protocol()
    assert p.weights == "EfficientNet_B4_Weights.IMAGENET1K_V1"

def test_protocol_checkpoint_selector_is_validation_metric():
    from p1.training.protocol import default_protocol
    p = default_protocol()
    assert p.checkpoint_selector == "validation_macro_auprc"
    assert p.experiment_primary_metric == "oof_macro_auprc"

def test_protocol_rejects_default_or_none_weights(tmp_path):
    import json
    from dataclasses import asdict
    from p1.training.protocol import default_protocol, load_protocol, ProtocolError
    raw = {k: (list(v) if isinstance(v, tuple) else v) for k, v in asdict(default_protocol()).items()}
    raw["weights"] = "DEFAULT"
    p = tmp_path / "bad.json"; p.write_text(json.dumps(raw))
    with __import__("pytest").raises(ProtocolError):
        load_protocol(p)
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_protocol.py::test_protocol_pins_imagenet_weights -v`
Expected: FAIL (`AttributeError: 'E0E3Protocol' object has no attribute 'weights'`).

- [ ] **Step 3: Implement protocol changes**

In `protocol.py`, add fields to the dataclass (after `backbone`): `weights: str`. Replace `checkpoint_selector`/`primary_metric` region: keep `checkpoint_selector: str`, rename `primary_metric` to `experiment_primary_metric: str`. Update `FROZEN_FIELDS`:
```python
    "schema_version": "p2-01r-e0-e3-v1",
    "backbone": "efficientnet_b4",
    "weights": "EfficientNet_B4_Weights.IMAGENET1K_V1",
    ...
    "checkpoint_selector": "validation_macro_auprc",
    "experiment_primary_metric": "oof_macro_auprc",
```
(Delete the old `"primary_metric"` key.)

- [ ] **Step 4: Regenerate the frozen JSON**

Run:
```bash
python -c "from pathlib import Path; from p1.training.protocol import default_protocol, dump_protocol; dump_protocol(default_protocol(), Path('p1/protocol_e0_e3_v1.json'))"
python -c "from pathlib import Path; from p1.training.protocol import load_protocol, default_protocol; assert load_protocol(Path('p1/protocol_e0_e3_v1.json'))==default_protocol(); print('round-trip ok')"
```
Expected: `round-trip ok`.

- [ ] **Step 5: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_protocol.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add algorithm/p1/training/protocol.py algorithm/p1/protocol_e0_e3_v1.json algorithm/eye_diagnosis_p1/tests/test_training_protocol.py
git commit -m "fix(p2-01r): protocol pins IMAGENET1K_V1 weights; split fold vs experiment metric

checkpoint_selector -> validation_macro_auprc (a fold cannot select on OOF).
Add experiment_primary_metric=oof_macro_auprc for the cross-experiment
comparison. Add weights enum so the receipt can prove ImageNet init.
Bump schema_version to reject stale JSON."
```

---

### Task 3: `build_model` is weights-driven and rejects non-ImageNet/legacy (defect: pretrained=False)

The factory currently exposes a bare `pretrained: bool`; `run_fold` passes `pretrained=False`, silently training from random init. Replace with an explicit weights enum resolved from the protocol string, and reject anything that isn't `IMAGENET1K_V1`.

**Files:**
- Modify: `algorithm/p1/training/models.py` (`MonocularB4.__init__`, `build_model`)
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_models.py`

**Interfaces:**
- Consumes: `p1.benchmark.model.BACKBONE_SPECS["efficientnet_b4"].weights` (== `EfficientNet_B4_Weights.IMAGENET1K_V1`), `build_bilateral_model(...)`, `assert_not_legacy_weights`.
- Produces: `build_model(experiment: str, *, weights: str) -> nn.Module` where `weights` is the protocol string; raises `ValueError` for any value other than `"EfficientNet_B4_Weights.IMAGENET1K_V1"`. **The old `pretrained` kwarg is removed** so `run_fold` cannot reach a random-init path.
- Testing note: to keep CPU tests offline, add a private `_download: bool = True` param; tests pass `_download=False` to build the module graph with `weights=None` **after** the enum has been validated — so the validation (not the download) is what the test exercises.

- [ ] **Step 1: Write failing tests**

Replace `pretrained`-based tests in `test_training_models.py` and add:
```python
import pytest
from p1.training.models import build_model

@pytest.mark.parametrize("exp", ["E0", "E1", "E2", "E3"])
def test_build_model_requires_imagenet_weights(exp):
    m = build_model(exp, weights="EfficientNet_B4_Weights.IMAGENET1K_V1", _download=False)
    assert m is not None

@pytest.mark.parametrize("bad", ["DEFAULT", None, "best_eye_disease_model.pth", "IMAGENET1K_V2"])
def test_build_model_rejects_non_imagenet(bad):
    with pytest.raises(ValueError):
        build_model("E0", weights=bad, _download=False)
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_models.py -v`
Expected: FAIL (`build_model` has no `weights`/`_download` kwargs).

- [ ] **Step 3: Implement**

In `models.py`:
```python
_REQUIRED_WEIGHTS = "EfficientNet_B4_Weights.IMAGENET1K_V1"

class MonocularB4(nn.Module):
    def __init__(self, *, eye: str, _download: bool = True) -> None:
        super().__init__()
        spec = BACKBONE_SPECS["efficientnet_b4"]
        net = spec.builder(weights=spec.weights if _download else None)
        self.encoder = net.features
        self.pool = net.avgpool
        self.classifier = nn.Linear(spec.feature_dim, 8)
        self.eye = eye
        self._feature_dim = spec.feature_dim
    # forward unchanged

def build_model(experiment: str, *, weights: str, _download: bool = True) -> nn.Module:
    if experiment not in EXPERIMENTS:
        raise ValueError(f"unknown experiment {experiment!r}; expected one of {EXPERIMENTS}")
    if weights != _REQUIRED_WEIGHTS:
        raise ValueError(
            f"weights must be {_REQUIRED_WEIGHTS!r}; got {weights!r} "
            "(DEFAULT, None, IMAGENET1K_V2, and legacy checkpoints are prohibited)"
        )
    if experiment == "E3":
        return build_bilateral_model("efficientnet_b4", num_classes=8, pretrained=_download)
    return MonocularB4(eye=_EYE_BY_EXPERIMENT[experiment], _download=_download)
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/models.py algorithm/eye_diagnosis_p1/tests/test_training_models.py
git commit -m "fix(p2-01r): build_model is weights-driven, rejects non-IMAGENET1K_V1

Remove the bare pretrained bool that let run_fold train from random init.
Require the exact protocol weights enum; reject DEFAULT/None/V2/legacy."
```

---

### Task 4: Frozen split + fold loaders with SHA-256 helpers (new — enables blockers #2 and reproducibility)

`p1/split.py` has **no** loader and is read-only. Create loaders in `p1/training/` that read the frozen CSVs the CLI will consume, plus a file-hash helper for receipts.

**Files:**
- Create: `algorithm/p1/training/frozen_inputs.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_frozen_inputs.py`

**Interfaces:**
- Produces:
  - `load_split_assignment(path: Path) -> dict[str, str]` — reads a CSV with columns `patient_id,split` (values `"test"`/`"dev"`); raises `FrozenInputError` on bad schema or unknown split value.
  - `load_fold_assignment(path: Path) -> dict[str, int]` — reads CSV columns `patient_id,fold`; raises on non-int fold or negative.
  - `sha256_file(path: Path) -> str` — hex digest of file bytes.
  - `class FrozenInputError(RuntimeError)`.
- Consumed by: Task 5 (writer round-trip), Task 6 (`run_fold` disjointness assert + receipt hashes), Task 7 (`validate_oof`), Task 8 (CLI).

- [ ] **Step 1: Write failing tests**

Create `test_training_frozen_inputs.py`:
```python
import pytest
from pathlib import Path
from p1.training.frozen_inputs import (
    load_split_assignment, load_fold_assignment, sha256_file, FrozenInputError,
)

def _write(p: Path, text: str) -> Path:
    p.write_text(text); return p

def test_load_split_ok(tmp_path):
    p = _write(tmp_path/"s.csv", "patient_id,split\np001,dev\np002,test\n")
    assert load_split_assignment(p) == {"p001": "dev", "p002": "test"}

def test_load_split_rejects_unknown_value(tmp_path):
    p = _write(tmp_path/"s.csv", "patient_id,split\np001,train\n")
    with pytest.raises(FrozenInputError):
        load_split_assignment(p)

def test_load_fold_ok(tmp_path):
    p = _write(tmp_path/"f.csv", "patient_id,fold\np001,0\np002,3\n")
    assert load_fold_assignment(p) == {"p001": 0, "p002": 3}

def test_load_fold_rejects_non_int(tmp_path):
    p = _write(tmp_path/"f.csv", "patient_id,fold\np001,x\n")
    with pytest.raises(FrozenInputError):
        load_fold_assignment(p)

def test_sha256_file_stable(tmp_path):
    p = _write(tmp_path/"a.txt", "hello")
    assert sha256_file(p) == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_frozen_inputs.py -v`
Expected: FAIL (`ModuleNotFoundError: p1.training.frozen_inputs`).

- [ ] **Step 3: Implement**

Create `frozen_inputs.py`:
```python
"""Loaders for the frozen split/fold artifacts + a file hasher.

p1.split is a read-only frozen contract with no loader; the training
entry point reads these CSVs instead of regenerating the split/folds.
"""
from __future__ import annotations

import csv
import hashlib
from pathlib import Path


class FrozenInputError(RuntimeError):
    """A frozen split/fold artifact is missing, malformed, or invalid."""


def load_split_assignment(path: Path) -> dict[str, str]:
    path = Path(path)
    if not path.exists():
        raise FrozenInputError(f"split assignment not found: {path}")
    out: dict[str, str] = {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["patient_id", "split"]:
            raise FrozenInputError(
                f"split schema mismatch in {path}: expected ['patient_id','split'], "
                f"got {reader.fieldnames}"
            )
        for r in reader:
            split = r["split"]
            if split not in ("dev", "test"):
                raise FrozenInputError(f"{path}: bad split value {split!r} for {r['patient_id']}")
            out[r["patient_id"]] = split
    if not out:
        raise FrozenInputError(f"split assignment is empty: {path}")
    return out


def load_fold_assignment(path: Path) -> dict[str, int]:
    path = Path(path)
    if not path.exists():
        raise FrozenInputError(f"fold assignment not found: {path}")
    out: dict[str, int] = {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["patient_id", "fold"]:
            raise FrozenInputError(
                f"fold schema mismatch in {path}: expected ['patient_id','fold'], "
                f"got {reader.fieldnames}"
            )
        for r in reader:
            try:
                fold = int(r["fold"])
            except (ValueError, TypeError) as e:
                raise FrozenInputError(f"{path}: non-int fold for {r['patient_id']}") from e
            if fold < 0:
                raise FrozenInputError(f"{path}: negative fold for {r['patient_id']}")
            out[r["patient_id"]] = fold
    if not out:
        raise FrozenInputError(f"fold assignment is empty: {path}")
    return out


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(Path(path).read_bytes())
    return h.hexdigest()
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_frozen_inputs.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/frozen_inputs.py algorithm/eye_diagnosis_p1/tests/test_training_frozen_inputs.py
git commit -m "feat(p2-01r): frozen split/fold loaders + file SHA-256 helper"
```

---

### Task 5: Freeze the OOF folds to disk (new — decision: freeze folds too)

Pinning only test/dev leaves fold membership at the mercy of the `iterative-stratification` version. Add a one-shot writer that materializes `fold_assignment_v1.csv` from `build_oof_folds`, so real runs read frozen folds instead of recomputing.

**Files:**
- Create: `algorithm/p1/training/freeze_folds.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_freeze_folds.py`

**Interfaces:**
- Consumes: `p1.split.{assign_splits, build_oof_folds, SplitAssignment, FoldMap}`, `p1.manifest.ManifestPaths`, `load_fold_assignment` (Task 4).
- Produces: `write_fold_assignment(fold_map: FoldMap, out_path: Path) -> Path` writing CSV `patient_id,fold` sorted by patient_id; and `freeze_folds_from_manifest(manifest: ManifestPaths, *, seed: int, k: int, out_dir: Path) -> Path` orchestrating split→folds→write (dev patients only). Round-trips through `load_fold_assignment`.

- [ ] **Step 1: Write failing test** (uses the committed synthetic manifest built in Task 9; here build a tiny FoldMap directly)

Create `test_training_freeze_folds.py`:
```python
from pathlib import Path
from p1.split import FoldMap
from p1.training.freeze_folds import write_fold_assignment
from p1.training.frozen_inputs import load_fold_assignment

def test_write_fold_round_trips(tmp_path):
    fm = FoldMap(patient_to_fold={"p001": 0, "p002": 1, "p003": 0}, k=2, seed=42)
    out = write_fold_assignment(fm, tmp_path / "fold_assignment_v1.csv")
    assert load_fold_assignment(out) == {"p001": 0, "p002": 1, "p003": 0}

def test_write_fold_is_sorted(tmp_path):
    fm = FoldMap(patient_to_fold={"p003": 1, "p001": 0}, k=2, seed=42)
    out = write_fold_assignment(fm, tmp_path / "f.csv")
    lines = out.read_text().strip().splitlines()
    assert lines[1].startswith("p001,") and lines[2].startswith("p003,")
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_freeze_folds.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `freeze_folds.py`:
```python
"""One-shot writer that freezes OOF fold membership to disk."""
from __future__ import annotations

import csv
from pathlib import Path

from p1.manifest import ManifestPaths
from p1.split import FoldMap, assign_splits, build_oof_folds


def write_fold_assignment(fold_map: FoldMap, out_path: Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(fold_map.patient_to_fold.items())
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["patient_id", "fold"])
        w.writeheader()
        for pid, fold in rows:
            w.writerow({"patient_id": pid, "fold": int(fold)})
    return out_path


def freeze_folds_from_manifest(
    manifest: ManifestPaths, *, seed: int, k: int, out_dir: Path
) -> Path:
    assignment = assign_splits(manifest, seed=seed, test_frac=0.15, out_dir=None)
    folds = build_oof_folds(assignment, manifest, k=k, seed=seed)
    return write_fold_assignment(folds, Path(out_dir) / "fold_assignment_v1.csv")
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_freeze_folds.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/freeze_folds.py algorithm/eye_diagnosis_p1/tests/test_training_freeze_folds.py
git commit -m "feat(p2-01r): freeze OOF folds to fold_assignment_v1.csv"
```

---

### Task 6: `run_fold` — train on Dev-fold only, GradScaler AMP, protocol weights, hashed receipt (blockers #1 leakage, #P1 AMP, #pretrained; receipt hashes)

The core fix. Current `run_fold` (fold_runner.py:141) draws the training batch from `val_patient_ids`, steps the optimizer on it (:184-185), then predicts on the same `val_patient_ids` — validation patients receive a gradient update. It also uses float16 autocast with a bare `backward()` (no `GradScaler`, :177-185) and `build_model(experiment, pretrained=False)` (:125).

**Files:**
- Modify: `algorithm/p1/training/fold_runner.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py` (rewrite the leaky fixture + add disjointness/AMP/weights tests)

**Interfaces:**
- Consumes: `build_model(experiment, weights=..., _download=...)` (Task 3), `load_fold_assignment`/`sha256_file` (Task 4), protocol `weights`/`checkpoint_selector`/`experiment_primary_metric` (Task 2).
- Produces: `run_fold(*, experiment, fold_id, train_patient_ids, val_patient_ids, image_paths, labels, root_dir, protocol, out_dir, e2_assignment=None, input_hashes: dict[str,str] | None = None, _mem_get_info=None, _download=True) -> FoldReceipt`.
  - **Renames `dev_patient_ids` → `train_patient_ids`** to make the disjointness contract explicit at the signature; the optimizer steps ONLY on `train_patient_ids`, predictions come ONLY from `val_patient_ids`.
  - Asserts `set(train_patient_ids) & set(val_patient_ids) == set()` and raises `TrainingError` otherwise.
  - `FoldReceipt` gains: `amp_enabled: bool`, `amp_dtype: str`, `grad_scaler_enabled: bool`, `weights: str`, `checkpoint_selector: str`, `manifest_sha256: str | None`, `split_sha256: str | None`, `fold_sha256: str | None`, `protocol_sha256: str | None`, `smoke: bool`, and renames `dev_patient_count` → `train_patient_count`. Hashes come from `input_hashes` (CLI supplies; unit tests pass `None`).

- [ ] **Step 1: Rewrite the leaky fixture + write failing disjointness test**

In `test_training_fold_runner.py`, change the fixture so train and val are disjoint and update all call sites to `train_patient_ids=`. Add a batch-recording spy proving the optimizer never sees a val patient:
```python
def test_run_fold_optimizer_never_steps_on_val_patients(tmp_path, fake_inputs, monkeypatch):
    import p1.training.fold_runner as fr
    seen_in_backward = []
    real_stack = fr._stack_batch
    def spy(patient_ids, *a, **k):
        seen_in_backward.extend(list(patient_ids))
        return real_stack(patient_ids, *a, **k)
    monkeypatch.setattr(fr, "_stack_batch", spy)

    pids = fake_inputs["pids"]
    train, val = pids[:4], pids[4:]           # disjoint
    fake_high = lambda device=None: (10000*1024*1024, 16384*1024*1024)
    fr.run_fold(
        experiment="E0", fold_id=0,
        train_patient_ids=train, val_patient_ids=val,
        image_paths=fake_inputs["image_paths"], labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"], protocol=default_protocol(),
        out_dir=tmp_path/"art", _mem_get_info=fake_high, _download=False,
    )
    assert set(seen_in_backward) & set(val) == set(), "val patients entered a training batch"

def test_run_fold_rejects_overlapping_train_val(tmp_path, fake_inputs):
    fake_high = lambda device=None: (10000*1024*1024, 16384*1024*1024)
    with pytest.raises(TrainingError):
        run_fold(
            experiment="E0", fold_id=0,
            train_patient_ids=fake_inputs["pids"][:5],
            val_patient_ids=fake_inputs["pids"][3:],   # overlaps
            image_paths=fake_inputs["image_paths"], labels=fake_inputs["labels"],
            root_dir=fake_inputs["root_dir"], protocol=default_protocol(),
            out_dir=tmp_path/"art", _mem_get_info=fake_high, _download=False,
        )

def test_receipt_records_amp_and_weights(tmp_path, fake_inputs):
    fake_high = lambda device=None: (10000*1024*1024, 16384*1024*1024)
    r = run_fold(
        experiment="E0", fold_id=0,
        train_patient_ids=fake_inputs["pids"][:4], val_patient_ids=fake_inputs["pids"][4:],
        image_paths=fake_inputs["image_paths"], labels=fake_inputs["labels"],
        root_dir=fake_inputs["root_dir"], protocol=default_protocol(),
        out_dir=tmp_path/"art", _mem_get_info=fake_high, _download=False,
    )
    assert r.weights == "EfficientNet_B4_Weights.IMAGENET1K_V1"
    assert r.grad_scaler_enabled == r.amp_enabled  # scaler on iff amp on
    assert r.amp_dtype in ("float16", "none")
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_fold_runner.py -v`
Expected: FAIL (`run_fold` has no `train_patient_ids` kwarg; old tests referencing `dev_patient_ids` also fail — update them all in this step).

- [ ] **Step 3: Implement the runner rewrite**

Key edits in `fold_runner.py`:
1. Rename param `dev_patient_ids` → `train_patient_ids`; add `input_hashes`, `_download`.
2. Immediately after preflight, assert disjointness:
```python
    overlap = set(train_patient_ids) & set(val_patient_ids)
    if overlap:
        raise TrainingError(
            f"train∩val must be empty (OOF integrity); overlap: {sorted(overlap)[:5]}"
        )
```
3. Build the model from the protocol weights:
```python
    model = build_model(experiment, weights=protocol.weights, _download=_download)
```
4. Draw the **training** smoke batch from `train_patient_ids` (not val):
```python
    train_smoke_pids = list(train_patient_ids)[: max(2, protocol.patient_batch)]
    if not train_smoke_pids:
        raise TrainingError("train_patient_ids is empty; cannot run a fold")
```
   Build `val`/`train` batches via `_stack_batch` from their respective id lists. The E3 left/right stacking stays, but sourced from `train_smoke_pids` for the optimizer step.
5. AMP with GradScaler:
```python
    use_amp = bool(protocol.amp and torch.cuda.is_available())
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    optimizer.zero_grad(set_to_none=True)
    if use_amp:
        with torch.amp.autocast(device_type="cuda", dtype=torch.float16, enabled=True):
            loss = _forward_and_loss(model, train_batch, train_labels)
    else:
        loss = _forward_and_loss(model, train_batch, train_labels)
    if torch.isnan(loss).any():
        raise TrainingError(f"NaN loss in fold {fold_id} experiment {experiment}")
    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
```
6. Prediction loop unchanged **except** it iterates only `val_patient_ids` (it already does).
7. Extend `FoldReceipt` with the new fields; populate `amp_enabled=use_amp`, `amp_dtype="float16" if use_amp else "none"`, `grad_scaler_enabled=use_amp`, `weights=protocol.weights`, `checkpoint_selector=protocol.checkpoint_selector`, and the four `*_sha256` from `input_hashes or {}` (`.get(..., None)`), `smoke=True`, `train_patient_count=len(train_patient_ids)`.
8. `build_run_fold_with_mock_mem` — update its internal `run_fold(**kwargs)` call site only if kwarg names changed (they did: callers now pass `train_patient_ids`).

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_fold_runner.py -v`
Expected: PASS (leakage, overlap-rejection, AMP/weights receipt).

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/fold_runner.py algorithm/eye_diagnosis_p1/tests/test_training_fold_runner.py
git commit -m "fix(p2-01r): run_fold trains on Dev-fold only; GradScaler AMP; hashed receipt

Blocker #1: optimizer.step no longer touches val_patient_ids (train∩val=∅,
asserted). Blocker AMP: float16 autocast now wrapped in GradScaler. Blocker
pretrained: model built from protocol IMAGENET1K_V1 weights. Receipt records
amp/scaler/weights/selector + manifest/split/fold/protocol SHA-256 + smoke."
```

---

### Task 7: `validate_oof` verifies against the frozen split, not caller sets (blocker: self-attestation)

`validate_oof(path, *, expected_dev_patients, dev_patients)` trusts two caller-supplied sets; a caller that puts a Test id into `dev_patients` passes validation. Read the frozen split so "is this a Test patient" is decided by the immutable artifact.

**Files:**
- Modify: `algorithm/p1/training/oof.py` (`validate_oof`)
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_oof.py`

**Interfaces:**
- Consumes: `load_split_assignment` (Task 4).
- Produces: `validate_oof(path: Path, *, split_assignment_path: Path, fold_id: int | None = None, fold_assignment_path: Path | None = None) -> dict`. Expected Dev patients are derived as `{pid for pid,s in split.items() if s=="dev"}`; any OOF row whose patient is `"test"` in the frozen split raises `OofIntegrityError`. When `fold_id`/`fold_assignment_path` are given, also assert every OOF row's patient belongs to that fold. Backward-compat: keep the old keyword-only signature reachable via a thin `validate_oof_with_sets(...)` for existing unit tests that don't need the frozen file, but the CLI/receipt path uses the frozen-split form.

- [ ] **Step 1: Write failing test**

Add to `test_training_oof.py`:
```python
def test_validate_oof_uses_frozen_split_to_reject_test_patient(tmp_path):
    from p1.training.oof import OofWriter, OOF_COLUMNS, validate_oof, OofIntegrityError
    from p1.audit import CLASS_ORDER
    split = tmp_path/"split.csv"
    split.write_text("patient_id,split\npA,dev\npB,test\n")
    oof = tmp_path/"oof.csv"
    def row(pid):
        r = {"patient_id": pid, "fold": 0, "experiment_id": "E0", "seed": 42,
             "checkpoint_sha256": "a"*64}
        for c in CLASS_ORDER: r[f"true_{c}"] = 0
        for c in CLASS_ORDER: r[f"prob_{c}"] = 0.1
        return r
    with OofWriter(oof) as w:
        w.append([row("pA"), row("pB")])   # pB is Test in the frozen split
    with __import__("pytest").raises(OofIntegrityError):
        validate_oof(oof, split_assignment_path=split)
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_oof.py::test_validate_oof_uses_frozen_split_to_reject_test_patient -v`
Expected: FAIL (`validate_oof` has no `split_assignment_path` kwarg).

- [ ] **Step 3: Implement**

Rename the existing body to `validate_oof_with_sets(path, *, expected_dev_patients, dev_patients)` (keep it for legacy tests), then add:
```python
from p1.training.frozen_inputs import load_split_assignment, load_fold_assignment

def validate_oof(path, *, split_assignment_path, fold_id=None, fold_assignment_path=None):
    split = load_split_assignment(split_assignment_path)
    dev_patients = {p for p, s in split.items() if s == "dev"}
    result = validate_oof_with_sets(
        path, expected_dev_patients=dev_patients, dev_patients=dev_patients
    )
    if fold_id is not None and fold_assignment_path is not None:
        folds = load_fold_assignment(fold_assignment_path)
        import csv as _csv
        with Path(path).open() as f:
            for r in _csv.DictReader(f):
                pid = r["patient_id"]
                if folds.get(pid) != fold_id:
                    raise OofIntegrityError(
                        f"OOF {path}: patient {pid} is not in fold {fold_id} "
                        f"(frozen fold: {folds.get(pid)})"
                    )
    return result
```
Note: `expected_dev_patients == dev_patients` here means the OOF for a single fold need only be a subset; adjust `validate_oof_with_sets` so `missing` is checked only when the caller wants a full-Dev OOF (add `require_complete: bool = True` and pass `False` from the fold-scoped path).

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_oof.py -v`
Expected: PASS (new + existing, existing ones now calling `validate_oof_with_sets`).

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/oof.py algorithm/eye_diagnosis_p1/tests/test_training_oof.py
git commit -m "fix(p2-01r): validate_oof decides Test membership from the frozen split

Caller-supplied dev/test sets were self-attesting. Read
split_assignment_v1.csv so a Test patient in the OOF fails closed;
optionally assert fold membership against fold_assignment_v1.csv."
```

---

### Task 8: CLI consumes frozen split+fold with explicit paths; records hashes (blockers #2, #3 path-conflation)

The CLI recomputes split/folds every run (cli.py:68-69) and overloads one `--eye-data-root` as manifest dir AND image root (cli.py:51-55 vs :100-105). Replace with four explicit paths; read frozen artifacts; pass `input_hashes` to `run_fold`.

**Files:**
- Modify: `algorithm/p1/training/cli.py`
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_cli.py` (create if absent)

**Interfaces:**
- Consumes: `load_split_assignment`, `load_fold_assignment`, `sha256_file` (Task 4); `run_fold(train_patient_ids=..., val_patient_ids=..., input_hashes=...)` (Task 6); `assign_e2_eyes` (Task 1).
- Produces: `parse_args` with required `--manifest`, `--split-assignment`, `--fold-assignment`, `--image-root`, plus `--experiment`, `--fold`, `--protocol`, `--out-dir`, `--smoke`. `main` builds `val_patient_ids = [pid for pid,f in fold_map.items() if f==args.fold and split[pid]=="dev"]` and `train_patient_ids = [pid for pid,f in fold_map.items() if f!=args.fold and split[pid]=="dev"]` — Test patients are structurally excluded. Never calls `assign_splits`/`build_oof_folds`.

- [ ] **Step 1: Write failing test**

Create `test_training_cli.py`:
```python
import pytest
from p1.training.cli import parse_args

def test_cli_requires_explicit_frozen_paths():
    ns = parse_args([
        "--experiment", "E0", "--fold", "0",
        "--manifest", "m.parquet",
        "--split-assignment", "s.csv",
        "--fold-assignment", "f.csv",
        "--image-root", "imgs/",
    ])
    assert ns.split_assignment == "s.csv"
    assert ns.fold_assignment == "f.csv"
    assert ns.image_root == "imgs/"

def test_cli_rejects_missing_split_assignment():
    with pytest.raises(SystemExit):
        parse_args(["--experiment", "E0", "--fold", "0",
                    "--manifest", "m.parquet", "--image-root", "imgs/"])

def test_cli_has_no_eye_data_root():
    # the overloaded arg must be gone
    import argparse
    with pytest.raises(SystemExit):
        parse_args(["--experiment", "E0", "--fold", "0", "--eye-data-root", "x"])
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_cli.py -v`
Expected: FAIL (args don't exist / `--eye-data-root` still accepted).

- [ ] **Step 3: Implement**

Rewrite `parse_args` to add `--manifest`, `--split-assignment`, `--fold-assignment`, `--image-root` (all `required=True`), remove `--eye-data-root` and `--device`. Rewrite `main`:
```python
    protocol = load_protocol(Path(args.protocol))
    split = load_split_assignment(Path(args.split_assignment))
    fold_map = load_fold_assignment(Path(args.fold_assignment))
    manifest_path = Path(args.manifest)
    image_root = Path(args.image_root)
    for p in (manifest_path, image_root):
        if not p.exists():
            print(f"path not found: {p}", file=sys.stderr); return 2

    val = [pid for pid, f in fold_map.items() if f == args.fold and split.get(pid) == "dev"]
    train = [pid for pid, f in fold_map.items() if f != args.fold and split.get(pid) == "dev"]

    pdf = pd.read_parquet(manifest_path)
    image_paths = {r["patient_id"]: {"left": Path(r["left_image_relpath"]),
                                     "right": Path(r["right_image_relpath"])}
                   for r in pdf.to_dict("records")}
    labels = {r["patient_id"]: np.asarray([r[f"label_{c}"] for c in CLASS_ORDER], dtype=np.int8)
              for r in pdf.to_dict("records")}
    e2 = assign_e2_eyes(list(pdf["patient_id"]), seed=protocol.e2_seed) if args.experiment == "E2" else None

    input_hashes = {
        "manifest_sha256": sha256_file(manifest_path),
        "split_sha256": sha256_file(Path(args.split_assignment)),
        "fold_sha256": sha256_file(Path(args.fold_assignment)),
        "protocol_sha256": sha256_file(Path(args.protocol)),
    }
    receipt = run_fold(
        experiment=args.experiment, fold_id=args.fold,
        train_patient_ids=train, val_patient_ids=val,
        image_paths=image_paths, labels=labels, root_dir=image_root,
        protocol=protocol, out_dir=Path(args.out_dir)/args.experiment/f"fold_{args.fold}",
        e2_assignment=e2, input_hashes=input_hashes,
    )
```
Remove the `assign_splits`/`build_oof_folds`/`ManifestPaths`/`_load_manifest` imports and helper.

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_cli.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add algorithm/p1/training/cli.py algorithm/eye_diagnosis_p1/tests/test_training_cli.py
git commit -m "fix(p2-01r): CLI reads frozen split+fold via explicit paths, records hashes

Blocker #2: no more live assign_splits/build_oof_folds — reads
split_assignment_v1.csv + fold_assignment_v1.csv. Blocker path-conflation:
separate --manifest / --split-assignment / --fold-assignment / --image-root."
```

---

### Task 9: Committed synthetic fixtures + full-suite green (decision: fixture for CI)

Give the clean-checkout suite a tiny committed manifest + split + fold so the CLI's frozen-input path is exercised without shipping patient data.

**Files:**
- Create: `algorithm/eye_diagnosis_p1/tests/fixtures/build_fixture.py` (generator) and the generated `algorithm/eye_diagnosis_p1/tests/fixtures/{patient_manifest_v1.parquet, split_assignment_v1.csv, fold_assignment_v1.csv}` + 20 tiny JPEGs under `fixtures/images/`.
- Test: `algorithm/eye_diagnosis_p1/tests/test_training_cli_e2e.py`

**Interfaces:**
- Consumes: everything above.
- Produces: an end-to-end CLI test that runs one fold on the fixture with a fake high-VRAM probe and `_download=False`, then asserts the OOF passes `validate_oof(..., split_assignment_path=fixture_split, fold_id=0, fold_assignment_path=fixture_fold)` and the receipt carries all four SHA-256 fields.

- [ ] **Step 1: Write the fixture generator + failing e2e test**

`build_fixture.py` writes 10 patients (`p000`–`p009`), 8 dev / 2 test, folds 0/1 over dev, a parquet with `patient_id,left_image_relpath,right_image_relpath,age,sex,label_*`, and 20 solid-color 32×32 JPEGs. The e2e test invokes `p1.training.cli.main([...])` via monkeypatched `run_fold` `_download`/`_mem_get_info` (inject through a thin `--_test-fast` path OR call `run_fold` directly with fixture-derived ids — prefer calling `main` and monkeypatching `p1.training.cli.run_fold` to force `_download=False, _mem_get_info=fake_high`).

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest eye_diagnosis_p1/tests/test_training_cli_e2e.py -v`
Expected: FAIL (fixtures absent).

- [ ] **Step 3: Generate fixtures and implement the e2e test**

Run the generator; commit the artifacts. Implement the assertions.

- [ ] **Step 4: Run the FULL suite**

Run: `python -m pytest eye_diagnosis_p1/tests/ -q`
Expected: all pass (count will differ from 136 — record the new number).

- [ ] **Step 5: Commit**

```bash
git add algorithm/eye_diagnosis_p1/tests/fixtures algorithm/eye_diagnosis_p1/tests/test_training_cli_e2e.py
git commit -m "test(p2-01r): committed synthetic fixtures + CLI end-to-end frozen-path test"
```

---

### Task 10: Clean-checkout reproducibility gate + real GPU smoke (blockers #10, #11, #12)

**Files:** none (verification only).

**Interfaces:** Consumes the full branch.

- [ ] **Step 1: Fresh clone at branch HEAD, no working-tree leakage**

```bash
git clone D:/Work/code/eye-diagnosis /tmp/p2-01r-clean
cd /tmp/p2-01r-clean && git checkout codex/first-batch-medical-safety
```

- [ ] **Step 2: Run the suite in the clean clone**

Run (from the clone's `algorithm/`): `D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m pytest eye_diagnosis_p1/tests/ -q`
Expected: all pass, zero collection errors, no `ModuleNotFoundError`. `git status` in the clone shows a clean tree (no untracked source).

- [ ] **Step 3: Real E3 fold-0 GPU smoke (host with ≥6800 MB free only)**

```bash
D:/programe/Anaconda/envs/eye-p1-bench/python.exe -m p1.training.cli \
  --experiment E3 --fold 0 --smoke \
  --protocol p1/protocol_e0_e3_v1.json \
  --manifest artifacts/p1_v1/patient_manifest_v1.parquet \
  --split-assignment artifacts/p1_v1/split_assignment_v1.csv \
  --fold-assignment artifacts/p1_v1/fold_assignment_v1.csv \
  --image-root "D:/Work/code/eye-diagnosis/algorithm/datasets/DataSet/Training_Dataset/Training_Dataset/"
```
(First generate `fold_assignment_v1.csv` once via `freeze_folds_from_manifest`.) Expected: exit 0; a `fold_0_receipt.json` whose `weights == EfficientNet_B4_Weights.IMAGENET1K_V1`, `amp_enabled == true`, `grad_scaler_enabled == true`, all four SHA-256 present, `smoke == true`. The OOF covers only the fold-0 validation subset (do NOT treat it as a full-fold OOF).

- [ ] **Step 4: Confirm the acceptance gate**

Verify: clean-checkout tests pass; `train∩val=0`; zero val patients in any backward; frozen split+fold used (no runtime regeneration); weights IMAGENET1K_V1; `pretrained=False` path unreachable in the CLI; GradScaler enabled; E2 full-seed hash; real E3 fold-0 smoke PASS; zero Frozen-Test patients read.

- [ ] **Step 5: Update PR #2 body with two acceptance sections (A: first-batch medical safety, B: P1/P2 algorithm protocol) and keep it Draft.** Do not merge on `mergeable=true`.

---

## Self-Review

**Spec coverage** (against the 12-item repair list + 2 decisions):
1. Smoke trains on train fold → Task 6. ✅
2. Val never in gradient update → Task 6 (assert + spy test). ✅
3. CLI reads frozen split → Task 8 (+ loader Task 4). ✅
4. Separate manifest/split/fold/image-root args → Task 8. ✅
5. Explicit IMAGENET1K_V1 → Task 2 (protocol) + Task 3 (factory) + Task 6 (use). ✅
6. AMP GradScaler → Task 6. ✅
7. Fold selector = validation_macro_auprc → Task 2. ✅
8. E2 full patient_id:seed hash → Task 1. ✅
9. Commit missing p1.benchmark deps → Task 0. ✅
10. Full test on clean clone at PR HEAD → Task 10. ✅
11. Real E3 fold-0 smoke → Task 10. ✅
12. Smoke OOF = validation subset only, not full-fold OOF → Task 6 (receipt `smoke=true`) + Task 10 note. ✅
- Decision "fixture for CI / real for prod" → Task 9. ✅
- Decision "freeze folds too + hash all" → Task 5 (freeze) + Task 6/8 (hash all four). ✅

**Placeholder scan:** every code step shows real code; no TBD/TODO. ✅

**Type consistency:** `train_patient_ids` used consistently in Tasks 6/8; `weights` string threaded protocol→factory→receipt; `load_split_assignment`/`load_fold_assignment`/`sha256_file` signatures match across Tasks 4/5/6/7/8; `validate_oof` frozen-split form used by CLI, `validate_oof_with_sets` retained for legacy unit tests. ✅

**Known follow-ups (out of P2-01R):** full 5-fold×4-experiment driver, OOF combine + `oof_macro_auprc` comparator, bootstrap CI, early-stopping/checkpoint selection, FOV crop — remain P2-02.
