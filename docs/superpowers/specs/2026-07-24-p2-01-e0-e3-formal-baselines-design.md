# P2-01 E0–E3 Bilateral Input Baselines — Design

Date: 2026-07-24
Slice: P2-01 (formal baselines, minimal verifiable skeleton)
Status: Approved (sections approved by user 2026-07-24)

## 1. Purpose and scope

In one sentence, this slice answers:

> Under identical EfficientNet-B4, BCE, data split and training protocol, do bilateral inputs provide more patient-level disease information than monocular weak-label controls?

This slice implements the **minimum verifiable skeleton** for the four experiments
E0 (Left), E1 (Right), E2 (Fixed Random Eye), E3 (Shared Encoder + Late Concat)
plus the patient-level OOF writer, a frozen protocol file, a 6800 MB preflight, and
the deterministic E2 eye assignment. It is **not** the full 5-fold × 4-experiment
training run, the model selection policy, or the paired bootstrap CI — those are
separate slices (P2-02 and beyond).

Hard boundary: do not edit `algorithm/p1/{audit,manifest,split}.py`, do not load
legacy disease weights, do not introduce 6-channel input, do not touch Java
backend / Vue frontend / gRPC / `diagnosis.proto`, do not introduce ASL / RETFound /
Cross-Attention / gated fusion / MIL / monocular auxiliary heads.

## 2. Decisions already frozen (carry over from P1-01c)

| Item | Value | Source |
|------|-------|--------|
| Backbone | EfficientNet-B4 | `p1-compute-evidence` memory |
| ImageNet weights | `IMAGENET1K_V1` (explicit) | frozen protocol, `p1.benchmark.model` |
| Input size | 380 × 380 | B4 native |
| Patient batch | 8 | P1-01c decision |
| Encoder batch | 16 (only for E3 batch-concat) | derived: `2 × patient_batch` |
| Gradient accumulation | 1 | P1-01c decision |
| AMP | enabled | frozen |
| Device | RTX 4060 Laptop 8 GB | P1-01c decision |
| Data split | `split_assignment_v1.csv` (433 Test / 2452 Dev, multilabel-stratified, seed-locked) | `p1.split` |
| OOF folds | 5-fold multilabel-stratified on Dev | `p1.split` |
| Test patients | never readable from training entry point | frozen |
| Seed | 42 | P2-01 slice default |
| E2 seed | 42 | frozen for this slice |
| Preflight free VRAM | 6800 MB | this slice (5708 / 0.85 ≈ 6716 → 6800 to be safe) |
| Preflight behaviour | fail-closed, no auto-degrade | this slice |
| Primary metric | OOF Macro-AUPRC | frozen |
| Optimizer / lr / wd / scheduler / augmentations / early stop / grad clip / threshold policy | **to be locked in this protocol JSON**, no implicit defaults | this slice |

The slice is **not allowed** to silently downshift backbone or patient batch at
runtime. Any downgrade requires a new protocol version (`protocol_e0_e3_vN.json`).

## 3. Architecture

A new `algorithm/p1/training/` package, single responsibility per module. The
existing `algorithm/p1/benchmark/` package is reused (E3 model, preprocess
function, legacy-weight guard) — no copy of its logic.

| File | Responsibility |
|------|---------------|
| `__init__.py` | Re-export factories only. |
| `models.py` | E0/E1/E2 factories (single eye → shared B4 encoder → `Linear(F, 8)`); E3 factory wraps `p1.benchmark.model.BilateralSharedEncoder`. |
| `datasets.py` | `PatientEyeDataset` + `make_eye_dataset(eye, ...)` where `eye ∈ {"left","right","e2"}`. Reuses `p1.benchmark.preprocess.preprocess_image`. |
| `e2_assignment.py` | Deterministic per-patient eye selection via `sha256(patient_id || seed)`, writes `e2_eye_assignment_seed42.csv`. |
| `protocol.py` | `E0E3Protocol` dataclass + `load_protocol` / `dump_protocol`. Refuses any field that conflicts with the frozen values (backbone, patient batch, accumulation). |
| `preflight.py` | `check_required_free_vram_mb(threshold_mb=6800)` via `torch.cuda.mem_get_info`; raises `InsufficientVram` and prints the user-facing nvidia-smi hint. **No auto-degrade.** |
| `fold_runner.py` | `run_fold(experiment, fold_id, protocol, ...)` — AMP autocast, BCEWithLogitsLoss, writes fold receipt + per-fold OOF + checkpoint SHA-256. Honors `--smoke` (1–2 epoch / fold). |
| `oof.py` | `OofWriter` (schema enforcement) + `validate_oof(...)` (2452 patients, 0 Test, no duplicates, no missing). |
| `cli.py` | Argparse: `--experiment {E0,E1,E2,E3}`, `--fold 0..4` or `--all`, `--smoke`, `--protocol`, `--out-dir`, `--eye-data-root`, `--device cuda`. Rejects legacy `.pth`. |

The protocol file is a single JSON committed at `algorithm/p1/protocol_e0_e3_v1.json`,
generated from `E0E3Protocol` defaults on first run and then re-read. The training
code only reads — it does not accept ad-hoc CLI overrides for backbone, patient
batch, or accumulation.

## 4. Data flow (per fold / per experiment)

```
protocol.json                      ─┐
patient_manifest_v1.parquet        ─┤
split_assignment_v1.csv            ─┤   preflight.check_required_free_vram_mb(6800)
E2 assignment CSV (E2 only)        ─┘            ↓ (fail-closed, no degrade)
                                                   ↓
cli.run(experiment) ─→ models.build(experiment) ─→ PatientEyeDataset ─→ FoldRunner
                                                  │                          │
                                                  │                          ├─ AMP autocast
                                                  │                          ├─ BCEWithLogitsLoss
                                                  │                          └─ save logits / checkpoint SHA-256
                                                  ↓
                                          OofWriter.append(fold)
                                                  ↓
                                          oof.validate(...)     [2452 patients, 0 Test, no dupes]
                                                  ↓
artifacts/p2_e0_e3_v1/{E0|E1|E2|E3}/
    ├─ fold_{0..4}_receipt.json
    ├─ fold_{0..4}_oof.csv           (smoke writes only fold 0)
    └─ oof_manifest.json             (counts + schema + SHA-256)
```

`FoldRunner` accepts the dev patient set from `SplitAssignment.dev_patient_ids`
and never receives `test_patient_ids`. Tests monkey-patch the test accessor to
prove no path reads it.

## 5. Model architecture rules (frozen, no deviation without protocol bump)

E0 / E1 / E2:
```
[eye, B, 3, 380, 380] ─→ EfficientNet-B4 encoder (IMAGENET1K_V1) ─→ [B, F] ─→ Linear(F, 8) ─→ [B, 8]
```

E3 (already implemented in `p1.benchmark.model.BilateralSharedEncoder`):
```
left  [B, 3, 380, 380] ─┐
                        ├─ cat(dim=0) ─→ [2B, 3, 380, 380]
right [B, 3, 380, 380] ─┘                          │
                                                   ↓
                                       one shared B4 encoder
                                                   ↓
                                left_feat [B, F] / right_feat [B, F]
                                                   ↓
                                   cat(dim=1) ─→ [B, 2F]
                                                   ↓
                                          Linear(2F, 8) ─→ [B, 8]
```

Still banned: 6-channel input, two unshared encoders, monocular auxiliary heads,
age/sex conditioning, Cross-Attention, gated fusion, RETFound, legacy disease
weights.

## 6. Error handling (fail-closed, no silent degradation)

| Condition | Behaviour |
|-----------|-----------|
| Start-up free VRAM < 6800 MB | `InsufficientVram`; print nvidia-smi hint; exit code 2. No Batch downgrade. |
| `--experiment` unknown | `ValueError` listing registered names. |
| Protocol JSON missing required field | `ProtocolError` listing missing fields; no implicit defaults. |
| Protocol JSON violates frozen value (backbone ≠ B4, batch ≠ 8, accum ≠ 1) | `ProtocolError`. |
| Legacy `best_eye_disease_model.pth` referenced anywhere | `LegacyWeightsRejected` (reused from `p1.benchmark.model`). |
| OOF writer sees a Test patient / duplicate / wrong count | `OofIntegrityError`; write `oof_integrity_error.json`; exit code 3. |
| Training step produces NaN or OOMs | `TrainingError`; write `fold_{id}_error.json` with stack + last checkpoint; exit code 4. No retry. |
| E2 assignment CSV exists but `seed` differs | `E2AssignmentMismatch`; **do not** regenerate — surface the conflict to the user. |

## 7. Testing strategy

All new tests live in `algorithm/eye_diagnosis_p1/tests/test_training_*.py`,
sibling to the existing `test_benchmark_*.py`. CPU-only; no CUDA required.

| Test file | Asserts |
|-----------|---------|
| `test_training_models.py` | E0/E1/E2 each have a shared B4 encoder, single `Linear(F, 8)` head, no fusion module. E3 still uses shared encoder + late concat. All four models report `first_conv_in_channels == 3`. Legacy `.pth` rejected. A 6-channel tensor is rejected by E3. Output shape `(B, 8)`. |
| `test_training_datasets.py` | `make_eye_dataset("left")` reads only `left_image_relpath`; `make_eye_dataset("right")` reads only `right_image_relpath`; `make_eye_dataset("e2")` reads the assignment CSV and selects deterministically. `preprocess_image` output dtype/shape unchanged. Unknown patient → `KeyError`. |
| `test_training_e2_assignment.py` | Same `(patient_id, seed)` is stable across folds, epochs, reruns. A different seed changes ≥ 1 patient. Left/right distribution close to the OD/OS original (±0.5%). CSV round-trips. |
| `test_training_protocol.py` | Missing required field → `ProtocolError`. JSON round-trip. Explicit refusal of `backbone ≠ efficientnet_b4`, `patient_batch ≠ 8`, `gradient_accumulation ≠ 1`. |
| `test_training_preflight.py` | Mocked `torch.cuda.mem_get_info`: < 6800 MB → `InsufficientVram`; ≥ 6800 MB → passes. Asserts no retry / no auto-degrade hook. |
| `test_training_oof.py` | Schema (patient_id, fold, experiment_id, seed, true_n..true_o, prob_n..prob_o, checkpoint_sha256) enforced. Patient count = 2452 unique. Frozen Test patient present → `OofIntegrityError`. Duplicate patient → `OofIntegrityError`. `checkpoint_sha256` is 64-char hex. |
| `test_training_fold_runner.py` | Tiny fake dataset (≤ 8 patients), 1 epoch; asserts AMP autocast used, BCEWithLogitsLoss used, legacy weights rejected, fold receipt + OOF + checkpoint SHA written, and the runner never reads `split.test_patient_ids`. |

Gate (must be green before declaring the slice done):

```
python -m pytest eye_diagnosis_p1/tests/ -q
# existing 39 + 20 + 41 = 100 tests still pass
# new training tests (≈ 35) pass
# without --eye-data-root, integration tests skip (not fail)
```

`pretrained=True` pulls `IMAGENET1K_V1` from torchvision on first GPU use. CPU
unit tests use `pretrained=False` (random init). The weights cache lives under
`torch.hub` defaults, which fall under `/algorithm/models` (already gitignored).

## 8. File-level inventory

```
algorithm/p1/training/
├─ __init__.py
├─ models.py
├─ datasets.py
├─ e2_assignment.py
├─ protocol.py
├─ preflight.py
├─ fold_runner.py
├─ oof.py
└─ cli.py

algorithm/p1/protocol_e0_e3_v1.json   # committed baseline (git-trackable)

algorithm/eye_diagnosis_p1/tests/
├─ test_training_models.py
├─ test_training_datasets.py
├─ test_training_e2_assignment.py
├─ test_training_protocol.py
├─ test_training_preflight.py
├─ test_training_oof.py
└─ test_training_fold_runner.py
```

**Not modified**: `algorithm/p1/{audit,manifest,split}.py`, `algorithm/p1/benchmark/**`,
`algorithm/eye_disease_model.py`, `algorithm/train_model.py`,
`algorithm/evaluate_model.py`, Java backend, Vue frontend, gRPC, `diagnosis.proto`,
`.gitignore` (already covers `*.pth`, `/algorithm/models`, `/algorithm/artifacts/**`).

**git-tracked vs ignored**:

- Tracked: `algorithm/p1/training/**/*.py`, `algorithm/p1/protocol_e0_e3_v1.json`,
  `algorithm/eye_diagnosis_p1/tests/test_training_*.py`.
- Ignored by existing rules: artifacts (raw OOF CSVs, fold receipts, schema
  manifest) under `/algorithm/artifacts/p2_e0_e3_v1/**`, any `.pth`.

## 9. Task decomposition (TDD-ordered, each independently verifiable)

1. **T1** `protocol.py` + `test_training_protocol.py` (no torch).
2. **T2** `preflight.py` + `test_training_preflight.py` (mock CUDA).
3. **T3** `e2_assignment.py` + `test_training_e2_assignment.py` (pure Python).
4. **T4** `models.py` + `test_training_models.py` (CPU random init).
5. **T5** `datasets.py` + `test_training_datasets.py` (synthetic images).
6. **T6** `oof.py` + `test_training_oof.py` (schema + integrity).
7. **T7** `fold_runner.py` + `test_training_fold_runner.py` (fake dataset, 1 epoch).
8. **T8** `cli.py` wiring + extra CLI-parsing tests in
   `test_training_fold_runner.py`.
9. **T9** Emit `algorithm/p1/protocol_e0_e3_v1.json`, commit tracked files,
   print the manual 1-fold smoke command for the user.

## 10. Acceptance checklist (reviewed at slice close)

- [ ] 9 files exist under `algorithm/p1/training/`.
- [ ] 7 `test_training_*.py` files exist under `algorithm/eye_diagnosis_p1/tests/`.
- [ ] `algorithm/p1/protocol_e0_e3_v1.json` is written and committed.
- [ ] `python -m pytest eye_diagnosis_p1/tests/ -q` is green.
- [ ] Legacy `.pth` paths still rejected (regression kept).
- [ ] All four models have `first_conv_in_channels == 3`.
- [ ] E2 assignment CSV round-trips and is 1:1 with the Dev patient set.
- [ ] Any OOF write path raises `OofIntegrityError` when a Test patient is detected.
- [ ] Preflight failure never silently downgrades.
- [ ] Manual 1-fold smoke command is printed; full GPU run is **out of scope for
      this slice** (deferred to P2-02).

## 11. Out of scope (deferred to later slices)

- Real 5-fold × 4-experiment training runs and combined OOF predictions.
- Threshold / model selection policy, OOF-based checkpoint selection.
- Paired bootstrap confidence intervals and the four-experiment comparison report.
- AUC, F1, Sensitivity, Specificity, per-class metrics — reported only in P2-02.
- Any FOV crop, any new augmentation, any new backbone family.

## 12. References

- Frozen protocol: `C:\Users\yuwen\.codex\attachments\58a2bf0d-ca2e-4655-ae2f-86f7c0b00778\pasted-text.txt`
- P1-01c handoff: `C:\Users\yuwen\AppData\Local\Temp\eye-diagnosis-algorithm-p1-handoff-2026-07-24-p1-01c.md`
- Project memory:
  - `p1-protocol-frozen-authority.md`
  - `p1-compute-evidence.md`
  - `p1-shared-encoder-not-6ch.md`
  - `p1-benchmark-env.md`
  - `p1-data-facts.md`
- Existing source:
  - `algorithm/p1/{audit,manifest,split}.py`
  - `algorithm/p1/benchmark/{model,preprocess,decision,...}.py`
- Existing tests: `algorithm/eye_diagnosis_p1/tests/test_benchmark_*.py`
