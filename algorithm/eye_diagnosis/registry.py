from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class ModelProvenance:
    version: str
    weight_sha256: str
    training_data_version: Optional[str]
    preprocess_version: Optional[str]


class ModelRegistry:
    def __init__(self, weights_path: Path, registry_path: Path):
        self.weights_path = Path(weights_path)
        self.registry_path = Path(registry_path)

    def resolve_current(self) -> ModelProvenance:
        if not self.weights_path.is_file() or self.weights_path.stat().st_size == 0:
            raise RuntimeError(f"Model weights missing: {self.weights_path}")
        digest = hashlib.sha256(self.weights_path.read_bytes()).hexdigest()
        payload = json.loads(self.registry_path.read_text()) if self.registry_path.is_file() else {}
        allowed = set(payload.get("allow_sha256", []))
        if digest not in allowed:
            raise RuntimeError(
                f"Model weights SHA-256 {digest} not in registry {self.registry_path}"
            )
        return ModelProvenance(
            version=payload.get("model_version", "unknown"),
            weight_sha256=digest,
            training_data_version=payload.get("training_data_version"),
            preprocess_version=payload.get("preprocess_version"),
        )