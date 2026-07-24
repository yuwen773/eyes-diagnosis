"""One-fold training + validation for E0/E1/E2/E3.

This is the minimum verifiable skeleton: preflight, AMP-aware forward
pass on a small batch, BCEWithLogitsLoss, OOF row append, and a fold
receipt. It does not run the full epoch loop, early stopping, or model
selection — those are P2-02 concerns. The runner refuses to read any
Test patients because its public signature does not accept them.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Mapping, Optional, Sequence

import numpy as np
import torch
from PIL import Image
from torch import nn

from p1.audit import CLASS_ORDER
from p1.benchmark.preprocess import preprocess_image
from p1.training.models import build_model
from p1.training.oof import OofWriter
from p1.training.preflight import check_required_free_vram_mb
from p1.training.protocol import E0E3Protocol


class TrainingError(RuntimeError):
    """Wraps a fatal training-time failure (NaN, OOM, etc.)."""


@dataclass
class FoldReceipt:
    experiment_id: str
    fold: int
    dev_patient_count: int
    val_patient_count: int
    epoch_count: int
    amp: bool
    checkpoint_sha256: str
    schema_version: str


def _load_image_tensor(path: Path, target_size: int) -> torch.Tensor:
    with Image.open(path) as img:
        return preprocess_image(img, target_size=target_size)


def _stack_batch(
    patient_ids: Sequence[str],
    image_paths: Mapping[str, Mapping[str, Path]],
    labels: Mapping[str, np.ndarray],
    root_dir: Path,
    target_size: int,
    eye: str,
    e2_assignment: Optional[Mapping[str, str]] = None,
) -> tuple[torch.Tensor, torch.Tensor, list[str]]:
    tensors: list[torch.Tensor] = []
    label_vecs: list[torch.Tensor] = []
    used_pids: list[str] = []
    for pid in patient_ids:
        chosen = eye if eye != "e2" else e2_assignment[pid]  # type: ignore[index]
        path = root_dir / image_paths[pid][chosen]
        tensors.append(_load_image_tensor(path, target_size))
        label_vecs.append(torch.from_numpy(labels[pid]).to(torch.int64))
        used_pids.append(pid)
    return torch.stack(tensors, dim=0), torch.stack(label_vecs, dim=0), used_pids


def _sha256_state_dict(model: nn.Module) -> str:
    h = hashlib.sha256()
    for k in sorted(model.state_dict().keys()):
        h.update(k.encode("utf-8"))
        h.update(model.state_dict()[k].detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def _forward_and_loss(
    model: nn.Module, batch: torch.Tensor, labels: torch.Tensor
) -> torch.Tensor:
    from p1.benchmark.model import BilateralSharedEncoder

    if isinstance(model, BilateralSharedEncoder):
        left, right = torch.chunk(batch, 2, dim=0)
        logits = model(left, right)
    else:
        logits = model(batch)
    loss = nn.functional.binary_cross_entropy_with_logits(logits, labels.float())
    return loss


def run_fold(
    *,
    experiment: str,
    fold_id: int,
    dev_patient_ids: Sequence[str],
    val_patient_ids: Sequence[str],
    image_paths: Mapping[str, Mapping[str, Path]],
    labels: Mapping[str, np.ndarray],
    root_dir: Path,
    protocol: E0E3Protocol,
    out_dir: Path,
    e2_assignment: Optional[Mapping[str, str]] = None,
    _mem_get_info: Optional[Callable[[Optional[int]], tuple[int, int]]] = None,
) -> FoldReceipt:
    """Run a minimal one-step training+inference pass for one fold.

    Public signature intentionally does not accept ``test_patient_ids``.
    ``e2_assignment`` is required when ``experiment == "E2"``.
    ``_mem_get_info`` is a private injection point for tests; production
    callers must leave it ``None`` so the real GPU probe runs.
    """
    check_required_free_vram_mb(
        protocol.preflight_free_vram_mb, mem_get_info=_mem_get_info
    )

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    oof_path = out_dir / "oof.csv"
    receipt_path = out_dir / f"fold_{fold_id}_receipt.json"

    model = build_model(experiment, pretrained=False)
    target_size = protocol.image_size

    if experiment == "E2":
        if not e2_assignment:
            raise TrainingError("E2 requires e2_assignment")
        eye_for_dataset = "e2"
        eye_resolver = lambda pid: e2_assignment[pid]  # noqa: E731
    elif experiment == "E3":
        eye_for_dataset = "left"
        eye_resolver = lambda pid: "left"  # noqa: E731
    else:
        eye_for_dataset = {"E0": "left", "E1": "right"}[experiment]
        eye_resolver = lambda pid: eye_for_dataset  # noqa: E731

    # One forward pass over the first 2 validation patients (smoke-sized).
    smoke_pids = list(val_patient_ids)[: max(2, protocol.patient_batch // 4)]
    if not smoke_pids:
        raise TrainingError("val_patient_ids is empty; cannot run a fold")

    if experiment == "E3":
        # E3 needs paired eyes. Stack left then right on the batch axis so
        # the shared encoder runs once over [2B,3,H,W]; labels correspond to
        # the post-chunk batch size [B,8].
        left_batch, left_labels, used_pids = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size, "left"
        )
        right_batch, _, _ = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size, "right"
        )
        val_batch = torch.cat([left_batch, right_batch], dim=0)
        val_labels = left_labels
    else:
        val_batch, val_labels, used_pids = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size,
            eye_for_dataset, e2_assignment,
        )

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=protocol.learning_rate,
        weight_decay=protocol.weight_decay,
    )

    use_amp = bool(protocol.amp and torch.cuda.is_available())
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    val_batch = val_batch.to(device)
    val_labels = val_labels.to(device)

    try:
        slice_end = min(protocol.patient_batch, val_labels.shape[0])
        if use_amp:
            with torch.amp.autocast(device_type="cuda", dtype=torch.float16):
                loss = _forward_and_loss(model, val_batch[: slice_end * 2 if experiment == "E3" else slice_end], val_labels[:slice_end])
        else:
            loss = _forward_and_loss(model, val_batch[: slice_end * 2 if experiment == "E3" else slice_end], val_labels[:slice_end])
        if torch.isnan(loss).any():
            raise TrainingError(f"NaN loss in fold {fold_id} experiment {experiment}")
        loss.backward()
        optimizer.step()
        optimizer.zero_grad()
    except RuntimeError as e:  # covers OOM
        raise TrainingError(f"training step failed in fold {fold_id}: {e}") from e

    # Inference pass (no grad) for the full validation set.
    model.eval()
    with torch.no_grad():
        all_rows: list[dict] = []
        for pid in val_patient_ids:
            chosen = eye_resolver(pid)
            tensor = _load_image_tensor(root_dir / image_paths[pid][chosen], target_size).unsqueeze(0).to(device)
            if experiment == "E3":
                tensor_right = _load_image_tensor(
                    root_dir / image_paths[pid]["right"], target_size
                ).unsqueeze(0).to(device)
                logits = model(tensor, tensor_right)
            else:
                logits = model(tensor)
            probs = torch.sigmoid(logits).squeeze(0).detach().cpu().numpy().tolist()
            row = {
                "patient_id": pid,
                "fold": fold_id,
                "experiment_id": experiment,
                "seed": protocol.seed,
            }
            true_vec = labels[pid].tolist()
            for c, bit in zip(CLASS_ORDER, true_vec):
                row[f"true_{c}"] = int(bit)
            for c, p in zip(CLASS_ORDER, probs):
                row[f"prob_{c}"] = float(p)
            row["checkpoint_sha256"] = _sha256_state_dict(model)
            all_rows.append(row)

    with OofWriter(oof_path) as w:
        w.append(all_rows)

    receipt = FoldReceipt(
        experiment_id=experiment,
        fold=fold_id,
        dev_patient_count=len(dev_patient_ids),
        val_patient_count=len(val_patient_ids),
        epoch_count=1,
        amp=bool(protocol.amp),
        checkpoint_sha256=all_rows[0]["checkpoint_sha256"],
        schema_version=protocol.schema_version,
    )
    receipt_path.write_text(json.dumps(asdict(receipt), indent=2, sort_keys=True))
    return receipt


def build_run_fold_with_mock_mem(
    *, mem_get_info: Callable[[Optional[int]], tuple[int, int]]
) -> Callable[..., FoldReceipt]:
    """Return a runner closure that overrides the preflight CUDA probe.

    Tests inject a fake ``mem_get_info`` so the failure path is
    deterministic and independent of the local GPU state.
    """
    def _runner(**kwargs) -> FoldReceipt:
        original = check_required_free_vram_mb
        from p1.training import fold_runner as _self

        def _patched(threshold_mb: int, *, mem_get_info=None) -> int:
            return original(threshold_mb, mem_get_info=mem_get_info)
        _self.check_required_free_vram_mb = _patched
        try:
            return run_fold(**kwargs)
        finally:
            _self.check_required_free_vram_mb = original
    return _runner