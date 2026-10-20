"""T1.2 CLI for the P2-02A single-batch CUDA stability probe.

Four explicit inputs (--manifest, --split-assignment, --fold-assignment,
--image-root) plus the frozen protocol and one matrix-cell label. The
CLI builds real Torch / DataLoader / Model adapters and runs the
9-stage probe once, writing the staged report under ``--out-dir``.

This CLI is intentionally a thin wrapper around ``probe.build_probe``
plus a real-adapter builder (``build_real_adapters``). It does not
implement the 6-cell matrix iteration (T3) or the 100-batch gate
(T4); those are separate tasks with their own drivers.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from p1.stability.matrix import expand_matrix
from p1.stability.probe import (
    DataLoaderFactory,
    ModelFactory,
    TorchAdapter,
    build_probe,
)
from p1.stability.protocol import load_p202a_protocol
from p1.stability.stages import ProbeContext


@dataclass
class _RealTorchAdapter:
    """Real Torch adapter. Imports torch at construction time."""

    _torch: Any

    def cuda_is_available(self) -> bool:
        return bool(self._torch.cuda.is_available())

    def cuda_device_count(self) -> int:
        return int(self._torch.cuda.device_count())

    def cuda_synchronize(self) -> None:
        self._torch.cuda.synchronize()

    def cuda_mem_get_info(self, device: int = 0) -> tuple[int, int]:
        return tuple(self._torch.cuda.mem_get_info(device))  # type: ignore[return-value]

    def isfinite(self, tensor: Any) -> bool:
        return bool(self._torch.isfinite(tensor).all().item())

    def GradScaler(self, enabled: bool) -> Any:
        return self._torch.amp.GradScaler("cuda", enabled=enabled)

    def BCEWithLogitsLoss(self) -> Any:
        return self._torch.nn.BCEWithLogitsLoss()

    def float(self, tensor: Any) -> Any:
        return tensor.float()

    def autocast(
        self,
        device_type: str = "cuda",
        dtype: Any = None,
        enabled: bool = True,
    ) -> Any:
        # The probe relies on this default — it calls
        # ``torch.autocast(device_type="cuda", enabled=True)`` without
        # passing dtype, so the adapter must default to fp16 to match
        # the benchmark's amp_dtype=torch.float16 in
        # ``p1.benchmark.cuda_runtime``. Other callers (the benchmark)
        # pass dtype explicitly; this default is a fallback for them too.
        if dtype is None:
            dtype = self._torch.float16
        return self._torch.autocast(
            device_type=device_type, dtype=dtype, enabled=enabled
        )


def build_real_torch_adapter() -> TorchAdapter:
    """Construct the real Torch adapter. Fails fast if torch is unavailable."""
    import torch  # local import; CLI is only invoked on the GPU host

    return _RealTorchAdapter(_torch=torch)


LABEL_COLUMNS: tuple[str, ...] = (
    "label_N",
    "label_D",
    "label_G",
    "label_C",
    "label_A",
    "label_H",
    "label_M",
    "label_O",
)


def build_rows_for_fold(
    manifest_pdf: Any,
    fold: int,
    fold_assignment: dict[str, int],
    split: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Filter the manifest to a single fold and reshape rows for BilateralEyeDataset.

    Frozen ``BilateralEyeDataset`` (in ``p1.benchmark.cuda_runtime``) takes a
    pre-built list of dicts with ``left_image_relpath``, ``right_image_relpath``,
    and an 8-element ``labels`` list. This pure function builds that list from
    the frozen patient manifest + fold assignment.

    ``split`` selects a side of the fold partition:

    * ``"val"`` — patients assigned to ``fold``
    * ``"train"`` — Development patients assigned to any other fold
    * ``None`` — every patient in ``fold`` (the T2/T3 probe's behaviour;
      it only measures I/O and memory and never trains)

    Note this is *not* the ``split_assignment`` artifact, which marks the
    dev/test hold-out. Training callers must pass ``split``; otherwise both
    loaders read identical rows and the reported metrics are measured on
    data the model already saw.
    """
    if split not in (None, "train", "val"):
        raise ValueError(f"split must be 'train', 'val' or None; got {split!r}")
    rows: list[dict[str, Any]] = []
    for _, row in manifest_pdf.iterrows():
        pid = str(row["patient_id"])
        # ``load_fold_assignment`` keys by the CSV's patient_id string, but
        # callers may hand us int-keyed dicts. Try both rather than silently
        # treating every patient as unassigned.
        assigned = fold_assignment.get(pid, fold_assignment.get(row["patient_id"]))
        if assigned is None:
            continue
        in_fold = int(assigned) == int(fold)
        if split == "val" and not in_fold:
            continue
        if split == "train" and in_fold:
            continue
        if split is None and not in_fold:
            continue
        rows.append(
            {
                "patient_id": pid,
                "left_image_relpath": str(row["left_image_relpath"]),
                "right_image_relpath": str(row["right_image_relpath"]),
                "labels": [float(row[c]) for c in LABEL_COLUMNS],
            }
        )
    return rows


@dataclass
class _RealDataLoaderFactory:
    """Builds a real PyTorch DataLoader for the bilateral dataset.

    The frozen ``BilateralEyeDataset`` lives in ``p1.benchmark.cuda_runtime``
    (this is the only definition in the repo). The factory builds the
    ``rows`` list from the frozen manifest + fold assignment, then wraps
    the DataLoader with a collate-fn that drops the 4th element (``cpu_ms``)
    so the probe sees the 3-tuple ``(left, right, labels)`` it expects.
    """

    _torch: Any
    manifest_path: Path
    image_root: Path
    fold: int
    target_size: int
    fold_assignment_path: Path

    def __call__(
        self,
        *,
        dataset: Any,
        batch_size: int,
        num_workers: int,
        pin_memory: bool,
        split: Optional[str] = None,
        fold: Optional[int] = None,
    ) -> Any:
        from p1.benchmark.cuda_runtime import BilateralEyeDataset

        from p1.training.frozen_inputs import load_fold_assignment

        # Read the manifest and the fold via pandas (cheap, CPU-only).
        import pandas as pd

        manifest_pdf = pd.read_parquet(self.manifest_path)
        fold_map = load_fold_assignment(
            self.fold_assignment_path, expected_folds=5
        )
        # An explicit ``fold`` wins over the one baked in at construction:
        # the formal runner builds one factory and calls it per fold, so
        # ignoring the argument would train every fold on fold 0's split.
        rows = build_rows_for_fold(
            manifest_pdf,
            self.fold if fold is None else int(fold),
            fold_map,
            split=split,
        )
        ds = BilateralEyeDataset(rows, self.image_root, self.target_size)
        return self._torch.utils.data.DataLoader(
            ds,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=pin_memory,
            collate_fn=_collate_bilateral_batch,
        )


def _collate_bilateral_batch(batch: Any) -> Any:
    """Collate ``BilateralEyeDataset`` items into stacked bilateral tensors.

    PyTorch's DataLoader always hands ``collate_fn`` a list of ``B`` per-item
    samples (``B == batch_size``), where each sample is the dataset's 4-tuple
    ``(left, right, labels, cpu_ms)`` with ``left``/``right`` shaped
    ``[3, H, W]`` and ``labels`` shaped ``[num_classes]``.

    The probe's ``first_batch_wait`` stage expects the 3-tuple
    ``(left, right, labels)`` with a leading batch dim: ``[B, 3, H, W]``,
    ``[B, 3, H, W]``, ``[B, num_classes]``. We stack every component along a
    new axis 0 and drop ``cpu_ms``. This holds for every ``B >= 1`` — the
    frozen matrix cells A-F use ``B = 1, 1, 2, 4, 8, 8``.

    A batch of ``B`` items is a length-``B`` list; a single 4-tuple is a
    length-4 tuple. The previous two-step unwrap/stack could not tell a
    4-item batch (cell D) from one 4-tuple, so it silently collapsed or
    mis-unpacked cells C-F. Stacking directly removes that ambiguity.
    """
    import torch

    lefts = torch.stack([sample[0] for sample in batch], dim=0)
    rights = torch.stack([sample[1] for sample in batch], dim=0)
    labels = torch.stack([sample[2] for sample in batch], dim=0)
    return [lefts, rights, labels]


def build_real_dataloader_factory(
    *,
    manifest_path: Path,
    image_root: Path,
    fold: int,
    target_size: int,
    fold_assignment_path: Path,
) -> DataLoaderFactory:
    """Construct the real DataLoader factory."""
    import torch  # local import; only invoked on the GPU host

    return _RealDataLoaderFactory(
        _torch=torch,
        manifest_path=manifest_path,
        image_root=image_root,
        fold=fold,
        target_size=target_size,
        fold_assignment_path=fold_assignment_path,
    )


@dataclass
class _RealModelFactory:
    _experiment: str
    _weights: str
    _device: str

    def __call__(
        self,
        *,
        experiment: str,
        weights: str,
        device: str,
    ) -> tuple[Any, dict[str, Any]]:
        from p1.training.models import build_model, first_conv_in_channels

        model = build_model(
            experiment=experiment,
            weights=weights,
            _download=False,  # weights must already be cached
        )
        model = model.to(device)
        setup = {
            "weights": weights,
            "weights_loaded": True,
            "initialization": "imagenet",
            "model_device": device,
            "first_conv_in_channels": int(first_conv_in_channels(model)),
        }
        return model, setup


def build_real_model_factory(
    *, experiment: str, weights: str, device: str
) -> ModelFactory:
    return _RealModelFactory(_experiment=experiment, _weights=weights, _device=device)


def make_real_optimizer_factory() -> Any:
    """Return a factory that builds the frozen-config AdamW optimizer.

    Frozen v1 training config (see project memory
    ``p2-02-pipeline-and-first-round-config``):
        optimizer: AdamW
        learning_rate: 1e-4
        weight_decay: 1e-4
    """
    import torch

    def _build(model: Any) -> Any:
        return torch.optim.AdamW(
            model.parameters(),
            lr=1e-4,
            weight_decay=1e-4,
        )

    return _build


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="p1.stability.cli",
        description=(
            "Run a single P2-02A matrix cell on the GPU. Writes the "
            "9-stage report under --out-dir/<cell>.json."
        ),
    )
    parser.add_argument(
        "--protocol",
        type=Path,
        required=True,
        help="Path to the P2-02A protocol JSON (must be p2-02a-v1).",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="Path to the frozen patient manifest parquet.",
    )
    parser.add_argument(
        "--split-assignment",
        type=Path,
        required=True,
        help="Path to the frozen split assignment CSV.",
    )
    parser.add_argument(
        "--fold-assignment",
        type=Path,
        required=True,
        help="Path to the frozen fold assignment CSV.",
    )
    parser.add_argument(
        "--image-root",
        type=Path,
        required=True,
        help="Path to the read-only image root directory.",
    )
    parser.add_argument(
        "--cell",
        type=str,
        required=True,
        choices=[c.label for c in expand_matrix()],
        help="Matrix cell label (A-F).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Output directory; the staged report is written here.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run the probe for one matrix cell. Returns 0 on PASS, 1 otherwise."""
    args = _parse_args(argv)
    protocol = load_p202a_protocol(args.protocol)
    cell_lookup = {c.label: c for c in expand_matrix()}
    if args.cell not in cell_lookup:
        raise SystemExit(f"unknown cell {args.cell!r}")
    cell = cell_lookup[args.cell]

    args.out_dir.mkdir(parents=True, exist_ok=True)

    torch_a = build_real_torch_adapter()
    dl_factory = build_real_dataloader_factory(
        manifest_path=args.manifest,
        image_root=args.image_root,
        fold=protocol.fold,
        target_size=protocol.image_size,
        fold_assignment_path=args.fold_assignment,
    )
    model_factory = build_real_model_factory(
        experiment=protocol.experiment,
        weights=protocol.weights,
        device="cuda",
    )
    # Load the three frozen artifacts and gate the probe on
    # ``validate_frozen_training_inputs``. This is the P2-01 closed
    # contract: the fold artifact MUST equal the Development set, and
    # MUST NOT contain Test patients. A failed gate short-circuits
    # the probe before the DataLoader is created.
    from p1.training.frozen_inputs import (
        load_fold_assignment,
        load_split_assignment,
        validate_frozen_training_inputs,
    )

    import pandas as pd

    manifest_pdf = pd.read_parquet(args.manifest)
    manifest_pids = set(manifest_pdf["patient_id"].tolist())
    split = load_split_assignment(args.split_assignment)
    fold = load_fold_assignment(args.fold_assignment, expected_folds=5)
    runner = build_probe(
        torch=torch_a,
        dataloader_factory=dl_factory,
        model_factory=model_factory,
        optimizer_factory=make_real_optimizer_factory(),
        amp=bool(cell.config["amp"]),
        patient_batch=int(cell.config["patient_batch"]),
        num_workers=int(cell.config["num_workers"]),
        pin_memory=bool(cell.config["pin_memory"]),
        image_size=protocol.image_size,
        num_classes=protocol.num_classes,
        validator=validate_frozen_training_inputs,
        expected_folds=5,
        manifest_patient_ids=manifest_pids,
        split_assignment=split,
        fold_assignment=fold,
    )
    ctx = ProbeContext()
    result = runner.run(ctx)
    report = {
        "protocol": {
            "schema_version": protocol.schema_version,
            "experiment": protocol.experiment,
            "backbone": protocol.backbone,
            "weights": protocol.weights,
            "fold": protocol.fold,
            "seed": protocol.seed,
            "image_size": protocol.image_size,
            "num_classes": protocol.num_classes,
        },
        "cell": {"label": cell.label, "config": dict(cell.config)},
        "setup": dict(ctx.setup),
        "records": list(result.records),
        "failed_stage": result.failed_stage,
        "all_pass": result.all_pass,
    }
    out_path = args.out_dir / f"{cell.label}.json"
    out_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0 if result.all_pass else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())


__all__ = [
    "build_real_torch_adapter",
    "build_real_dataloader_factory",
    "build_real_model_factory",
    "main",
]