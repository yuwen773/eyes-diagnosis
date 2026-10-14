"""MCP image adapter over the same reliability pipeline as the upload worker."""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from mcp_server.config import MCPConfig
from mcp_server.image_handler import resolve_image
from web.config import WebConfig
from web.files import read_image_metadata
from web.mcp_image import unpublished_analysis
from web.workflow.inference import InferenceExecutionError, WorkflowInference

_pipeline: WorkflowInference | None = None


def load_model(config: MCPConfig) -> None:
    global _pipeline
    if config.model_arch != "efficientnet_b4" or config.num_classes != 8:
        raise ValueError("MCP requires the shared efficientnet_b4 / 8-class pipeline")
    settings = WebConfig.from_env()
    if settings.model_weights_path and config.model_path and settings.model_weights_path != config.model_path:
        raise ValueError("MODEL_PATH_CONFLICT")
    if config.model_path:
        settings.model_weights_path = config.model_path
    # Loading is deferred to the shared engine, which refuses missing/invalid weights.
    _pipeline = WorkflowInference(settings)


async def diagnose(image_input: str) -> str:
    """Analyze an image without saving or publishing a clinical prediction."""
    if _pipeline is None:
        raise RuntimeError("MODEL_UNAVAILABLE")
    path = await resolve_image(image_input)
    try:
        image = Path(path).read_bytes()
        if len(image) > 2 * 1024 * 1024:
            raise ValueError("图片超过 2MB 限制")
        _, _, image_format = read_image_metadata(image)
        media_type = "image/" + ("jpeg" if image_format.lower() == "jpg" else image_format.lower())
        envelope = await asyncio.to_thread(_pipeline.run, "mcp-" + uuid4().hex, 1, image, media_type)
        return unpublished_analysis(envelope).model_dump_json()
    except InferenceExecutionError:
        raise RuntimeError("INFERENCE_FAILED") from None
    finally:
        if path != image_input:
            try:
                os.unlink(path)
            except OSError:
                pass
