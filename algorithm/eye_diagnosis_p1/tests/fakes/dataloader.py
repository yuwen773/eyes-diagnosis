"""FakeDataLoaderFactory + FakeBilateralBatch — multi-batch DataLoader for tests.

The P2-02B engine runs an epoch over a DataLoader with ``num_batches``
batches; the probe's existing FakeDataLoader yields a single batch. This
factory yields N batches of fixed shape; each batch is a
``FakeBilateralBatch`` containing REAL torch tensors (not FakeTensor
stand-ins) so the engine's ``torch.nn.BCEWithLogitsLoss`` and similar
operations work without monkey-patching.
"""
from __future__ import annotations

from typing import Any, Iterator

import torch


class FakeBilateralBatch:
    """One batch: (left, right, labels) — 3-tuple drop-in for the engine.

    Tensors are real ``torch.Tensor`` so any real torch operation works on
    them. ``left`` and ``right`` are random (seeded per build) to give the
    model something to consume; ``labels`` are random float in {0, 1} so
    the BCE criterion produces a finite loss.
    """

    def __init__(
        self,
        left: torch.Tensor,
        right: torch.Tensor,
        labels: torch.Tensor,
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
        seed: int = 42,
    ) -> None:
        self._batch_size = batch_size
        self._num_batches = num_batches
        self._remaining = num_batches
        self._num_classes = num_classes
        self._seed = seed

    def __iter__(self) -> "_FakeDataLoader":
        # Reset on every new iter so the runner's post-loop evaluate (a
        # second pass over the same loader) yields the configured batches
        # again instead of StopIteration-on-empty.
        self._remaining = self._num_batches
        return self

    def __next__(self) -> FakeBilateralBatch:
        if self._remaining <= 0:
            raise StopIteration
        self._remaining -= 1
        g = torch.Generator().manual_seed(self._seed)
        left = torch.randn(
            self._batch_size, 3, 380, 380, generator=g
        )
        right = torch.randn(
            self._batch_size, 3, 380, 380, generator=g
        )
        # Labels: Bernoulli so positives are present in most batches.
        labels = torch.randint(
            0, 2, (self._batch_size, self._num_classes),
            generator=g, dtype=torch.float32,
        )
        # Force at least one positive per batch in classes 0 & 1 so that
        # metrics has something to compute (not all-skipped).
        labels[:, 0] = 1.0
        labels[:, 1] = torch.tensor(
            [float(i % 2) for i in range(self._batch_size)]
        )
        return FakeBilateralBatch(left=left, right=right, labels=labels)


class FakeDataLoaderFactory:
    """Builds a multi-batch DataLoader for the engine's epoch loop."""

    def __init__(
        self,
        *,
        batch_size: int = 2,
        num_batches: int = 3,
        num_classes: int = 8,
        seed: int = 42,
    ) -> None:
        self._batch_size = batch_size
        self._num_batches = num_batches
        self._num_classes = num_classes
        self._seed = seed
        self.build_calls: list[dict[str, Any]] = []

    def __call__(
        self,
        *,
        dataset: Any = None,
        batch_size: int | None = None,
        split: str | None = None,
        fold: int | None = None,
        **_ignored: Any,
    ) -> _FakeDataLoader:
        """Construct a loader. Per-call ``batch_size`` overrides the default.

        ``dataset`` / ``split`` / ``fold`` are recorded for inspection but
        do not change loader content (the fakes are fold-agnostic).
        ``num_workers`` / ``pin_memory`` are accepted to mirror the real
        factory signature but ignored.
        """
        bs = batch_size if batch_size is not None else self._batch_size
        self.build_calls.append(
            {"dataset": dataset, "batch_size": bs, "split": split, "fold": fold}
        )
        return _FakeDataLoader(
            batch_size=bs,
            num_batches=self._num_batches,
            num_classes=self._num_classes,
            seed=self._seed,
        )

class FoldAwareDataLoaderFactory(FakeDataLoaderFactory):
    """Fake factory whose loaders carry the patient ids of their split.

    ``run_formal_fold`` zips the OOF rows with the loader's evaluation
    output positionally, so a fake that ignores ``split``/``fold`` cannot
    catch a fold mix-up. This factory puts the resolved patient ids on the
    loader as ``patient_ids`` (and on its ``dataset.rows``), letting a test
    assert that fold 0's validation rows are exactly fold 0's patients.
    """

    def __init__(
        self,
        *,
        fold_assignment: dict[str, int] | None = None,
        batch_size: int = 2,
        num_batches: int = 1,
        num_classes: int = 8,
        seed: int = 42,
    ) -> None:
        super().__init__(
            batch_size=batch_size, num_batches=num_batches,
            num_classes=num_classes, seed=seed,
        )
        if fold_assignment is None:
            fold_assignment = {
                str(pid): pid - 1 for pid in (1, 2, 3, 4, 5)
            }
        self._fold_assignment = dict(fold_assignment)

    def patient_ids_for(self, *, fold: int, split: str | None) -> list[int]:
        """Mirror ``build_rows_for_fold``: val = this fold, train = the rest."""
        in_fold = {int(pid) for pid, f in self._fold_assignment.items()
                   if int(f) == int(fold)}
        if split == "val":
            return sorted(in_fold)
        if split == "train":
            return sorted({int(pid) for pid in self._fold_assignment} - in_fold)
        return sorted(in_fold)

    def __call__(
        self,
        *,
        dataset: Any = None,
        batch_size: int | None = None,
        split: str | None = None,
        fold: int | None = None,
        **_ignored: Any,
    ) -> "_FoldAwareDataLoader":
        loader = super().__call__(
            dataset=dataset, batch_size=batch_size, split=split, fold=fold,
        )
        # run_formal_fold always passes the fold it is running; defaulting to
        # 0 here would silently reproduce the bug this fake exists to catch.
        assert fold is not None, "formal training must pass fold= explicitly"
        pids = self.patient_ids_for(fold=fold, split=split)
        return _FoldAwareDataLoader(loader, pids)


class _FoldAwareDataLoader:
    """Delegates to ``_FakeDataLoader`` but exposes its patient ids."""

    def __init__(self, inner: "_FakeDataLoader", patient_ids: list[int]) -> None:
        self._inner = inner
        self.patient_ids = patient_ids
        self.dataset = _RowsDataset(patient_ids)

    def __iter__(self):
        return iter(self._inner)


class _RowsDataset:
    def __init__(self, patient_ids: list[int]) -> None:
        self.rows = [{"patient_id": pid} for pid in patient_ids]

    def __len__(self) -> int:
        return len(self.rows)
