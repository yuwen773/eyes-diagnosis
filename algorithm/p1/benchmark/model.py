"""E3 bilateral shared-encoder model for the P1-01c benchmark.

Architecture (frozen protocol — memory ``p1-shared-encoder-not-6ch``)::

    left  [B,3,H,W] ─┐
                     ├─ cat(dim=0) → [2B,3,H,W]
    right [B,3,H,W] ─┘
                       │
                 shared EfficientNet encoder (in_channels=3)
                       │
                 features [2B,F]
                       │
                 chunk(2, dim=0) → left_feat [B,F], right_feat [B,F]
                       │
                 cat(dim=1) → fused [B,2F]
                       │
                 Linear(2F → 8) → logits [B,8]

The encoder is applied ONCE to both eyes stacked on the batch axis, so it
sees genuine 3-channel fundus images (never a 6-channel pixel stack). Late
concatenation of the two eyes' feature vectors preserves laterality.

Weights: explicit ``IMAGENET1K_V1`` enums only. ``"DEFAULT"`` and any legacy
disease checkpoint are prohibited by the frozen protocol.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import torch
from torch import nn
from torchvision.models import (
    EfficientNet_B2_Weights,
    EfficientNet_B3_Weights,
    EfficientNet_B4_Weights,
    efficientnet_b2,
    efficientnet_b3,
    efficientnet_b4,
)


class LegacyWeightsRejected(RuntimeError):
    """Raised when a legacy Eye-Diagnosis disease checkpoint is referenced."""


# Legacy checkpoints that must never be loaded (frozen protocol hard boundary).
_LEGACY_WEIGHT_NAMES = (
    "best_eye_disease_model.pth",
    "best_acc_eye_disease_model.pth",
)
_LEGACY_RE = re.compile(r"best(_acc)?_eye_disease_model\.pth$", re.IGNORECASE)


def assert_not_legacy_weights(path: Optional[str]) -> None:
    """Fail closed if ``path`` points at a legacy disease checkpoint.

    ``None`` (random init) and any non-legacy path pass silently.
    """
    if path is None:
        return
    normalized = str(path).replace("\\", "/").rsplit("/", 1)[-1]
    if _LEGACY_RE.search(normalized) or normalized in _LEGACY_WEIGHT_NAMES:
        raise LegacyWeightsRejected(
            f"legacy disease checkpoint is prohibited by the P1 protocol: {path!r}"
        )


@dataclass(frozen=True)
class BackboneSpec:
    """Pins the builder, explicit ImageNet weights, and native input size."""

    name: str
    builder: object
    weights: object
    input_size: int
    feature_dim: int


BACKBONE_SPECS: dict[str, BackboneSpec] = {
    "efficientnet_b2": BackboneSpec(
        name="efficientnet_b2",
        builder=efficientnet_b2,
        weights=EfficientNet_B2_Weights.IMAGENET1K_V1,
        input_size=288,
        feature_dim=1408,
    ),
    "efficientnet_b3": BackboneSpec(
        name="efficientnet_b3",
        builder=efficientnet_b3,
        weights=EfficientNet_B3_Weights.IMAGENET1K_V1,
        input_size=300,
        feature_dim=1536,
    ),
    "efficientnet_b4": BackboneSpec(
        name="efficientnet_b4",
        builder=efficientnet_b4,
        weights=EfficientNet_B4_Weights.IMAGENET1K_V1,
        input_size=380,
        feature_dim=1792,
    ),
}


class BilateralSharedEncoder(nn.Module):
    """Shared EfficientNet encoder with late feature concatenation.

    Parameters
    ----------
    spec:
        The backbone specification (builder + weights + sizes).
    num_classes:
        Number of output logits (8 for the P1 label set).
    pretrained:
        If ``True``, load the explicit ``IMAGENET1K_V1`` weights; otherwise
        random init (used by CPU unit tests to avoid a download).
    """

    def __init__(self, spec: BackboneSpec, *, num_classes: int = 8, pretrained: bool = True):
        super().__init__()
        weights = spec.weights if pretrained else None
        net = spec.builder(weights=weights)
        # ``features`` is the conv stack; ``avgpool`` collapses spatial dims.
        self.encoder = net.features
        self.pool = net.avgpool
        self.classifier = nn.Linear(spec.feature_dim * 2, num_classes)
        self._feature_dim = spec.feature_dim

    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        if right is None:
            raise TypeError(
                "BilateralSharedEncoder expects two 3-channel tensors "
                "(left, right); a single 6-channel tensor is not accepted."
            )
        patient_batch = left.shape[0]
        stacked = torch.cat([left, right], dim=0)          # [2B,3,H,W]
        feats = self.encoder(stacked)                      # [2B,F,h,w]
        feats = self.pool(feats)                           # [2B,F,1,1]
        feats = torch.flatten(feats, 1)                    # [2B,F]
        left_feat, right_feat = feats[:patient_batch], feats[patient_batch:]
        fused = torch.cat([left_feat, right_feat], dim=1)  # [B,2F]
        return self.classifier(fused)                      # [B,8]


def build_bilateral_model(
    backbone: str,
    *,
    num_classes: int = 8,
    pretrained: bool = True,
    legacy_weights_path: Optional[str] = None,
) -> BilateralSharedEncoder:
    """Construct the E3 shared-encoder model for ``backbone``.

    Raises
    ------
    KeyError
        If ``backbone`` is not one of the pinned specs.
    LegacyWeightsRejected
        If ``legacy_weights_path`` names a legacy disease checkpoint.
    """
    assert_not_legacy_weights(legacy_weights_path)
    if backbone not in BACKBONE_SPECS:
        raise KeyError(f"unknown backbone {backbone!r}; expected one of {list(BACKBONE_SPECS)}")
    spec = BACKBONE_SPECS[backbone]
    return BilateralSharedEncoder(spec, num_classes=num_classes, pretrained=pretrained)


def first_conv_in_channels(model: BilateralSharedEncoder) -> int:
    """Return the ``in_channels`` of the encoder's first Conv2d.

    Used by tests to assert the encoder ingests 3-channel images (one eye at
    a time), never a 6-channel pixel stack.
    """
    for module in model.encoder.modules():
        if isinstance(module, nn.Conv2d):
            return module.in_channels
    raise RuntimeError("no Conv2d found in encoder")
