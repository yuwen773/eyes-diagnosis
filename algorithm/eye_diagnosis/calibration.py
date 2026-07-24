from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np


def _softmax(logits: np.ndarray) -> np.ndarray:
    z = logits - logits.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


class TemperatureScaler:
    def __init__(self, init: float = 1.0):
        self.temperature = float(init)

    def fit(self, logits: np.ndarray, labels: np.ndarray) -> float:
        best_t = 1.0
        best_loss = float("inf")
        for t in np.linspace(0.5, 3.0, 26):
            scaled = logits / t
            probs = _softmax(scaled)
            loss = float(-np.log(np.clip(probs[np.arange(len(labels)), labels], 1e-9, 1.0)).mean())
            if loss < best_loss:
                best_loss = loss
                best_t = float(t)
        self.temperature = best_t
        return best_t


def apply_temperature(logits: np.ndarray, temperature: float) -> np.ndarray:
    return np.asarray(logits, dtype=np.float32) / float(temperature)


def expected_calibration_error(probs: np.ndarray, labels: np.ndarray, n_bins: int = 15) -> float:
    confidences = probs.max(axis=1)
    predictions = probs.argmax(axis=1)
    accuracies = (predictions == labels).astype(np.float32)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        lo, hi = bins[i], bins[i + 1]
        mask = (confidences > lo) & (confidences <= hi)
        if mask.any():
            ece += abs(accuracies[mask].mean() - confidences[mask].mean()) * mask.mean()
    return float(ece)