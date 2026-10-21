import json
import logging
import os

import torch

from eye_disease_model import EyeDiseaseModel

from mcp_server.config import MCPConfig
from mcp_server.diagnosis import build_diagnosis_result
from mcp_server.image_handler import resolve_image

logger = logging.getLogger(__name__)

_model: EyeDiseaseModel | None = None

_DEFAULT_MODEL_PATHS = [
    "models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth",
    "models/best_acc_eye_disease_model.pth",
    "models/best_eye_disease_model.pth",
]


def load_model(config: MCPConfig) -> None:
    global _model
    _model = None
    resolved_path = _resolve_model_path(config.model_path)
    if resolved_path is None:
        raise RuntimeError("Required model weights not found")
    logger.info(f"Loading model: arch={config.model_arch}, device={config.device}")
    model = EyeDiseaseModel(
        num_classes=config.num_classes,
        model_name=config.model_arch,
        pretrained=False,
    )
    model.device = torch.device(config.device)
    model.model = model.model.to(model.device)
    model.load_model(resolved_path)
    _model = model
    logger.info(f"Model weights loaded from {resolved_path}")


def _resolve_model_path(config_path: str | None) -> str | None:
    paths = [config_path] if config_path else _DEFAULT_MODEL_PATHS
    for path in paths:
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path
    return None


async def diagnose(image_input: str) -> str:
    """Run eye disease diagnosis on an image.

    Args:
        image_input: Image data - a local file path, HTTP/HTTPS URL, or Base64 encoded string.
    """
    if _model is None:
        raise RuntimeError("Model not loaded")

    logger.info(f"Diagnosing image, input length: {len(image_input)}")
    temp_path = None
    try:
        temp_path = await resolve_image(image_input)
        result = _model.predict(temp_path)
        diagnosis = build_diagnosis_result(result)
        return json.dumps(diagnosis, ensure_ascii=False, indent=2)
    except (FileNotFoundError, ValueError) as e:
        raise ValueError(f"图片输入无效: {e}") from e
    except Exception as e:
        raise RuntimeError(f"诊断推理失败: {e}") from e
    finally:
        if temp_path and temp_path != image_input:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
