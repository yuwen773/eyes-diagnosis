"""One-shot writer that freezes OOF fold membership to disk."""

from __future__ import annotations

import csv
from pathlib import Path

from p1.manifest import ManifestPaths
from p1.split import FoldMap, assign_splits, build_oof_folds


def write_fold_assignment(fold_map: FoldMap, out_path: Path) -> Path:
    """Persist ``FoldMap`` to ``out_path`` as a sorted ``patient_id,fold`` CSV."""
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
    manifest: ManifestPaths,
    *,
    seed: int,
    k: int,
    out_dir: Path,
) -> Path:
    """Build a frozen ``fold_assignment_v1.csv`` from the manifest + seed.

    Writes (and overwrites) ``<out_dir>/fold_assignment_v1.csv``.
    """
    assignment = assign_splits(manifest, seed=seed, test_frac=0.15, out_dir=None)
    folds = build_oof_folds(assignment, manifest, k=k, seed=seed)
    return write_fold_assignment(folds, Path(out_dir) / "fold_assignment_v1.csv")


__all__ = ["freeze_folds_from_manifest", "write_fold_assignment"]
