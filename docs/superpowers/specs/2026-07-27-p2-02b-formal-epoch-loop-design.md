# P2-02B — Formal epoch training loop (design spec)

**Date:** 2026-07-27
**Branch:** `codex/p2-02a-t3-matrix` (worktree `.worktrees/p2-02a-t3`, based on `554df03` after T4 merge)
**Status:** Design approved; pending spec review → writing-plans → TDD implementation.
**Predecessors (frozen, on this branch):** T1.1/T1.2 staged probe + `p1.stability.cli`, T2 subprocess watchdog, T3 6-cell matrix runner, T4 100-batch stability runner. All merged in commits `19d8557..554df03`. P2-01 integrity layer (`manifest.py`/`split.py`/`frozen_inputs.py`) remains frozen.

---

## 1. Purpose & scope

P2-02B is the **formal epoch training loop** that P2-02C and P2-03 will run on the real GPU. It is a new code path built next to the frozen smoke (`cli.py` / `fold_runner.py`) — it does **not** extend the smoke with a "formal mode" flag, does **not** re-implement the smoke's per-fold runner, and does **not** touch any frozen module.

**In scope (P2-02B delivers)**

1. Six new modules under `algorithm/p1/training/`: `engine.py`, `metrics.py`, `checkpoint.py`, `formal_fold_runner.py`, `orchestrator.py`, `cli_formal.py`.
2. Multi-epoch training + per-epoch validation + best-checkpoint save + early stopping + ReduceLROnPlateau scheduler.
3. JSONL training log + complete-fold OOF export + full metrics set + atomic `fold_receipt.json`.
4. Strict-determinism flags (`cudnn.deterministic=True`, `cudnn.benchmark=False`, `torch.use_deterministic_algorithms(warn_only=True)`) so round 1 / round 2 / round 3 (P2-02C, P2-03, P3) are bit-reproducible at the same seed.
5. Reuse of the **DI'd real adapters** from `p1.stability.cli` (`TorchAdapter`, `DataLoaderFactory`, `ModelFactory`, `optimizer_factory`) so CI tests run without CUDA and the real path uses the battle-tested wiring.
6. Multi-fold orchestrator (`orchestrator.run_formal_experiment`) **fully implemented** but invoked with `folds=[0]` in P2-02B; P2-03 will call it with `folds=[0,1,2,3,4]`.
7. CI smoke test on a tiny fixture (4 patients, max_epochs=2) that verifies the full artifact tree + exit-0.

**Out of scope (hard constraints — protocol violations to add any of these during P2-02B review)**

- **No real GPU Fold-0 run.** That is P2-02C (E3 + seed 42 + fold 0 + ≤3 epochs, as engineering acceptance).
- **No multi-fold (4×5) execution.** That is P2-03.
- **No loss ablation / multi-seed / Test set.** Those are P3, P4.
- **No edits to frozen modules.** `p1/training/{cli.py, fold_runner.py, models.py, oof.py, frozen_inputs.py, protocol.py, preflight.py, datasets.py, e2_assignment.py, freeze_folds.py, __init__.py}` and everything under `p1/stability/` except as new additive files. Existing P2-02A fixes in `p1/stability/cli.py` and `p1/stability/probe.py` stay exactly as merged.
- **No Softmax / `CrossEntropyLoss` / per-eye metrics / threshold tuning / auto batch-size shrink / auto backbone downgrade / runtime protocol edit / runtime re-split / Test patients in train or val.** All banned by the frozen v1 config and P2-02 protocol memory.
- **No enhancements.** RETFound / EyeQ / Grad-CAM / AutoMorph / Cross-Attention / Transformer Fusion are P5+ until the bilateral question (P2-02 / P2-03) is answered.

---

## 2. Architecture — Approach A (epoch-level functions + DI'd real adapters)

The engine exposes two **epoch-level pure functions** (`train_one_epoch`, `evaluate`) that take injected adapters (`TorchAdapter`, `DataLoaderFactory`, `ModelFactory`, `optimizer_factory`) plus a `criterion`. They do **no** I/O (no checkpoint save, no JSONL write, no logging beyond `logging.debug`). `formal_fold_runner.py` orchestrates the epoch loop, checkpoint save, JSONL append, and OOF/report generation. `orchestrator.py` is a thin wrapper that calls `formal_fold_runner` once per fold. `cli_formal.py` is the argparse front end.

Chosen because: (i) it mirrors the smoke `fold_runner.py` shape exactly so reviewers can diff the two, (ii) it lets unit tests call `train_one_epoch` with a fake loader / fake model / fake scaler without a GPU, and (iii) `frozen_inputs.py` / `protocol.py` / `oof.py` already expose the deterministic-split + complete-fold-OOF contracts that the runner composes against.

```
cli_formal.main(argv)
  └─ orchestrator.run_formal_experiment(experiment, folds, cfg)       # P2-02B: folds=[0]
       └─ for fold in folds:
            formal_fold_runner.run_formal_fold(fold=fold, cfg=cfg)     # one fold
                 ├─ 1. pre-flight (fail fast, no side effects)
                 ├─ 2. build model/optim/scheduler/criterion/scaler via DI'd adapters
                 ├─ 3. for epoch in range(max_epochs):
                 │      train_one_epoch(...) → EpochStats
                 │      evaluate(...)        → ValStats
                 │      scheduler.step(val_macro_auprc)
                 │      early-stop check + best-checkpoint save + JSONL append
                 │      if early_stop_counter >= patience: break
                 ├─ 4. load best checkpoint → OOF inference → full metrics
                 │      write metrics.json + oof.csv + validation_predictions.csv
                 ├─ 5. compute SHA256 of best checkpoint, write .sha256
                 ├─ 6. write fold_receipt.json + protocol.json + environment.json
                 └─ (any exception ⇒ status=BLOCKED + fold_receipt.json; no checkpoint, no metrics)
```

### New modules (all additive, under `algorithm/p1/training/`)

| Module | Responsibility | Key surface |
|---|---|---|
| `engine.py` | `train_one_epoch`, `evaluate` — pure, no I/O | `EpochStats`, `ValStats` dataclasses |
| `metrics.py` | Compute Macro/Micro AUPRC+AUROC+F1, per-class AUPRC, sensitivity/specificity/precision, support; skip empty classes | `compute_full_metrics(y_true, y_proba, threshold) -> MetricsDict` |
| `checkpoint.py` | `save_checkpoint`, `load_checkpoint`, `sha256_file` — atomic write to `.tmp` then `os.replace` | `save_checkpoint(state_dict, metadata, path) -> None` |
| `formal_fold_runner.py` | Single-fold driver: pre-flight → epoch loop → OOF → reports → receipt | `run_formal_fold(fold, cfg) -> FoldReceipt` |
| `orchestrator.py` | Multi-fold wrapper; iterates folds, calls formal_fold_runner, returns per-fold receipts | `run_formal_experiment(experiment, folds, cfg) -> ExperimentReceipt` |
| `cli_formal.py` | argparse front end; delegates to orchestrator | `main(argv) -> int` |

`engine.py`, `metrics.py`, `checkpoint.py`, `formal_fold_runner.py`, `orchestrator.py`, `cli_formal.py` all import their **real adapters** from `p1.stability.cli` (`build_real_torch_adapter`, `build_real_dataloader_factory`, `build_real_model_factory`, `make_real_optimizer_factory`) so the P2-02A battle-tested wiring is the only GPU path. CI tests pass fakes (`FakeTorchAdapter`, `FakeDataLoaderFactory`, `FakeModelFactory`, `FakeOptimizerFactory`) — these fakes already exist in `eye_diagnosis_p1/tests/test_p2_02a_*`; the new test files reuse them and add training-specific fakes in `eye_diagnosis_p1/tests/fakes/`.

### Dependencies on existing code (read-only imports)

- `p1.training.frozen_inputs` — `validate_frozen_training_inputs`, `load_split_assignment`, `load_fold_assignment`
- `p1.training.protocol` — protocol JSON loader (frozen v1)
- `p1.benchmark.compute` — `_percentile`, `is_oom_error`
- `p1.stability.cli` — `build_real_torch_adapter`, `build_real_dataloader_factory`, `build_real_model_factory`, `make_real_optimizer_factory` (re-exported as `p1.training.adapters` for cleanliness — no frozen-code edit, just a re-export wrapper if needed; if not, import from `p1.stability.cli` directly is acceptable).

---

## 3. Module details

### 3.1 `engine.py`

```python
def train_one_epoch(
    *, torch_adapter, model, loader, optimizer, scaler, criterion,
    device, amp, grad_clip_norm, is_main_process=True,
) -> EpochStats:
    """One pass over `loader`. Returns aggregate stats. No I/O."""

def evaluate(
    *, torch_adapter, model, loader, criterion, device, threshold=0.5,
) -> ValStats:
    """Full validation pass. Returns ValStats containing loss + Macro-AUPRC + (optionally) per-class."""
```

**`train_one_epoch` inner loop (per batch):**
1. `H2D`: `left = left.to(device, non_blocking=True); right = right.to(device, non_blocking=True); labels = labels.to(device, non_blocking=True)`
2. `optimizer.zero_grad(set_to_none=True)`
3. `autocast_ctx = torch_adapter.autocast(device_type='cuda', enabled=amp)`; `__enter__()`
4. `logits = model(left, right); loss = criterion(logits, labels.float())`
5. `__exit__(None, None, None)` (try/finally so exception propagates correctly)
6. **NaN check**: `if not torch_adapter.isfinite(loss): raise NanLossError(...)`
7. `scaler.scale(loss).backward()`
8. `scaler.unscale_(optimizer)` (only when `amp=True and grad_clip_norm is not None`)
9. `scaler.clip_grad_norm_(model.parameters(), grad_clip_norm)` (only when clip is set)
10. `scaler.step(optimizer); scaler.update()`
11. `torch_adapter.cuda_synchronize()` (only at end of epoch, not per batch — preserve T4 throughput)

Returns `EpochStats(loss=avg_loss, num_batches=..., num_samples=..., gpu_step_ms=...)`. Does **not** step any per-epoch scheduler (that's the runner's job after `evaluate`).

### 3.2 `metrics.py`

```python
@dataclass
class MetricsDict:
    macro_auprc: float
    micro_auprc: float
    macro_auroc: float
    micro_auroc: float
    macro_f1: float
    micro_f1: float
    per_class_auprc: list[float | None]  # None where skipped
    per_class_auroc: list[float | None]
    per_class_precision: list[float]
    per_class_recall: list[float]
    per_class_f1: list[float]
    per_class_support_pos: list[int]
    per_class_support_neg: list[int]
    skipped_classes: list[int]
    threshold: float

def compute_full_metrics(
    y_true: np.ndarray,  # shape (N, num_classes), float
    y_proba: np.ndarray,  # shape (N, num_classes), float in [0, 1]
    threshold: float = 0.5,
) -> MetricsDict: ...
```

**Multi-class AUPRC rule (locked in Section 5 of brainstorming):** classes with `support_pos == 0` are skipped (their `per_class_auprc` is `None`, `per_class_auroc` is `None`); `macro_auprc` and `macro_auroc` are the unweighted mean of remaining classes. `skipped_classes` is the sorted list of skipped class indices. AUROC for skipped classes is also `None` (consistent with AUPRC). Precision/recall/F1 at the threshold are computed for every class (no skip — denominator is non-zero), with `support_neg == 0` flagged in `skipped_classes` only for AUPRC/AUROC purposes.

`sensitivity == recall`, `specificity == 1 - fpr`. AUROC uses `sklearn.metrics.roc_auc_score` with `average=None` per class, then macro of non-NaN.

### 3.3 `checkpoint.py`

```python
def save_checkpoint(
    state_dict: dict, metadata: dict, path: Path,
) -> None:
    """Atomic write: tmp file + os.replace. metadata is stored under the '__meta__' key
    in the same .pth so load_checkpoint can recover both."""

def load_checkpoint(path: Path) -> tuple[dict, dict]:
    """Returns (state_dict, metadata)."""

def sha256_file(path: Path) -> str:
    """Hex SHA256 of file bytes."""
```

Atomic write contract:
- Write to `<path>.tmp` (e.g. `best_checkpoint.pth.tmp`)
- `os.replace(<path>.tmp, <path>)` (POSIX rename; on Windows replaces if target exists)
- No `.tmp` file should remain after success; tests assert this.

`metadata` dict schema (always present):
```python
{
  "schema_version": "p2-02b-v1",
  "fold": int,
  "experiment": str,
  "epoch": int,
  "best_metric": float,
  "best_metric_name": "validation_macro_auprc",
  "config_hash": str,  # SHA256 of protocol.json bytes
  "saved_at": "<ISO8601>",
}
```

### 3.4 `formal_fold_runner.py`

Public surface:
```python
def run_formal_fold(
    *, fold: int, cfg: ProtocolConfig, out_dir: Path, experiment: str = "E3",
    seed: int = 42, max_epochs: int | None = None, patience: int | None = None,
) -> FoldReceipt: ...
```

`cfg` is the loaded frozen v1 protocol (`protocol_p2_02a_v1.json`). `max_epochs` and `patience` override protocol defaults if set (CLI uses this to allow `<=3 epochs` smoke in P2-02C).

**Step 1 — pre-flight (fail fast):**
- `validate_frozen_training_inputs(manifest_pids, split, fold, expected_folds=5)`
- CUDA probe (fail with `PreflightError(reason="no_cuda")` if absent)
- Set seeds: `torch.manual_seed(seed); torch.cuda.manual_seed_all(seed); numpy.random.seed(seed); random.seed(seed)`
- Strict determinism flags: `torch.backends.cudnn.deterministic = True; torch.backends.cudnn.benchmark = False; torch.use_deterministic_algorithms(True, warn_only=True)`
- `mkdir -p <out_dir>/fold_<N>/`; write `protocol.json` (copy of frozen v1) + `environment.json` (fingerprint).

**Step 2 — build components:**
- `model, _ = ModelFactory(experiment=experiment, weights="EfficientNet_B4_Weights.IMAGENET1K_V1", device='cuda')`
- `model.train()`
- `optimizer = optimizer_factory(model)`  (real factory returns `AdamW(lr=1e-4, wd=1e-4)`)
- `scheduler = ReduceLROnPlateau(optimizer, mode='max', factor=0.5, patience=2)` (locked: factor=0.5 patience=2)
- `criterion = torch.nn.BCEWithLogitsLoss()`
- `scaler = torch.amp.GradScaler('cuda', enabled=amp)`
- `train_loader = DataLoaderFactory(dataset=..., batch_size=8, num_workers=2, pin_memory=True, split='train', fold=fold)`
- `val_loader = DataLoaderFactory(dataset=..., batch_size=8, num_workers=2, pin_memory=True, split='val', fold=fold)`

**Step 3 — epoch loop:**
```python
best_metric = -inf; best_epoch = -1; early_stop_counter = 0
early_stop_patience = patience if patience is not None else cfg['early_stopping_patience']  # 5
max_epochs_run = max_epochs if max_epochs is not None else cfg['max_epochs']  # 20

for epoch in range(max_epochs_run):
    train_stats = train_one_epoch(
        torch_adapter=torch_a, model=model, loader=train_loader,
        optimizer=optimizer, scaler=scaler, criterion=criterion,
        device='cuda', amp=cfg['amp'], grad_clip_norm=cfg['gradient_clip_norm'],
    )
    val_stats = evaluate(
        torch_adapter=torch_a, model=model, loader=val_loader,
        criterion=criterion, device='cuda', threshold=cfg['threshold_policy'].split('_')[1],  # 0.5
    )
    scheduler.step(val_stats.macro_auprc)
    is_best = val_stats.macro_auprc > best_metric
    if is_best:
        best_metric = val_stats.macro_auprc; best_epoch = epoch
        save_checkpoint(model.state_dict(), metadata={
            'schema_version': 'p2-02b-v1', 'fold': fold, 'experiment': experiment,
            'epoch': epoch, 'best_metric': best_metric,
            'best_metric_name': 'validation_macro_auprc',
            'config_hash': cfg_hash, 'saved_at': now_iso(),
        }, path=fold_dir / 'best_checkpoint.pth')
        early_stop_counter = 0
    else:
        early_stop_counter += 1
    append_jsonl(fold_dir / 'training_log.jsonl', {
        'schema_version': 'p2-02b-v1', 'epoch': epoch,
        'train_loss': train_stats.loss, 'val_loss': val_stats.loss,
        'val_macro_auprc': val_stats.macro_auprc,
        'lr': optimizer.param_groups[0]['lr'],
        'early_stop_counter': early_stop_counter, 'is_best': is_best,
        'gpu_step_ms': train_stats.gpu_step_ms, 'num_batches': train_stats.num_batches,
    })
    if early_stop_counter >= early_stop_patience:
        break
```

**Step 4 — post-loop (always runs, even if early stop):**
- `model.load_state_dict(load_checkpoint(fold_dir/'best_checkpoint.pth')[0])`
- Re-run `evaluate` on `val_loader` to collect per-sample probabilities (`val_stats.probabilities`).
- `compute_full_metrics(y_true, y_proba, threshold=0.5)` → `MetricsDict`.
- Write `validation_predictions.csv` (`patient_id, fold, true_label_0..7, pred_proba_0..7, threshold=0.5`).
- Write `oof.csv` (same as above + `epoch, best_metric, experiment, seed`).
- Write `metrics.json` (the `MetricsDict` as JSON + `skipped_classes`).
- Write `best_checkpoint.sha256 = sha256_file(fold_dir/'best_checkpoint.pth')`.

**Step 5 — receipt:**
- Write `fold_receipt.json` atomically (see §6).
- Returns the `FoldReceipt` dataclass for `orchestrator.py`.

### 3.5 `orchestrator.py`

```python
@dataclass
class ExperimentReceipt:
    schema_version: str  # 'p2-02b-v1'
    experiment: str
    seed: int
    folds_requested: list[int]
    per_fold: list[FoldReceipt]   # one per requested fold, in order
    overall_status: str           # 'PASS' iff every per_fold.status == 'PASS';
                                  # 'BLOCKED' if any fold BLOCKED;
                                  # 'FAILED_PREFLIGHT' if the orchestrator's
                                  # shared pre-flight (manifest/split/fold load)
                                  # failed before any fold ran.

def run_formal_experiment(
    *, experiment: str, folds: list[int], cfg: ProtocolConfig,
    out_root: Path, seed: int = 42,
    max_epochs: int | None = None, patience: int | None = None,
) -> ExperimentReceipt:
    """Iterate folds in order, call run_formal_fold per fold, accumulate
    receipts. Runs every requested fold REGARDLESS of individual BLOCKED
    status — never short-circuits — because P2-03 needs the per-experiment
    gate to inspect all 5 fold receipts at once and the caller needs a
    complete per_fold list for diagnosis.

    P2-02B: folds=[0] (one receipt, overall_status mirrors it).
    P2-03: folds=[0,1,2,3,4] (five receipts; per-experiment gate is run by
    the caller, not here).
    """
```

P2-02B will call this with `folds=[0]`. P2-03 will reuse verbatim with `folds=list(range(5))`.

### 3.6 `cli_formal.py`

```python
def main(argv: list[str] | None = None) -> int:
    """argparse front end. Returns 0 iff all folds PASS, 1 otherwise (2 if preflight fails).
    Mirrors the flag set in the brainstorming Section 5.2 answer."""
```

CLI flags (locked):
- `--fold` (list[int], default `[0]`)
- `--experiment` (default `'E3'`)
- `--seed` (default `42`)
- `--out-dir` (default `algorithm/artifacts/p2_02b`)
- `--max-epochs` (default = protocol, override allowed)
- `--patience` (default = protocol, override allowed)
- `--protocol` (default `p1/protocol_p2_02a_v1.json`)
- `--manifest` (default `artifacts/p1_v1/patient_manifest_v1.parquet`)
- `--split-assignment` (default `artifacts/p1_v1/split_assignment_v1.csv`)
- `--fold-assignment` (default `artifacts/p1_v1/fold_assignment_v1.csv`)
- `--image-root` (no default; required when running for real — default-of-record is the 2-level nested `datasets/DataSet/Training_Dataset/Training_Dataset`)

---

## 4. Output artifact tree (per fold)

```
<out-dir>/fold_<N>/
├─ protocol.json             # copy of frozen v1 protocol, written at pre-flight
├─ environment.json          # GPU/driver/torch/conda/commit fingerprint
├─ training_log.jsonl        # one JSON object per epoch (see §3.4 step 3 schema)
├─ best_checkpoint.pth       # atomic write (tmp + rename); see §3.3 metadata
├─ best_checkpoint.sha256    # hex SHA256 of best_checkpoint.pth bytes
├─ validation_predictions.csv # patient_id, fold, true_label_0..7, pred_proba_0..7, threshold
├─ oof.csv                   # same as above + epoch, best_metric, experiment, seed
├─ metrics.json              # MetricsDict + skipped_classes + config_hash
└─ fold_receipt.json         # see §5 schema
```

On BLOCKED paths (`NanLossError`, `CudaOomError`, `CudaRuntimeError`, `CheckpointError`), only the following are written:
- `protocol.json` (if pre-flight passed)
- `environment.json` (if pre-flight passed)
- `training_log.jsonl` (epochs completed before the failure)
- `fold_receipt.json` (`status='BLOCKED'`, `error_class`, `error_message`, `error_epoch`, `error_batch`)

**No** `best_checkpoint.pth`, no `metrics.json`, no OOF CSV — failure leaves a clean receipt but no partial model or partial metrics (locked in Section 3 brainstorming: "abort, no partial checkpoint").

---

## 5. `fold_receipt.json` schema

```json
{
  "schema_version": "p2-02b-v1",
  "fold": 0,
  "experiment": "E3",
  "seed": 42,
  "status": "PASS" | "BLOCKED" | "FAILED_PREFLIGHT",
  "best_epoch": 4,
  "best_metric": 0.732,
  "best_metric_name": "validation_macro_auprc",
  "total_epochs_run": 5,
  "early_stopped": false,
  "started_at": "<ISO8601>",
  "finished_at": "<ISO8601>",
  "duration_s": 1234.5,
  "config_hash": "<SHA256 of protocol.json bytes>",
  "checkpoint_sha256": "<SHA256 of best_checkpoint.pth bytes or null if BLOCKED before save>",
  "error_class": null | "nan_loss" | "cuda_oom" | "cuda_runtime" | "checkpoint_io" | "preflight",
  "error_message": null | "<truncated to 1024 chars>",
  "error_epoch": null | 3,
  "error_batch": null | 47,
  "frozen_inputs": {
    "manifest_sha256": "...",
    "split_assignment_sha256": "...",
    "fold_assignment_sha256": "...",
    "image_root_sha256": "..."
  }
}
```

`status='FAILED_PREFLIGHT'` ⇒ `best_epoch=-1`, `best_metric=null`, `checkpoint_sha256=null`, `error_class='preflight'`. `status='BLOCKED'` ⇒ the fields reflect state at failure time (e.g., `best_epoch=2` if 3 epochs trained before OOM). `status='PASS'` ⇒ `error_*` fields are null.

---

## 6. Error handling

### 6.1 Custom exception taxonomy

| Exception | Module | Trigger |
|---|---|---|
| `NanLossError(loss: Tensor, batch_idx: int, epoch: int)` | `engine.py` | `not torch_adapter.isfinite(loss)` after forward |
| `CudaOomError(op: str, batch_idx: int, epoch: int)` | `engine.py` | `torch.cuda.OutOfMemoryError` or `RuntimeError` matching `is_oom_error(exc)` from `p1.benchmark.compute` |
| `CudaRuntimeError(op: str, msg: str, batch_idx: int, epoch: int)` | `engine.py` | any other `RuntimeError` containing 'cuda', 'cublas', 'cudnn' |
| `CheckpointError(op: str, path: Path, exc: Exception)` | `checkpoint.py` | `IOError` / `OSError` during write |
| `PreflightError(reason: str, detail: str)` | `formal_fold_runner.py` | pre-flight validation failure |

### 6.2 Catch boundaries

```
preflight (run_formal_fold step 1)
   └─ try/except (PreflightError, *Exception as exc)
        if exc is PreflightError: status='FAILED_PREFLIGHT', error_class='preflight'
        else: status='FAILED_PREFLIGHT', error_class='preflight', error_message=<str(exc)>

train_one_epoch (engine.py step 6, 8, 9)
   └─ try/except (torch.cuda.OutOfMemoryError → CudaOomError; RuntimeError with 'cuda' → CudaRuntimeError)
   └─ if NaN detected: raise NanLossError before backward

evaluate (engine.py)
   └─ try/except (same as train_one_epoch)

run_formal_fold step 3 epoch loop
   └─ try/except (NanLossError, CudaOomError, CudaRuntimeError, CheckpointError)
        close DataLoader workers (loader iterator break + worker shutdown)
        torch.cuda.empty_cache()
        write BLOCKED fold_receipt.json
        re-raise as a non-zero exit code at CLI level
```

### 6.3 Atomic write contract

All disk writes use `tmp + os.replace`:

```python
def _atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)
```

| File | Reason for atomicity |
|---|---|
| `best_checkpoint.pth` | OOM/掉电不留半截 checkpoint（必须可被 `load_checkpoint` 整块读回） |
| `best_checkpoint.sha256` | 与 checkpoint 字节同步，避免哈希指向旧文件 |
| `metrics.json`, `fold_receipt.json`, `protocol.json`, `environment.json` | JSON 损坏会让 P2-03 gate 误判 |
| `validation_predictions.csv`, `oof.csv` | OOF 完整性是 P2-03 硬 gate（行数 == `|Development| - |Fold0|`） |
| `training_log.jsonl` | 逐行 append（`open('a')`），行小（< 1 KB） |

Tests assert no `.tmp` file remains after successful runs (`test_checkpoint_atomic_write_no_tmp_left`).

---

## 7. Testing strategy

### 7.1 Test layers

```
P2-02B tests (under eye_diagnosis_p1/tests/)
├─ unit (no CUDA, no I/O, < 30s)
│  ├─ test_p2_02b_engine.py             # train_one_epoch, evaluate
│  ├─ test_p2_02b_metrics.py            # MetricsDict + skip-empty-class rule
│  ├─ test_p2_02b_checkpoint.py         # save/load round-trip + SHA256 + atomicity
│  └─ test_p2_02b_formal_fold_runner.py # full fold w/ fake adapters; happy + error paths
├─ integration (fake adapters, cross-module)
│  ├─ test_p2_02b_orchestrator.py       # multi-fold loop (folds=[0,1])
│  └─ test_p2_02b_cli_formal.py         # argparse + entry point
└─ CI smoke (real torch, tiny fixture, no GPU required)
   └─ test_p2_02b_ci_smoke.py           # 4 patients × max_epochs=2 × fold 0
```

### 7.2 Fakes (new directory `eye_diagnosis_p1/tests/fakes/`)

Reused from existing `test_p2_02a_*`:
- `FakeTorchAdapter` (cuda sync, autocast, grad scaler, isfinite)
- `FakeScaler`
- `FakeOptimizer`
- `FakeDataLoader` / `FakeDataLoaderFactory`

New for P2-02B:
- `FakeModelFactory(experiment)` — returns `FakeBilateralModel` with logits derived from `inputs.sum(dim=...)` so metrics are non-trivial (not all zeros).
- `FakeFoldAssignmentLoader` — returns fixed 5-fold split (4/2 train/val for smoke).
- `FakeManifestLoader` — returns 4-patient manifest with deterministic labels.
- `FakeProtocolLoader` — inline JSON of frozen v1 config.
- `FakeEnvironmentCapture` — returns a stable dict.

### 7.3 Key test cases (mapped to design decisions)

| Design decision | Test | Assertion |
|---|---|---|
| Engine = epoch-level | `test_train_one_epoch_returns_epoch_stats_not_per_step` | Returns `EpochStats`, not list of step dicts |
| NaN abort | `test_nan_at_batch_47_aborts_fold` | `inject_nan_at_batch=47` → BLOCKED, `error_class='nan_loss'`, `error_batch=47`, no best_checkpoint.pth |
| OOM abort | `test_oom_at_forward_aborts_fold` | OOM at epoch 3 → BLOCKED, `error_class='cuda_oom'`, `error_epoch=3` |
| Preflight fail | `test_no_cuda_preflight_fails` | status='FAILED_PREFLIGHT', error_class='preflight', no epoch loop entered |
| Checkpoint IO | `test_disk_full_on_checkpoint_blocks_fold` | monkeypatch `Path.write_bytes` to raise `OSError`; assert no `.pth.tmp` left |
| Metrics skip empty | `test_zero_positive_class_is_skipped` | y_true has 0 positives in class 3 → `skipped_classes=[3]`, `per_class_auprc[3]=None`, macro_auprc is mean of others |
| Metrics full set | `test_full_metrics_set_matches_sklearn` | macro_auprc matches `np.mean(sklearn.average_precision_score per class on non-empty)` |
| Threshold | `test_threshold_0_5_sensitivity_specificity` | recall/specificity match manual computation at threshold=0.5 |
| Checkpoint atomic | `test_atomic_write_no_tmp_left_on_success` | after `save_checkpoint`, no `.pth.tmp` exists |
| Checkpoint SHA256 | `test_sha256_matches_checkpoint_bytes` | re-compute hash of saved file == recorded |
| Receipt always | `test_receipt_written_on_every_path` | PASS / BLOCKED / FAILED_PREFLIGHT all leave `fold_receipt.json` |
| Adapter reuse | `test_formal_fold_runner_uses_stability_adapters` | `p1.training.formal_fold_runner` imports `build_real_*` from `p1.stability.cli` (not re-implementing) |
| Config hash | `test_config_hash_changes_when_protocol_byte_changes` | flip a single byte in protocol.json → hash changes; `metadata['config_hash']` updates |
| CLI single fold | `test_cli_formal_invokes_orchestrator_with_fold_0` | mock `run_formal_experiment`; assert called with `folds=[0]` |
| Per-epoch scope | `test_val_stats_has_only_macro_auprc_not_per_class` | `ValStats` fields = `{loss, macro_auprc, num_batches, num_samples, gpu_step_ms, probabilities}` |
| Final scope | `test_metrics_json_has_full_set` | keys include `macro_auprc, micro_auprc, macro_auroc, micro_auroc, macro_f1, micro_f1, per_class_auprc, per_class_auroc, per_class_precision, per_class_recall, per_class_f1, per_class_support_pos, per_class_support_neg, skipped_classes, threshold, num_samples` |
| Early stop | `test_early_stop_triggers_after_patience` | patience=2, val macro_auprc drops for 3 epochs in a row → break at epoch 3 (counter=3==patience) |
| Scheduler | `test_reduce_lr_on_plateau_steps_per_epoch` | `optimizer.param_groups[0]['lr']` halves after patience=2 stagnant epochs |
| Grad clip order | `test_unscale_before_clip` | monkeypatch `GradScaler`; verify `unscale_` called before `clip_grad_norm_` |
| Determinism flags | `test_strict_determinism_flags_set_in_runner` | after `run_formal_fold` start, `cudnn.deterministic==True`, `cudnn.benchmark==False` |
| OOF row count | `test_oof_row_count_equals_validation_size` | len(oof.csv) == `|Fold0|` patients |
| Train/val disjoint | `test_train_val_disjoint_in_oof` | `set(oof.patient_id) ⊆ fold_0_val`; `train_pids ∩ oof_pids == ∅` |
| Orchestrator no short-circuit | `test_orchestrator_continues_after_blocked_fold` | `folds=[0,1,2]` with fold 1 BLOCKED → `len(per_fold)==3`, fold 2 still ran; `overall_status='BLOCKED'` |
| Orchestrator pass-all | `test_orchestrator_overall_status_pass_when_all_pass` | `folds=[0,1]` both PASS → `overall_status='PASS'` |
| CI smoke | `test_p2_02b_ci_smoke` | runs `cli_formal.py --fold 0 --max-epochs 2 --patience 1` on 4-patient fixture; assert exit 0, all 9 artifact files, status='PASS', sha256 valid, takes < 60s |

### 7.4 Coverage targets

- New 6 modules: line coverage ≥ 90%, branch coverage ≥ 85%
- Critical error paths (NaN, OOM, Preflight, Checkpoint IO) must have dedicated tests
- Orchestrator multi-fold + CLI dual-mode (single fold / multi fold) must both be integration-tested

### 7.5 CI smoke specifics

- 4 patients (2 positive + 2 negative), 380×380 random tensors (seeded) — no real JPEG
- `cli_formal.py --fold 0 --max-epochs 2 --patience 1 --out-dir <tmp>`
- Uses a **fake torch adapter** (records calls, no real GPU work) so the smoke runs on any CI host (CPU or GPU). Real torch + small fixture smoke moves to **P2-02C** as the GPU smoke. The fake adapter still exercises the full epoch loop + checkpoint save + JSONL append + receipt write end-to-end.
- Verifies: exit 0, `fold_0/` contains 9 files, `fold_receipt.status='PASS'`, `best_checkpoint.sha256` re-computes to the same value, runtime < 60s.

---

## 8. Out of scope — restated for clarity

These are not part of P2-02B's deliverable. Adding any of them in P2-02B review is a protocol violation that requires explicit user re-approval:

| Banned | Reason / where it lives |
|---|---|
| Real GPU Fold-0 run | P2-02C |
| 4×5 OOF | P2-03 |
| Loss ablation (Weighted BCE, ASL) | P3 |
| Multi-seed (42, 2026, 3407) | P4 |
| Frozen Test set evaluation | P4 |
| Threshold tuning | frozen `threshold_policy: fixed_0.5` |
| Softmax / CrossEntropyLoss | protocol |
| Per-eye metrics | protocol |
| Auto batch-size shrink / backbone downgrade | frozen config |
| Runtime protocol edit / re-split | protocol |
| RETFound / EyeQ / Grad-CAM / AutoMorph / Cross-Attention / Transformer Fusion | P5+ |
| Edits to `p1/training/cli.py`, `fold_runner.py`, `models.py`, `oof.py`, `frozen_inputs.py`, `protocol.py`, `preflight.py`, `datasets.py`, `e2_assignment.py`, `freeze_folds.py`, `__init__.py` | frozen |
| Edits to `p1/stability/probe.py`, `cli.py`, `stages.py`, `schema.py`, `matrix.py`, `protocol.py`, `watchdog.py`, `watchdog_cli.py`, `preflight.py`, `matrix_cli.py`, `matrix_runner.py`, `environment.py`, `t4.py` (beyond additive tests/fakes) | frozen |

---

## 9. Open items for the implementation plan (writing-plans)

These need concrete decisions or pin-downs before `writing-plans` produces the step-by-step plan:

1. **Fake-factory import location.** Reuse existing `p1.stability.cli` real factories directly (single import line per factory) or add a thin `p1.training.adapters` re-export wrapper? Recommendation: direct import; no re-export needed unless cleanliness wins. Documented decision in §2.
2. **Schema version string.** Locked to `"p2-02b-v1"` everywhere (protocol.json copy, fold_receipt.json, training_log.jsonl, checkpoint metadata, metrics.json).
3. **OOF CSV column order.** `patient_id, fold, true_label_0, true_label_1, …, true_label_7, pred_proba_0, …, pred_proba_7, threshold, epoch, best_metric, experiment, seed`. Confirm exact ordering.
4. **`experiment` → `ModelFactory` parameter mapping.** For P2-02B, only `E3` is wired (since P2-02B is single-fold single-experiment). E0/E1/E2 wiring is part of P2-03.
5. **Where does `compute_full_metrics` live for the integration test?** Unit test of `metrics.py` plus a separate test of `formal_fold_runner` that asserts `metrics.json` shape (don't duplicate the metric assertions; just verify the post-loop writes the right file).
6. **`FoldReceipt` dataclass location.** Inside `formal_fold_runner.py` (private to the runner) or top-level in a new `p1/training/receipts.py`? Recommendation: top-level `receipts.py` to be importable by both `formal_fold_runner` and `orchestrator` without circular imports.
7. **CLI smoke fixture location.** Under `eye_diagnosis_p1/tests/fixtures/p2_02b_smoke/` (committed) or generated by a fixture builder? Recommendation: generated by `tests/fixtures/build_smoke_fixture.py` (idempotent, seeded); keeps fixtures out of the committed tree.
8. **GPU strict determinism runtime overhead.** 5–15% per the brainstorming Section 5.2 — accepted. If profiling shows > 20% on the cell-F config, revisit.

---

## 10. Success criteria

P2-02B is "done" when **all** of the following hold simultaneously:

- [ ] All 6 new modules exist under `algorithm/p1/training/` and import cleanly without CUDA.
- [ ] Frozen modules (`p1/training/{cli,fold_runner,models,oof,frozen_inputs,protocol,preflight,datasets,e2_assignment,freeze_folds}.py`, `p1/stability/**`) are byte-identical to commit `554df03` on this branch.
- [ ] `pytest eye_diagnosis_p1/tests/test_p2_02b_*.py` is green; coverage ≥ 90% lines / ≥ 85% branches.
- [ ] CI smoke (`test_p2_02b_ci_smoke`) is green and < 60s wall-clock.
- [ ] `fold_receipt.json` is written on PASS, BLOCKED, and FAILED_PREFLIGHT paths (with the right status / error fields).
- [ ] Checkpoint atomic write is verified by tests; no `.tmp` files survive.
- [ ] `orchestrator.run_formal_experiment` is fully implemented (not stubbed) and tested for `folds=[0]` and `folds=[0,1]`.
- [ ] `cli_formal.py` argument set matches §3.6.
- [ ] `docs/superpowers/specs/2026-07-27-p2-02b-formal-epoch-loop-design.md` (this file) is committed.
- [ ] No frozen code modified; no protocol deviations.

P2-02B does **not** run on the real GPU; the first real GPU run is P2-02C with `cli_formal.py --fold 0 --max-epochs 3 --patience 1`.