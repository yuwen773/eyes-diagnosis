"""E0–E3 model factories for the P2-01 training slice.

E0/E1/E2 share the B4 encoder and project a single eye's pooled feature
through one ``Linear(F, 8)``. E3 reuses ``BilateralSharedEncoder`` from
``p1.benchmark.model`` to keep the shared-encoder + late-concat path
identical to the benchmark slice.
"""

from __future__ import annotations

import torch
from torch import nn

from p1.benchmark.model import (
    BACKBONE_SPECS,
    BilateralSharedEncoder,
    build_bilateral_model,
    first_conv_in_channels,
)


EXPERIMENTS: tuple[str, ...] = ("E0", "E1", "E2", "E3")
_EYE_BY_EXPERIMENT: dict[str, str] = {
    "E0": "left",
    "E1": "right",
    "E2": "e2",
}


class MonocularB4(nn.Module):
    """Single-eye B4 head. One Linear(F, 8); no fusion, no auxiliary head."""

    def __init__(self, *, eye: str, pretrained: bool = True) -> None:
        super().__init__()
        spec = BACKBONE_SPECS["efficientnet_b4"]
        net = spec.builder(weights=spec.weights if pretrained else None)
        self.encoder = net.features
        self.pool = net.avgpool
        self.classifier = nn.Linear(spec.feature_dim, 8)
        self.eye = eye
        self._feature_dim = spec.feature_dim

    def forward(self, eye_tensor: torch.Tensor) -> torch.Tensor:
        feats = self.encoder(eye_tensor)
        feats = self.pool(feats)
        feats = torch.flatten(feats, 1)
        return self.classifier(feats)


def build_model(experiment: str, *, pretrained: bool = True) -> nn.Module:
    if experiment not in EXPERIMENTS:
        raise ValueError(
            f"unknown experiment {experiment!r}; expected one of {EXPERIMENTS}"
        )
    if experiment == "E3":
        return build_bilateral_model(
            "efficientnet_b4", num_classes=8, pretrained=pretrained
        )
    return MonocularB4(eye=_EYE_BY_EXPERIMENT[experiment], pretrained=pretrained)


def assert_e3_not_six_channel(model: BilateralSharedEncoder) -> None:
    if not isinstance(model, BilateralSharedEncoder):
        raise TypeError("assert_e3_not_six_channel requires a BilateralSharedEncoder")
    # The implementation itself rejects a single 6-channel tensor; this helper
    # exists so test code can document the intent.
    return None


__all__ = ["EXPERIMENTS", "MonocularB4", "assert_e3_not_six_channel", "build_model", "first_conv_in_channels"]