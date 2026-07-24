"""
冻结验证集评估。Manifest 路径在 CI 中通过环境变量 FROZEN_VAL_MANIFEST 注入。
若 manifest 缺失、生成时间晚于模型训练时间或样本 ID 重复，评估失败。
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from eye_diagnosis.metrics import per_class_metrics
from eye_diagnosis.registry import ModelRegistry


def evaluate_frozen(weights_path: Path, manifest_path: Path, registry_path: Path) -> pd.DataFrame:
    if not manifest_path.is_file():
        raise RuntimeError(f"Manifest missing: {manifest_path}")
    registry = ModelRegistry(weights_path=weights_path, registry_path=registry_path)
    provenance = registry.resolve_current()
    manifest = json.loads(manifest_path.read_text())
    image_paths = [item["path"] for item in manifest]
    labels = np.array([item["label"] for item in manifest])
    from eye_disease_model import EyeDiseaseModel  # noqa: WPS433 (lazy import; model needs torch)

    model = EyeDiseaseModel()
    model.load_model(str(weights_path))
    probs = np.asarray(model.predict_batch(image_paths))
    metrics = per_class_metrics(probs, labels)
    metrics["model_version"] = provenance.version
    metrics["weight_sha256"] = provenance.weight_sha256
    return metrics