"""Shared fakes for P2-02B tests.

These fakes provide small, deterministic test doubles for the protocol loader,
manifest loader, fold-assignment loader, model factory, environment
fingerprint, torch/optimizer/scaler adapter, and multi-batch DataLoader
factory. They live under ``tests/`` (not ``p1/training/``) because they
are test-only infrastructure — production code never imports from here.

Import via ``from eye_diagnosis_p1.tests.fakes import FakeModelFactory``
(or via the shorter ``from tests.fakes import ...`` inside ``tests/fakes/``
relative imports).
"""
from __future__ import annotations

from .dataloader import (
    FakeBilateralBatch,
    FakeDataLoaderFactory,
    FoldAwareDataLoaderFactory,
)
from .environment import FakeEnvironmentCapture
from .fold_assignment import (
    FakeFoldAssignmentLoader,
    FakeSplitAssignmentLoader,
    fold_split,
)
from .manifest import FakeManifestLoader
from .model import FakeBilateralModel, FakeModelFactory
from .protocol import FakeProtocolLoader
from .torch import (
    FakeOptimizer,
    FakeScaler,
    FakeScaledTensor,
    FakeTensor,
    FakeTorchAdapter,
)

__all__ = [
    "FakeBilateralBatch",
    "FakeBilateralModel",
    "FakeDataLoaderFactory",
    "FakeEnvironmentCapture",
    "FakeFoldAssignmentLoader",
    "FakeManifestLoader",
    "FakeModelFactory",
    "FakeOptimizer",
    "FakeProtocolLoader",
    "FakeScaler",
    "FakeScaledTensor",
    "FakeSplitAssignmentLoader",
    "FakeTensor",
    "FakeTorchAdapter",
    "FoldAwareDataLoaderFactory",
    "fold_split",
]