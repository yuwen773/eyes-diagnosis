"""Unit tests for the four E0–E3 model factories."""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from p1.benchmark.model import BACKBONE_SPECS  # noqa: E402
from p1.training.models import (  # noqa: E402
    EXPERIMENTS,
    MonocularB4,
    assert_e3_not_six_channel,
    build_model,
)


@pytest.mark.parametrize("experiment", ["E0", "E1", "E2", "E3"])
def test_build_model_returns_nn_module(experiment: str) -> None:
    model = build_model(experiment, pretrained=False)
    assert isinstance(model, torch.nn.Module)


@pytest.mark.parametrize("experiment", ["E0", "E1", "E2", "E3"])
def test_all_models_have_three_channel_first_conv(experiment: str) -> None:
    model = build_model(experiment, pretrained=False)
    from p1.benchmark.model import first_conv_in_channels

    assert first_conv_in_channels(model) == 3


def test_e3_rejects_six_channel_input() -> None:
    model = build_model("E3", pretrained=False)
    size = BACKBONE_SPECS["efficientnet_b4"].input_size
    six = torch.randn(2, 6, size, size)
    assert_e3_not_six_channel(model)
    with pytest.raises(TypeError):
        model(six)  # type: ignore[call-arg]


@pytest.mark.parametrize("experiment", ["E0", "E1", "E2"])
def test_monocular_output_shape(experiment: str) -> None:
    model = build_model(experiment, pretrained=False)
    model.eval()
    size = BACKBONE_SPECS["efficientnet_b4"].input_size
    x = torch.randn(4, 3, size, size)
    with torch.no_grad():
        y = model(x)
    assert y.shape == (4, 8)


def test_monocular_has_single_linear_head_not_fusion() -> None:
    model = build_model("E0", pretrained=False)
    from torch import nn

    linears = [m for m in model.modules() if isinstance(m, nn.Linear)]
    # EfficientNet's classifier head is a single Linear; we replace it with our own.
    # The monocular model must have exactly ONE Linear with out_features=8.
    head_linears = [m for m in linears if m.out_features == 8]
    assert len(head_linears) == 1
    # No 2*F fusion module.
    fusion_linears = [m for m in linears if m.in_features == BACKBONE_SPECS["efficientnet_b4"].feature_dim * 2]
    assert not fusion_linears


def test_monocular_carries_eye_attribute() -> None:
    e0 = build_model("E0", pretrained=False)
    e1 = build_model("E1", pretrained=False)
    e2 = build_model("E2", pretrained=False)
    assert e0.eye == "left"
    assert e1.eye == "right"
    assert e2.eye == "e2"


def test_unknown_experiment_raises() -> None:
    with pytest.raises(ValueError):
        build_model("E9", pretrained=False)


def test_experiments_constant_lists_all_four() -> None:
    assert EXPERIMENTS == ("E0", "E1", "E2", "E3")