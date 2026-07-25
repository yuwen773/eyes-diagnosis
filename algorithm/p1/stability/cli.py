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
from typing import Any

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


def build_real_torch_adapter() -> TorchAdapter:
    """Construct the real Torch adapter. Fails fast if torch is unavailable."""
    import torch  # local import; CLI is only invoked on the GPU host

    return _RealTorchAdapter(_torch=torch)


@dataclass
class _RealDataLoaderFactory:
    """Builds a real PyTorch DataLoader for the bilateral dataset.

    The full ``BilateralEyeDataset`` lives in ``p1.training.datasets``;
    this factory wraps it so the CLI doesn't pull that import at
    module load time.
    """

    _torch: Any
    manifest_path: Path
    image_root: Path
    fold: int
    target_size: int

    def __call__(
        self,
        *,
        dataset: Any,
        batch_size: int,
        num_workers: int,
        pin_memory: bool,
    ) -> Any:
        from p1.training.datasets import BilateralEyeDataset

        manifest_pdf = self._torch.zeros(0)  # placeholder; unused
        ds = BilateralEyeDataset(
            manifest_path=self.manifest_path,
            image_root=self.image_root,
            fold=self.fold,
            target_size=self.target_size,
        )
        return self._torch.utils.data.DataLoader(
            ds,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=pin_memory,
        )


def build_real_dataloader_factory(
    *, manifest_path: Path, image_root: Path, fold: int, target_size: int
) -> DataLoaderFactory:
    """Construct the real DataLoader factory."""
    import torch  # local import; only invoked on the GPU host

    return _RealDataLoaderFactory(
        _torch=torch,
        manifest_path=manifest_path,
        image_root=image_root,
        fold=fold,
        target_size=target_size,
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