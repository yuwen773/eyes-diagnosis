"""FakeDataLoaderFactory + FakeBilateralBatch — multi-batch DataLoader for tests.

The P2-02B engine runs an epoch over a DataLoader with ``num_batches``
batches; the probe's existing FakeDataLoader yields a single batch. This
factory yields N batches of fixed shape; each batch is a
``FakeBilateralBatch`` containing left/right/labels tensors of the
configured size so the engine's batching math works out exactly.
"""
from __future__ import annotations

from typing import Any, Iterator

from .torch import FakeTensor


class FakeBilateralBatch:
    """One batch: (left, right, labels) — 3-tuple drop-in for the engine."""

    def __init__(
        self,
        left: FakeTensor,
        right: FakeTensor,
        labels: FakeTensor,
    ) -> None:
        self.left = left
        self.right = right
        self.labels = labels


class _FakeDataLoader:
    """Yields ``num_batches`` batches then raises ``StopIteration``."""

    def __init__(
        self,
        *,
        batch_size: int,
        num_batches: int,
        num_classes: int,
    ) -> None:
        self._batch_size = batch_size
        self._remaining = num_batches
        self._num_classes = num_classes

    def __iter__(self) -> "_FakeDataLoader":
        return self

    def __next__(self) -> FakeBilateralBatch:
        if self._remaining <= 0:
            raise StopIteration
        self._remaining -= 1
        return FakeBilateralBatch(
            left=FakeTensor((self._batch_size, 3, 380, 380)),
            right=FakeTensor((self._batch_size, 3, 380, 380)),
            labels=FakeTensor((self._batch_size, self._num_classes)),
        )


class FakeDataLoaderFactory:
    """Builds a multi-batch DataLoader for the engine's epoch loop."""

    def __init__(
        self,
        *,
        batch_size: int = 2,
        num_batches: int = 3,
        num_classes: int = 8,
        image_size: int = 380,
    ) -> None:
        self._batch_size = batch_size
        self._num_batches = num_batches
        self._num_classes = num_classes
        self._image_size = image_size
        self.build_calls: list[dict[str, Any]] = []

    def __call__(
        self,
        *,
        dataset: Any = None,
        batch_size: int | None = None,
        num_workers: int = 0,
        pin_memory: bool = False,
        split: str | None = None,
        fold: int | None = None,
    ) -> _FakeDataLoader:
        bs = batch_size if batch_size is not None else self._batch_size
        self.build_calls.append(
            {
                "dataset": dataset,
                "batch_size": bs,
                "num_workers": num_workers,
                "pin_memory": pin_memory,
                "split": split,
                "fold": fold,
            }
        )
        return _FakeDataLoader(
            batch_size=bs,
            num_batches=self._num_batches,
            num_classes=self._num_classes,
        )