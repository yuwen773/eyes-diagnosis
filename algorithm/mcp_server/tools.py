import json
import logging
import os
import tempfile

# Run this module from the algorithm/ directory, or ensure the package is on PYTHONPATH.
from eye_disease_model import EyeDiseaseModel

from mcp_server.config import MCPConfig
from mcp_server.diagnosis import build_diagnosis_result
from mcp_server.image_handler import resolve_image

logger = logging.getLogger(__name__)

# Global model instance, loaded once at startup
_model: EyeDiseaseModel | None = None


def load_model(config: MCPConfig) -> None:
    global _model
    logger.info(f"Loading model: arch={config.model_arch}, device={config.device}")
    _model = EyeDiseaseModel(
        num_classes=config.num_classes,
        model_name=config.model_arch,
    )
    _model.device = __import__("torch").device(config.device)
    _model.model = _model.model.to(_model.device)

    if config.model_path and os.path.exists(config.model_path):
        _model.load_model(config.model_path)
    else:
        # Auto-search default paths
        search_paths = [
            "models/efficientnet_b4_20250330_211341/best_acc_eye_disease_model.pth",
            "models/best_acc_eye_disease_model.pth",
            "models/best_eye_disease_model.pth",
        ]
        for path in search_paths:
            if os.path.exists(path):
                _model.load_model(path)
                logger.info(f"Model weights loaded from {path}")
                return
        logger.warning("No model weights found, using untrained model")


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
        temp_path = resolve_image(image_input)
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
