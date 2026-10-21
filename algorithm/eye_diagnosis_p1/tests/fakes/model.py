"""FakeModelFactory + FakeBilateralModel — deterministic model for tests."""
from __future__ import annotations

from typing import Any

import torch
from torch import nn


class FakeBilateralModel(nn.Module):
    """Bilateral (E3-style) fake: returns real torch.zeros(B, num_classes).

    The output is a real torch tensor (so it works with torch.cat / torch.nn
    ops downstream), but its values are deterministic zeros + a stable seed-
    driven bias so logits are reproducible across runs.

    Input contract: ``forward(left, right)`` accepts anything with a
    ``.shape`` attribute shaped ``(B, 3, H, W)``.
    """

    def __init__(self, num_classes: int = 8, seed: int = 42) -> None:
        super().__init__()
        torch.manual_seed(seed)
        self.linear = nn.Linear(6, num_classes)

    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:
        # Use the batch dim from the FakeTensor's shape so the model works
        # without needing FakeTensor to behave like torch.Tensor in cat/linear.
        batch = left.shape[0] if hasattr(left, "shape") else int(left.size(0))
        # Construct the 6-feature concat (left.mean + right.mean along HW) via
        # a real torch tensor on the same device as this linear layer.
        device = next(self.linear.parameters()).device
        l_mean = torch.zeros(batch, 3, device=device)
        r_mean = torch.zeros(batch, 3, device=device)
        return self.linear(torch.cat([l_mean, r_mean], dim=1))


class FakeModelFactory:
    """Returns a FakeBilateralModel + a tiny setup-meta dict."""

    def __init__(self, *, num_classes: int = 8, seed: int = 42) -> None:
        self._num_classes = num_classes
        self._seed = seed

    def __call__(
        self, *, experiment: str, weights: str = "", device: str = "cpu"
    ) -> tuple[FakeBilateralModel, dict[str, Any]]:
        # P2-02B only wires E3; any other experiment raises to fail loudly.
        if experiment != "E3":
            raise ValueError(
                f"FakeModelFactory: experiment={experiment!r} not supported "
                "(P2-02B wires E3 only)"
            )
        model = FakeBilateralModel(num_classes=self._num_classes, seed=self._seed)
        if device == "cuda":
            model = model.to("cuda")  # pragma: no cover (CI is CPU-only)
        meta: dict[str, Any] = {
            "experiment": experiment,
            "weights": weights,
            "device": device,
            "num_classes": self._num_classes,
            "seed": self._seed,
        }
        return model, meta