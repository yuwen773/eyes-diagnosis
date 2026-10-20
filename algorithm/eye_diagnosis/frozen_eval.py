"""
冻结验证集评估。

命令行入口::

    python -m eye_diagnosis.frozen_eval \
        --weights checkpoints/model.pth \
        --manifest datasets/frozen_validation_manifest.json \
        --output artifacts/frozen_metrics.csv

Manifest 路径默认取环境变量 ``FROZEN_VAL_MANIFEST``，其次是
``datasets/frozen_validation_manifest.json``。

产物缺失分两种：

* **权重或 manifest 文件不存在** —— 视为"本环境没有产物"，CLI 打印 ``SKIP``
  并以 0 退出，方便 CI 无条件调用；加 ``--require-artifacts`` 则在缺失时以 2 退出。
* **文件存在但内容非法** —— 视为评估失败，以 1 退出：manifest 格式非法、
  样本 ID 重复、样本不来自冻结的 val 划分或缺少 ``split`` 字段、权重未登记在
  registry 中。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from eye_diagnosis.metrics import per_class_metrics
from eye_diagnosis.registry import ModelRegistry

DEFAULT_WEIGHTS = Path("checkpoints/model.pth")
DEFAULT_REGISTRY = Path("checkpoints/registry.json")
DEFAULT_MANIFEST = Path("datasets/frozen_validation_manifest.json")
FROZEN_SPLIT = "val"

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_MISSING_ARTIFACTS = 2


def load_manifest(manifest_path: Path) -> List[Dict[str, Any]]:
    """读取并校验冻结 manifest。

    校验项：文件存在、顶层是数组、每条含 ``path``/``label``、样本 ID 不重复、
    样本来自冻结的 val 划分。
    """
    if not manifest_path.is_file():
        raise RuntimeError(f"Manifest missing: {manifest_path}")
    payload = json.loads(manifest_path.read_text())
    if not isinstance(payload, list):
        raise RuntimeError(f"Manifest must be a JSON list: {manifest_path}")

    seen: set[str] = set()
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise RuntimeError(f"Manifest entry {index} is not an object: {manifest_path}")
        if "path" not in item or "label" not in item:
            raise RuntimeError(f"Manifest entry {index} misses 'path' or 'label': {manifest_path}")
        sample_id = str(item["path"])
        if sample_id in seen:
            raise RuntimeError(f"Duplicate sample id in manifest: {sample_id}")
        seen.add(sample_id)
        # 缺少 split 不能放过：没有划分信息就无法证明样本来自冻结的 val 集，
        # 静默接受会让混入的 train/test 样本污染评估指标。
        if "split" not in item:
            raise RuntimeError(
                f"Manifest entry {sample_id} misses 'split'; every sample must declare "
                f"split='{FROZEN_SPLIT}'"
            )
        split = item["split"]
        if split != FROZEN_SPLIT:
            raise RuntimeError(
                f"Manifest entry {sample_id} is not from the frozen '{FROZEN_SPLIT}' split: {split}"
            )
    return payload


def evaluate_frozen(
    weights_path: Path,
    manifest_path: Path,
    registry_path: Path,
    *,
    require_manifest_not_newer: bool = False,
) -> pd.DataFrame:
    """在冻结验证集上评估权重，返回逐类别指标。

    :param require_manifest_not_newer: 额外要求 manifest 的修改时间不晚于权重的
        修改时间，即冻结集必须早于模型训练。文件时间戳在 CI 检出后并不可靠，
        因此默认关闭。
    """
    manifest = load_manifest(manifest_path)
    registry = ModelRegistry(weights_path=weights_path, registry_path=registry_path)
    provenance = registry.resolve_current()
    if require_manifest_not_newer and manifest_path.stat().st_mtime > weights_path.stat().st_mtime:
        raise RuntimeError(
            f"Manifest is newer than the model weights: {manifest_path} > {weights_path}"
        )
    image_paths = [item["path"] for item in manifest]
    labels = np.array([item["label"] for item in manifest])
    from eye_disease_model import EyeDiseaseModel, disease_categories  # noqa: WPS433 (lazy import; model needs torch)

    model = EyeDiseaseModel(pretrained=False)
    model.load_model(str(weights_path))
    predictions = [model.predict(path)["all_probabilities"] for path in image_paths]
    probs = np.asarray([
        [prediction[disease_categories[index]] for index in range(len(disease_categories))]
        for prediction in predictions
    ])
    metrics = per_class_metrics(probs, labels)
    metrics["model_version"] = provenance.version
    metrics["weight_sha256"] = provenance.weight_sha256
    return metrics


def write_metrics(metrics: pd.DataFrame, output_path: Path) -> None:
    """写出指标：``.json`` 写成记录数组，其它后缀写成 CSV。"""
    if output_path.parent and not output_path.parent.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix.lower() == ".json":
        output_path.write_text(metrics.to_json(orient="records", indent=2), encoding="utf-8")
    else:
        metrics.to_csv(output_path, index=False)


def format_summary(metrics: pd.DataFrame) -> str:
    """把逐类别指标渲染成可读摘要。"""
    lines = [f"{'label':>6}  {'sensitivity':>12}  {'specificity':>12}  {'f1':>8}  {'auroc':>8}  {'support':>8}"]
    for _, row in metrics.iterrows():
        lines.append(
            f"{int(row['label']):>6}  {row['sensitivity']:>12.4f}  {row['specificity']:>12.4f}  "
            f"{row['f1']:>8.4f}  {row['auroc']:>8.4f}  {int(row['support']):>8}"
        )
    if "model_version" in metrics.columns and not metrics.empty:
        lines.append(f"model_version={metrics['model_version'].iloc[0]}")
    if "weight_sha256" in metrics.columns and not metrics.empty:
        lines.append(f"weight_sha256={metrics['weight_sha256'].iloc[0]}")
    return "\n".join(lines)


def _default_manifest_path() -> Path:
    from_env = os.environ.get("FROZEN_VAL_MANIFEST")
    if from_env:
        return Path(from_env)
    return DEFAULT_MANIFEST


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="eye_diagnosis.frozen_eval",
        description="在冻结验证集上评估模型权重并输出逐类别指标",
    )
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS, help="模型权重路径")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="冻结 manifest 路径（默认取环境变量 FROZEN_VAL_MANIFEST）",
    )
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY, help="模型登记文件路径")
    parser.add_argument("--output", type=Path, default=None, help="指标输出路径（.json 或 CSV）")
    parser.add_argument(
        "--require-artifacts",
        action="store_true",
        help="权重或 manifest 缺失时以非 0 退出（默认是 SKIP 并以 0 退出）",
    )
    parser.add_argument(
        "--require-manifest-not-newer",
        action="store_true",
        help="要求 manifest 的修改时间不晚于权重的修改时间",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    manifest_path = args.manifest or _default_manifest_path()

    missing = [path for path in (args.weights, manifest_path) if not path.is_file()]
    if missing:
        message = "SKIP: 缺少冻结评估产物: " + ", ".join(str(path) for path in missing)
        if args.require_artifacts:
            print(message, file=sys.stderr)
            return EXIT_MISSING_ARTIFACTS
        print(message)
        return EXIT_OK

    try:
        metrics = evaluate_frozen(
            args.weights,
            manifest_path,
            args.registry,
            require_manifest_not_newer=args.require_manifest_not_newer,
        )
    except Exception as exc:  # noqa: BLE001 - CLI 边界：任何失败都要落到非 0 退出码
        print(f"FAIL: 冻结评估失败: {exc}", file=sys.stderr)
        return EXIT_FAILED

    if args.output:
        write_metrics(metrics, args.output)
        print(f"指标已写入 {args.output}")
    print(format_summary(metrics))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
