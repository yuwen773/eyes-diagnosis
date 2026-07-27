"""FakeModelFactory + FakeBilateralModel — deterministic model for tests."""
from __future__ import annotations

from typing import Any

import torch
from torch import nn


class FakeBilateralModel(nn.Module):
    """Bilateral (E3-style) fake: logits = Linear(concat(left.mean, right.mean)).

    Output shape: ``(B, 8)``. Weights are seeded so logits are reproducible.
    The linear takes 6 features (3 left + 3 right) → 8 disease classes.
    """

    def __init__(self, num_classes: int = 8, seed: int = 42) -> None:
        super().__init__()
        torch.manual_seed(seed)
        self.linear = nn.Linear(6, num_classes)

    def forward(self, left: torch.Tensor, right: torch.Tensor) -> torch.Tensor:
        # left, right: (B, 3, 380, 380)
        l_mean = left.mean(dim=(2, 3))  # (B, 3)
        r_mean = right.mean(dim=(2, 3))  # (B, 3)
        return self.linear(torch.cat([l_mean, r_mean], dim=1))  # (B, 8)


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