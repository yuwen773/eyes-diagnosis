"""Synthetic test fixtures for the P2-01R training CLI e2e.

Committed fixtures live next to this file under ``fixtures/``. They
contain a 10-patient manifest (8 dev / 2 test), a frozen
``split_assignment_v1.csv``, a frozen ``fold_assignment_v1.csv``, and
20 solid-color 32x32 JPEGs (one per eye per patient).

Run this script to (re)generate every committed fixture file. CI never
runs it — committed files are authoritative. Real patient data must
NOT be added to fixtures; ``artifacts/p1_v1/`` is where real products
go and that tree is gitignored.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from iterstrat.ml_stratifiers import MultilabelStratifiedKFold

THIS_DIR = Path(__file__).resolve().parent
FIXTURE_DIR = THIS_DIR
IMAGE_DIR = FIXTURE_DIR / "images"


def _label_vector(class_index: int) -> list[int]:
    """One-hot multi-label vector (8 classes)."""
    vec = [0] * 8
    vec[class_index] = 1
    return vec


def write_images(pids: list[str]) -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for i, pid in enumerate(pids):
        for side, suffix in [("left", "left"), ("right", "right")]:
            color = (
                (10 + i * 20) % 256,
                (40 + i * 10) % 256,
                (90 + i * 30) % 256,
            )
            Image.new("RGB", (32, 32), color).save(IMAGE_DIR / f"{pid}_{suffix}.jpg")


def write_manifest(pids: list[str]) -> Path:
    rows = []
    for i, pid in enumerate(pids):
        rows.append(
            {
                "patient_id": pid,
                "left_image_relpath": str(Path("images") / f"{pid}_left.jpg"),
                "right_image_relpath": str(Path("images") / f"{pid}_right.jpg"),
                "age": 40 + (i * 3) % 30,
                "sex": "M" if i % 2 == 0 else "F",
                **{f"label_{c}": v for c, v in zip("NDGCAHMO", _label_vector(i % 8))},
            }
        )
    df = pd.DataFrame(rows)
    out = FIXTURE_DIR / "patient_manifest_v1.parquet"
    df.to_parquet(out, index=False)
    return out


def write_split(pids: list[str], test_pids: list[str]) -> Path:
    out = FIXTURE_DIR / "split_assignment_v1.csv"
    rows = [
        {"patient_id": pid, "split": ("test" if pid in test_pids else "dev")}
        for pid in pids
    ]
    pd.DataFrame(rows).to_csv(out, index=False)
    return out


def write_folds(pids: list[str], dev_pids: list[str], *, k: int = 5) -> Path:
    """Deterministic ``k``-fold over dev patients via
    MultilabelStratifiedKFold with ``seed=42`` so the committed file
    matches what the tests expect.

    ``k`` defaults to 5 to match ``protocol_e0_e3_v1.json``'s
    ``k_folds=5``. The frozen protocol's ``k_folds`` is the only
    valid setting; reducing it would silently allow fewer folds than
    the protocol claims.
    """
    label_cols = [f"label_{c}" for c in "NDGCAHMO"]
    pdf = pd.read_parquet(FIXTURE_DIR / "patient_manifest_v1.parquet")
    pdf = pdf.set_index("patient_id").loc[dev_pids]
    labels = pdf[label_cols].to_numpy(dtype=np.int8)

    mskf = MultilabelStratifiedKFold(n_splits=k, shuffle=True, random_state=42)
    pid_to_fold: dict[str, int] = {}
    for fold_id, (_, val_idx) in enumerate(mskf.split(dev_pids, labels)):
        for j in val_idx:
            pid_to_fold[dev_pids[j]] = fold_id
    # Write sorted.
    rows = sorted(pid_to_fold.items())
    out = FIXTURE_DIR / "fold_assignment_v1.csv"
    with out.open("w", newline="") as f:
        f.write("patient_id,fold\n")
        for pid, fold in rows:
            f.write(f"{pid},{fold}\n")
    return out


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        # Sanity: only verify committed artifacts exist.
        for p in [
            FIXTURE_DIR / "patient_manifest_v1.parquet",
            FIXTURE_DIR / "split_assignment_v1.csv",
            FIXTURE_DIR / "fold_assignment_v1.csv",
            IMAGE_DIR,
        ]:
            assert p.exists(), f"missing fixture: {p}"
        return 0

    pids = [f"p{i:03d}" for i in range(10)]
    write_images(pids)
    write_manifest(pids)
    test_pids = pids[:2]  # p000, p001 are Test; rest are Dev.
    dev_pids = pids[2:]
    write_split(pids, test_pids)
    write_folds(pids, dev_pids)
    print(f"fixtures written to {FIXTURE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
