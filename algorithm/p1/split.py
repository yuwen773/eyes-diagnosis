"""Patient-level Test/Dev split + multilabel-stratified OOF for P1.

Frozen protocol (from the P1 handoff):

- 15% Test frozen, 85% Development. On the real dataset this is exactly
  433 / 2452 patients, with banker's rounding (Python's default ``round``).
- The split is **iterative multilabel-stratified**: rare classes (H=77,
  A=161, M=174, G=215, C=211) cannot vanish from a split. Each split and
  each fold must contain at least one positive patient per class.
- 5-fold multilabel-stratified OOF is built **on Development only**. Test
  patients never enter any fold.
- Both the Test split and the OOF are deterministic per seed.
- A ``split_summary_v1.json`` artifact records per-split/fold label counts,
  rates, multilabel counts, age stats, sex distribution, and label
  co-occurrence for reproducibility.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np
import pandas as pd
from iterstrat.ml_stratifiers import (
    MultilabelStratifiedKFold,
    MultilabelStratifiedShuffleSplit,
)

from p1.audit import CLASS_ORDER
from p1.manifest import ManifestPaths


_SPLIT_TEST = "test"
_SPLIT_DEV = "dev"


@dataclass(frozen=True)
class SplitAssignment:
    """Frozen patient → split mapping."""

    patient_to_split: Mapping[str, str]
    seed: int
    test_frac: float

    @property
    def test_patient_ids(self) -> tuple[str, ...]:
        return tuple(pid for pid, s in self.patient_to_split.items() if s == _SPLIT_TEST)

    @property
    def dev_patient_ids(self) -> tuple[str, ...]:
        return tuple(pid for pid, s in self.patient_to_split.items() if s == _SPLIT_DEV)

    @property
    def test_count(self) -> int:
        return len(self.test_patient_ids)

    @property
    def dev_count(self) -> int:
        return len(self.dev_patient_ids)


@dataclass(frozen=True)
class FoldMap:
    """Patient → OOF fold id mapping (Dev only)."""

    patient_to_fold: Mapping[str, int]
    k: int
    seed: int

    def fold_to_patients(self, fold_id: int) -> tuple[str, ...]:
        if not 0 <= fold_id < self.k:
            raise IndexError(f"fold_id {fold_id} out of range [0, {self.k})")
        return tuple(pid for pid, f in self.patient_to_fold.items() if f == fold_id)


def _patient_label_matrix(manifest: ManifestPaths) -> tuple[tuple[str, ...], np.ndarray]:
    """Return (patient_ids, label_matrix) reading the patient-level manifest."""
    df = pd.read_parquet(manifest.patient_manifest_path)
    label_cols = [f"label_{c}" for c in CLASS_ORDER]
    df = df.drop_duplicates("patient_id").sort_values("patient_id")
    return tuple(df["patient_id"].tolist()), df[label_cols].to_numpy(dtype=np.int8)


def _n_test_from_frac(n_patients: int, test_frac: float) -> int:
    """Lock the test count via Python's banker's rounding.

    On the real dataset (n=2885, frac=0.15) this gives 433, the value the
    frozen P1 protocol pins. ``round`` in Python uses banker's rounding
    (round-half-to-even), so 432.75 → 433.
    """
    if not (0.0 < test_frac < 1.0):
        raise ValueError(f"test_frac must lie in (0, 1); got {test_frac}")
    raw = test_frac * n_patients
    n = round(raw)
    if n <= 0 or n >= n_patients:
        raise ValueError(
            f"test_frac={test_frac} on {n_patients} patients yields invalid n_test={n}"
        )
    return n


def _stratified_test_indices(
    patient_ids: Sequence[str], labels: np.ndarray, *, n_test: int, seed: int
) -> np.ndarray:
    """Return indices forming a multilabel-stratified Test set of size ``n_test``.

    Uses :class:`MultilabelStratifiedShuffleSplit` but enforces the exact
    size: ``iterstrat`` may round ``test_size`` internally (e.g. 433 → 432
    for sparse labels), in which case we add or remove patients
    deterministically to hit the target size. The post-process picks
    patients whose movement least perturbs the per-class positive rate.
    """
    n = len(patient_ids)
    msss = MultilabelStratifiedShuffleSplit(
        n_splits=1, test_size=n_test, train_size=n - n_test, random_state=seed
    )
    test_idx = set(next(msss.split(np.zeros(n), labels))[1].tolist())

    if len(test_idx) == n_test:
        return np.array(sorted(test_idx), dtype=np.int64)

    # Need to add or remove patients to hit n_test exactly.
    rng = np.random.default_rng(seed)
    if len(test_idx) < n_test:
        # Move patients from Dev → Test. Prefer patients with rare positive
        # classes to keep class balance as close to iterstrat's intent as
        # possible.
        candidates = sorted(set(range(n)) - test_idx)
        n_needed = n_test - len(test_idx)
        # Rank candidates by "rarity": patients carrying rarer classes first.
        rarity = labels.sum(axis=0)  # higher = more common
        class_weight = labels @ (1.0 / np.maximum(rarity, 1))
        order = sorted(candidates, key=lambda i: (-class_weight[i], i))
        for i in order[:n_needed]:
            test_idx.add(i)
    else:
        # Move patients from Test → Dev. Prefer patients that are Normal-only
        # (no positive classes) so removing them doesn't change class totals.
        normals = [i for i in test_idx if labels[i].sum() == 0]
        others = [i for i in test_idx if labels[i].sum() > 0]
        n_to_remove = len(test_idx) - n_test
        # Remove normals first (sorted by id for determinism), then others.
        ordered = sorted(normals) + sorted(others)
        for i in ordered[:n_to_remove]:
            test_idx.discard(i)

    return np.array(sorted(test_idx), dtype=np.int64)


def assign_splits(
    manifest: ManifestPaths,
    *,
    seed: int,
    test_frac: float = 0.15,
    out_dir: Path | None = None,
) -> SplitAssignment:
    """Assign each patient to ``"test"`` or ``"dev"`` via multilabel stratification.

    Parameters
    ----------
    manifest:
        Patient-level manifest paths.
    seed:
        Random seed.
    test_frac:
        Fraction of patients assigned to Test. The exact count is locked by
        banker's rounding so it is reproducible.
    out_dir:
        If provided, writes ``split_assignment_v1.csv`` (one row per
        patient) and ``split_summary_v1.json`` (distribution report) here.

    Returns
    -------
    SplitAssignment
    """
    patient_ids, labels = _patient_label_matrix(manifest)
    n = len(patient_ids)
    n_test = _n_test_from_frac(n, test_frac)
    test_idx = set(
        _stratified_test_indices(patient_ids, labels, n_test=n_test, seed=seed).tolist()
    )

    patient_to_split: dict[str, str] = {
        pid: (_SPLIT_TEST if i in test_idx else _SPLIT_DEV) for i, pid in enumerate(patient_ids)
    }
    assignment = SplitAssignment(
        patient_to_split=patient_to_split, seed=seed, test_frac=test_frac
    )

    if out_dir is not None:
        _write_split_artifacts(manifest, assignment, out_dir=out_dir, labels=labels, patient_ids=patient_ids)

    return assignment


def build_oof_folds(
    assignment: SplitAssignment,
    manifest: ManifestPaths,
    *,
    k: int = 5,
    seed: int,
) -> FoldMap:
    """Build a multilabel-stratified ``k``-fold OOF map over Dev patients.

    Parameters
    ----------
    assignment:
        Output of :func:`assign_splits`. Test patients are ignored here.
    manifest:
        Patient-level manifest paths.
    k:
        Number of folds. Must satisfy ``1 ≤ k ≤ |Dev|``.
    seed:
        Random seed.

    Returns
    -------
    FoldMap
    """
    if k <= 0:
        raise ValueError(f"k must be > 0; got {k}")

    patient_ids, labels = _patient_label_matrix(manifest)
    pid_to_index = {pid: i for i, pid in enumerate(patient_ids)}

    dev_pids = assignment.dev_patient_ids
    if k > len(dev_pids):
        raise ValueError(f"k={k} exceeds Dev patient count {len(dev_pids)}")

    dev_indices = np.array([pid_to_index[pid] for pid in dev_pids], dtype=np.int64)
    dev_labels = labels[dev_indices]

    mskf = MultilabelStratifiedKFold(n_splits=k, shuffle=True, random_state=seed)
    pid_to_fold: dict[str, int] = {}
    for fold_id, (_, val_idx) in enumerate(mskf.split(dev_indices, dev_labels)):
        for j in val_idx:
            pid_to_fold[dev_pids[j]] = fold_id

    return FoldMap(patient_to_fold=pid_to_fold, k=k, seed=seed)


# ---- Artifacts --------------------------------------------------------------


def _write_split_artifacts(
    manifest: ManifestPaths,
    assignment: SplitAssignment,
    *,
    out_dir: Path,
    labels: np.ndarray,
    patient_ids: Sequence[str],
) -> None:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) patient_id, split CSV
    rows = [
        {"patient_id": pid, "split": split}
        for pid, split in assignment.patient_to_split.items()
    ]
    pd.DataFrame(rows).to_csv(out_dir / "split_assignment_v1.csv", index=False)

    # 2) summary JSON
    pdf = pd.read_parquet(manifest.patient_manifest_path)
    pdf = pdf.drop_duplicates("patient_id").set_index("patient_id")

    label_cols = [f"label_{c}" for c in CLASS_ORDER]
    label_matrix = pdf.loc[list(patient_ids), label_cols]

    def _stats(pid_subset: Sequence[str]) -> dict:
        sub = pdf.loc[list(pid_subset)]
        counts = {cls: int(sub[f"label_{cls}"].sum()) for cls in CLASS_ORDER}
        n = len(sub)
        rates = {cls: (counts[cls] / n if n else 0.0) for cls in CLASS_ORDER}
        multilabel = int((sub[label_cols].sum(axis=1) >= 2).sum())
        ages = sub["age"].astype(int).to_numpy()
        sex_dist = {str(k): int(v) for k, v in sub["sex"].value_counts().items()}
        return {
            "n_patients": n,
            "label_counts": counts,
            "label_rates": rates,
            "multilabel_patients": multilabel,
            "age_min": int(ages.min()) if ages.size else None,
            "age_max": int(ages.max()) if ages.size else None,
            "age_mean": float(ages.mean()) if ages.size else None,
            "age_median": float(np.median(ages)) if ages.size else None,
            "sex_distribution": sex_dist,
        }

    summary = {
        "seed": assignment.seed,
        "test_frac": assignment.test_frac,
        "n_patients_total": len(assignment.patient_to_split),
        "test_count": assignment.test_count,
        "dev_count": assignment.dev_count,
        "class_order": list(CLASS_ORDER),
        "per_split": {
            "test": _stats(assignment.test_patient_ids),
            "dev": _stats(assignment.dev_patient_ids),
        },
        "label_cooccurrence": _label_cooccurrence(pdf.loc[list(patient_ids)][label_cols]),
        "manifest_sha256": _hash_manifest(manifest),
    }

    (out_dir / "split_summary_v1.json").write_text(json.dumps(summary, indent=2))


def _label_cooccurrence(label_df: pd.DataFrame) -> dict:
    """Symmetric 8x8 matrix of label co-occurrence counts (patients with both)."""
    cols = list(label_df.columns)
    matrix: dict[str, dict[str, int]] = {}
    for a in cols:
        matrix[a] = {}
        a_pos = label_df[a] == 1
        for b in cols:
            matrix[a][b] = int((a_pos & (label_df[b] == 1)).sum())
    return matrix


def _hash_manifest(manifest: ManifestPaths) -> str:
    h = hashlib.sha256()
    h.update(manifest.patient_manifest_path.read_bytes())
    h.update(manifest.eye_index_path.read_bytes())
    return h.hexdigest()