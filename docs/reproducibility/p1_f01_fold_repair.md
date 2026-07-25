# P1-F01 — Frozen Fold Repair Provenance

**Date:** 2026-07-25
**Branch:** `codex/p2-02a-stability-probe`
**Atomic commits involved:** `da738ef` (OD/OS fix), `9318d26` (validator wiring), `dd66deb` (real CUDA probe). This receipt itself lands as an independent commit.

This document records the P1-F01 frozen-fold integrity repair. A new agent
that clones this repository should be able to verify — **without seeing
any patient data** — that the on-disk fold artifact satisfies the P2-01
frozen-input contract.

---

## TL;DR

| Item | Value |
|------|-------|
| Incident | P1-F01 |
| Canonical artifact path | `algorithm/artifacts/p1_v1/fold_assignment_v1.csv` |
| Invalid SHA-256 (old) | `11e8b8cbc6a24458e4a68550a07ed6e9aa1b63ae0f064782019a5080546b61e6` |
| Replacement SHA-256 (new) | `989d5dc95d8cfd31f715cd25dacd8cfffd2acd34a721eeb038aac04f37aa8a59` |
| Status | invalid → **replaced** (option a) |
| Validator | enforced at probe startup (`frozen_input_validation` stage) |

**The canonical filename is still `fold_assignment_v1.csv`.** Its content
has been replaced by the P1-F01 repair output. The old SHA
`11e8b8cb...` is permanently invalid; any future compute that loads
this artifact MUST observe SHA `989d5dc9...` or the probe refuses to run.

---

## Why a repair was needed

The frozen `fold_assignment_v1.csv` (SHA `11e8b8cb...`) was generated
against a now-stale split snapshot. Even though `split_assignment_v1.csv`
itself was SHA-frozen and correct, the two artifacts had drifted. The
symptoms were silent:

| Field | Value |
|-------|-------|
| Manifest patients | 2885 |
| Development patients | 2452 |
| Test patients | 433 |
| Fold patients | 2452 (size matches Development, but content is wrong) |
| `test_in_fold_count` | **372** |
| `development_missing_from_fold` | **372** |

In other words: 372 Test patients were inside the fold (so the probe
would have trained on Test data), and 372 Development patients were
silently dropped (so the model would have trained on a strict subset of
Development). Either alone is a P0 integrity bug.

The probe's `frozen_input_validation` stage catches this on startup: it
calls `validate_frozen_training_inputs` from `algorithm/p1/training/
frozen_inputs.py`, which raises `FrozenInputError` and short-circuits the
probe before any CUDA is loaded and before any JPEG is read.

---

## How the repair was produced

1. The corrected patient manifest was regenerated locally after the
   OD/OS mapping fix (commit `da738ef`). Manifest SHA:
   `aab4831ca7d293a109520a2b6dab56483376559f000490ed12e61b82320ac90d`.
2. The frozen split (SHA `8effe740...`) was **not** modified.
3. `build_oof_folds(manifest, split, k=5, seed=42)` was called against
   the corrected manifest + frozen split. The resulting fold
   assignment was written to `fold_assignment_v2.csv`.
4. The candidate artifact passed all 7 integrity gates:

   | Gate | Result |
   |------|--------|
   | unique patients = 2452 | ✓ |
   | fold set == dev set | ✓ |
   | fold ∩ test = ∅ | ✓ |
   | fold IDs ⊂ {0..4} | ✓ |
   | 5 folds all non-empty | ✓ (488, 489, 490, 492, 493 — or 490, 489, 488, 492, 493 in sorted-by-ID order) |
   | duplicate patient | ✓ (0) |
   | per-fold per-class ≥ 1 positive | ✓ (min = 13, class H) |

5. Two independent runs produced byte-identical CSVs (determinism
   proof). The SHA is `989d5dc95d8cfd31...`.

6. The user (2026-07-25) selected **option (a)**: copy the v2 fold over
   the v1 path, write a `_SUPERSEDED.md` marker, leave the CLI
   invocation unchanged. This is the lightest-touch promotion and
   forces every consumer (real and future) to point at the correct
   file.

---

## What changed on disk vs. what is committed

The on-patch machine has receipts and copies under
`algorithm/artifacts/**`, but that directory is gitignored (per
`.gitignore` rule `/algorithm/artifacts/**`). Anything there cannot
be cloned; it lives only on the host that ran the repair.

**What IS committed:**

* `docs/reproducibility/p1_f01_fold_repair_receipt.json` — this
  receipt. SHA-256 + counts only; no patient IDs.
* `docs/reproducibility/p1_f01_fold_repair.md` — this document.
* `algorithm/p1/manifest.py:93-94` — OD/OS mapping fix (commit
  `da738ef`).
* `algorithm/p1/stability/probe.py` + `cli.py` — validator wiring
  (commit `9318d26`) + real-CUDA bridge (commit `dd66deb`).
* `algorithm/eye_diagnosis_p1/tests/test_p2_02a_stability_cli.py` —
  12 bridge tests with red-green coverage for every bug the staged
  probe caught.

**What is NOT committed (gitignored by design):**

* `algorithm/artifacts/p1_integrity_incident_20260725/**` — incident
  copies of the invalid artifact + the per-fold per-class receipt.
* `algorithm/artifacts/p1_v2_candidate/**` — the v2 candidate + two
  determinism-proof re-runs.
* `algorithm/artifacts/p1_v1/_SUPERSEDED.md` — written next to the
  canonical artifact to explain the SHA change locally; not in VCS.
* `algorithm/artifacts/p2_02a_stability_v1/{A,B}.json` — real-CUDA
  probe receipts.
* `algorithm/datasets/DataSet/**` — raw JPEGs.
* `algorithm/.omc/**` — OMC runtime state.
* `algorithm/_fix_decision2.py` — decision scratchpad.

---

## How to verify on a fresh clone

1. SHA the canonical fold:

   ```bash
   python -c "import hashlib; from pathlib import Path; \
   print(hashlib.sha256(Path('algorithm/artifacts/p1_v1/fold_assignment_v1.csv').read_bytes()).hexdigest())"
   ```

   Expected output: `989d5dc95d8cfd31f715cd25dacd8cfffd2acd34a721eeb038aac04f37aa8a59`

2. Compare against this receipt. If the SHAs match, the repair is
   in place.

3. Run the CPU test suite (no GPU required):

   ```bash
   cd algorithm
   pytest eye_diagnosis_p1/tests/test_p2_02a_stability_*.py \
          eye_diagnosis_p1/tests/test_manifest.py \
          eye_diagnosis_p1/tests/test_training_freeze_folds.py \
          eye_diagnosis_p1/tests/test_training_datasets.py -q
   ```

   Expected: **99/99 pass** in under 30 s.

4. Read the incident evidence locally (only on a host that has the
   gitignored artifacts):

   ```
   algorithm/artifacts/p1_integrity_incident_20260725/incident_receipt.json
   algorithm/artifacts/p1_v2_candidate/fold_v2_integrity_receipt.json
   ```

   If those paths are missing, the host was cloned fresh and never ran
   the repair. That is fine — the canonical fold is what counts.

---

## Regeneration snippet

If for any reason the canonical fold must be regenerated on a fresh
host that has the corrected manifest + frozen split:

```python
import sys; sys.path.insert(0, '.')
import pandas as pd
from pathlib import Path
from p1.manifest import ManifestPaths
from p1.split import SplitAssignment, build_oof_folds
from p1.training.freeze_folds import write_fold_assignment
from p1.training.frozen_inputs import (
    load_split_assignment, load_fold_assignment,
    validate_frozen_training_inputs,
)

v1 = Path('artifacts/p1_v1')
manifest = ManifestPaths(
    patient_manifest_path=v1 / 'patient_manifest_v1.parquet',
    eye_index_path=v1 / 'eye_index_v1.parquet',
)
split = load_split_assignment(v1 / 'split_assignment_v1.csv')
assignment = SplitAssignment(patient_to_split=split, seed=42, test_frac=0.15)
folds = build_oof_folds(assignment, manifest, k=5, seed=42)

# Write to the canonical path (option a). Caller decides whether
# to backup or replace.
out_path = v1 / 'fold_assignment_v1.csv'
write_fold_assignment(folds, out_path)

# Verify all 7 gates pass.
fold = load_fold_assignment(out_path, expected_folds=5)
m = pd.read_parquet(v1 / 'patient_manifest_v1.parquet')
validate_frozen_training_inputs(
    set(m['patient_id']), split, fold, expected_folds=5,
)
```

The resulting file must be byte-identical to
`989d5dc95d8cfd31f715cd25dacd8cfffd2acd34a721eeb038aac04f37aa8a59`.

If the SHA differs, something has changed upstream (manifest, split,
or `build_oof_folds` itself). Treat that as a new incident and freeze
nothing until it is investigated.

---

## What is **not** in scope for this repair

* No patient IDs are exposed in any committed artifact.
* No new training or evaluation was run as part of the repair.
* The T2 watchdog, T3 6-cell matrix (C–F), T4 100-batch stability,
  and T5 final report are out of scope for this slice. The P2-02A
  overall milestone is still in progress.
* P2-02B (formal epoch runner), P2-02C (fold-0 acceptance), P2-03
  (4×5 OOF), and beyond remain blocked on T1.2 → T2 → T3 → T4 → T5.
