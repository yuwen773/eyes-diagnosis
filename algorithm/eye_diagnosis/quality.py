from __future__ import annotations

import io
from dataclasses import dataclass
from enum import Enum
from typing import List

import numpy as np
from PIL import Image


class QualityVerdict(str, Enum):
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class QualityReport:
    score: int
    blur: float
    brightness: float
    contrast: float
    fundus_coverage: float
    lateral_sign: str
    reasons: List[str]

    @property
    def verdict(self) -> QualityVerdict:
        return QualityVerdict.REJECTED if self.reasons else QualityVerdict.ACCEPTED


def _laplacian_variance(gray: np.ndarray) -> float:
    k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    return float(np.var(
        gray.astype(np.float32)
        * np.fft.ifft2(np.fft.fft2(gray, s=gray.shape) * np.fft.fft2(k, s=gray.shape)).real
    ) / 1.0)


def evaluate_quality(image_bytes: bytes) -> QualityReport:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    gray_l = np.asarray(image.convert("L").resize((380, 380)))

    brightness = float(gray_l.mean()) / 255.0
    contrast = float(gray_l.std()) / 128.0
    blur = _laplacian_variance(gray_l)
    h, w = gray_l.shape
    central = gray_l[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
    coverage = float(gray_l.mean()) / max(float(central.mean()), 1.0)

    reasons: List[str] = []
    if blur < 12.0:
        reasons.append("blur")
    if brightness < 0.15 or brightness > 0.92:
        reasons.append("brightness")
    if contrast < 0.08:
        reasons.append("contrast")
    if coverage < 1.05:
        reasons.append("fundus_coverage")
    lateral_sign = "unknown"

    score = int(round(100 - 25 * len(reasons)))
    return QualityReport(
        score=max(score, 0),
        blur=blur,
        brightness=brightness,
        contrast=contrast,
        fundus_coverage=coverage,
        lateral_sign=lateral_sign,
        reasons=reasons,
    )
