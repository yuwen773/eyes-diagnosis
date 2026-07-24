"""Tests for the E3 bilateral shared-encoder benchmark model.

Seams under test (public interface only):

- ``build_bilateral_model`` returns a module that accepts two 3-channel
  tensors ``(left, right)`` and returns ``[patient_batch, 8]`` logits.
- The shared encoder's first convolution has ``in_channels == 3`` — the
  two eyes are NEVER stacked into a 6-channel input (frozen protocol,
  memory ``p1-shared-encoder-not-6ch``).
- Backbone specs pin the *explicit* ``IMAGENET1K_V1`` weight enum and the
  native input resolution (B2=288, B3=300, B4=380). ``"DEFAULT"`` is never
  used.
- Legacy disease-model checkpoint paths are rejected fail-closed.

These tests run on CPU with randomly-initialised weights (``pretrained=
False``) so no ImageNet download is needed; the architecture is identical.
"""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from p1.benchmark.model import (  # noqa: E402
    BACKBONE_SPECS,
    LegacyWeightsRejected,
    assert_not_legacy_weights,
    build_bilateral_model,
    first_conv_in_channels,
)


@pytest.mark.parametrize("backbone", ["efficientnet_b2", "efficientnet_b3", "efficientnet_b4"])
def test_output_shape_is_patient_batch_by_eight(backbone: str) -> None:
    model = build_bilateral_model(backbone, num_classes=8, pretrained=False)
    model.eval()
    size = BACKBONE_SPECS[backbone].input_size
    patient_batch = 2
    left = torch.randn(patient_batch, 3, size, size)
    right = torch.randn(patient_batch, 3, size, size)
    with torch.no_grad():
        logits = model(left, right)
    assert logits.shape == (patient_batch, 8)


def test_model_takes_two_three_channel_tensors_not_six_channel() -> None:
    model = build_bilateral_model("efficientnet_b2", pretrained=False)
    size = BACKBONE_SPECS["efficientnet_b2"].input_size
    # A 6-channel single tensor must be rejected — the interface is two eyes.
    six = torch.randn(2, 6, size, size)
    with pytest.raises(TypeError):
        model(six)  # type: ignore[call-arg]


def test_first_conv_in_channels_is_three_for_all_backbones() -> None:
    for backbone in BACKBONE_SPECS:
        model = build_bilateral_model(backbone, pretrained=False)
        assert first_conv_in_channels(model) == 3, backbone


def test_backbone_specs_pin_explicit_imagenet_v1_weights_and_native_size() -> None:
    from torchvision.models import (
        EfficientNet_B2_Weights,
        EfficientNet_B3_Weights,
        EfficientNet_B4_Weights,
    )

    assert BACKBONE_SPECS["efficientnet_b2"].weights is EfficientNet_B2_Weights.IMAGENET1K_V1
    assert BACKBONE_SPECS["efficientnet_b3"].weights is EfficientNet_B3_Weights.IMAGENET1K_V1
    assert BACKBONE_SPECS["efficientnet_b4"].weights is EfficientNet_B4_Weights.IMAGENET1K_V1
    assert BACKBONE_SPECS["efficientnet_b2"].input_size == 288
    assert BACKBONE_SPECS["efficientnet_b3"].input_size == 300
    assert BACKBONE_SPECS["efficientnet_b4"].input_size == 380


@pytest.mark.parametrize(
    "legacy",
    [
        "best_eye_disease_model.pth",
        "best_acc_eye_disease_model.pth",
        "checkpoints/best_eye_disease_model.pth",
        r"C:\models\best_acc_eye_disease_model.pth",
    ],
)
def test_legacy_weight_paths_are_rejected(legacy: str) -> None:
    with pytest.raises(LegacyWeightsRejected):
        assert_not_legacy_weights(legacy)


def test_non_legacy_path_is_allowed() -> None:
    # Must not raise.
    assert_not_legacy_weights("artifacts/p1_benchmark_v1/whatever.json")
    assert_not_legacy_weights(None)


def test_fusion_is_ordered_late_concat_of_per_eye_features() -> None:
    """forward(left,right) == classifier(concat(enc(left), enc(right))).

    Verifies the late-concat structure and its ordering through an
    independent computation path: encode each eye separately, concat in
    (left, right) order, run the head. A bug that averages the eyes, swaps
    the chunk order, or 6-channel-stacks would break this equality.

    Expected value comes from a distinct code path (two single-eye encoder
    passes), not from restating the implementation — so it is not tautological.
    """
    torch.manual_seed(0)
    model = build_bilateral_model("efficientnet_b2", pretrained=False)
    model.eval()
    size = BACKBONE_SPECS["efficientnet_b2"].input_size
    left = torch.randn(2, 3, size, size)
    right = torch.randn(2, 3, size, size)

    def encode(x: "torch.Tensor") -> "torch.Tensor":
        f = model.encoder(x)
        f = model.pool(f)
        return torch.flatten(f, 1)

    with torch.no_grad():
        expected = model.classifier(torch.cat([encode(left), encode(right)], dim=1))
        actual = model(left, right)
    assert torch.allclose(actual, expected, atol=1e-5)
