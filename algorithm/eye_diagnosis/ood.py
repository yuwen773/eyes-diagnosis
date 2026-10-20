from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass(frozen=True)
class OodDecision:
    is_ood: bool
    score: float
    threshold: float


class OODDetector:
    def __init__(self, class_means: np.ndarray, covariance_inverse: np.ndarray, threshold: float):
        if class_means.ndim != 2:
            raise ValueError("class_means must be 2-D")
        if covariance_inverse.shape[0] != covariance_inverse.shape[1]:
            raise ValueError("covariance_inverse must be square")
        if class_means.shape[1] != covariance_inverse.shape[0]:
            raise ValueError("class_means feature dim must match covariance")
        self.class_means = class_means.astype(np.float32)
        self.covariance_inverse = covariance_inverse.astype(np.float32)
        self.threshold = float(threshold)

    def evaluate(self, feature: np.ndarray) -> OodDecision:
        feature = np.asarray(feature, dtype=np.float32).reshape(-1)
        diffs = self.class_means - feature
        m = np.einsum("fi,ij,fj->f", diffs, self.covariance_inverse, diffs)
        score = float(np.min(m))
        return OodDecision(is_ood=score > self.threshold, score=score, threshold=self.threshold)
