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