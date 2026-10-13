"""Versioned, registered minimal graph. No diagnostic capability is simulated."""

import hashlib
import io
import json
import warnings
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from PIL import Image, UnidentifiedImageError

GRAPH_VERSION = "upload-minimal-v1"
ACTION_VERSION = "upload-v1"


class UploadState(TypedDict):
    workflow_id: str
    status: str
    reason: str | None
    completed: list[str]


def build_graph(checkpointer, image_bytes: bytes = b""):
    def validate_image(state: UploadState) -> dict:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(image_bytes)) as image:
                    if image.format not in {"JPEG", "PNG", "WEBP"}:
                        raise ValueError("unsupported image format")
                    image.verify()
                with Image.open(io.BytesIO(image_bytes)) as image:
                    image.load()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
                Image.DecompressionBombWarning):
            return {"status": "REJECTED", "reason": "INVALID_IMAGE",
                    "completed": ["validateImage"]}
        return {"status": "RUNNING", "reason": None, "completed": ["validateImage"]}

    def diagnosis_unavailable(state: UploadState) -> dict:
        return {"status": "FAILED", "reason": "DIAGNOSIS_NOT_AVAILABLE",
                "completed": [*state["completed"], "diagnosisUnavailable"]}

    graph = StateGraph(UploadState)
    graph.add_node("validateImage", validate_image)
    graph.add_node("diagnosisUnavailable", diagnosis_unavailable)
    graph.add_edge(START, "validateImage")
    graph.add_conditional_edges("validateImage", lambda state: state["status"] == "REJECTED",
                                {True: END, False: "diagnosisUnavailable"})
    graph.add_edge("diagnosisUnavailable", END)
    return graph.compile(checkpointer=checkpointer,
                         interrupt_after=["validateImage", "diagnosisUnavailable"])


# Node semantics are versioned by ACTION_VERSION; topology is hashed as well.
GRAPH_HASH = hashlib.sha256(json.dumps({
    "graph": build_graph(None).get_graph().to_json(), "actions": ACTION_VERSION,
}, sort_keys=True).encode()).hexdigest()
