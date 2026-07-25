"""One-fold training + validation for E0/E1/E2/E3.

This is the minimum verifiable skeleton: preflight, AMP-aware forward
pass on a small TRAINING batch (gradScaler-backed), BCEWithLogitsLoss,
OOF row append on the held-out VAL set, and a fold receipt. It does not
run the full epoch loop, early stopping, or model selection — those are
P2-02 concerns.

OOF-integrity contract: optimizer.step is called ONLY on
``train_patient_ids``; predictions come ONLY from
``val_patient_ids``. The two sets are asserted disjoint at the entry
boundary. Test patients are unreachable: they are not in the signature.
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
    """Wraps a fatal training-time failure (NaN, OOM, disjointness, etc.)."""


@dataclass
class FoldReceipt:
    experiment_id: str
    fold: int
    # P2-01R2: training-patient counts are split so the receipt can no
    # longer be read as "every train patient participated in optimizer.step".
    # ``train_patient_count`` is kept as a backward-compatible alias of
    # ``available_train_patient_count``.
    available_train_patient_count: int
    optimizer_patient_count: int
    val_prediction_count: int
    train_patient_count: int
    val_patient_count: int
    epoch_count: int
    schema_version: str
    # New fields (p2-01r):
    weights: str
    weights_loaded: bool
    initialization: str  # "imagenet" or "random"
    checkpoint_selector: str
    experiment_primary_metric: str
    amp_enabled: bool
    amp_dtype: str
    grad_scaler_enabled: bool
    checkpoint_sha256: str
    manifest_sha256: Optional[str]
    split_sha256: Optional[str]
    fold_sha256: Optional[str]
    protocol_sha256: Optional[str]
    smoke: bool


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


def _stack_train_batch(
    smoke_pids: Sequence[str],
    *,
    experiment: str,
    image_paths: Mapping[str, Mapping[str, Path]],
    labels: Mapping[str, np.ndarray],
    root_dir: Path,
    target_size: int,
    eye_for_dataset: str,
    e2_assignment: Optional[Mapping[str, str]] = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Build a training batch from ``smoke_pids`` (TRAIN ids only).

    E3 stacks left then right on the batch axis. E0/E1 use a single eye;
    E2 uses the per-patient eye resolver.
    """
    if experiment == "E3":
        left_batch, left_labels, _ = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size, "left"
        )
        right_batch, _, _ = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size, "right"
        )
        batch = torch.cat([left_batch, right_batch], dim=0)
        labels_t = left_labels
    else:
        batch, labels_t, _ = _stack_batch(
            smoke_pids, image_paths, labels, root_dir, target_size,
            eye_for_dataset, e2_assignment,
        )
    return batch, labels_t


def run_fold(
    *,
    experiment: str,
    fold_id: int,
    train_patient_ids: Sequence[str],
    val_patient_ids: Sequence[str],
    image_paths: Mapping[str, Mapping[str, Path]],
    labels: Mapping[str, np.ndarray],
    root_dir: Path,
    protocol: E0E3Protocol,
    out_dir: Path,
    e2_assignment: Optional[Mapping[str, str]] = None,
    input_hashes: Optional[Mapping[str, str]] = None,
    _mem_get_info: Optional[Callable[[Optional[int]], tuple[int, int]]] = None,
    _download: bool = True,
) -> FoldReceipt:
    """Run a minimal one-step training+inference pass for one fold.

    Contract:
      * ``train_patient_ids`` and ``val_patient_ids`` must be DISJOINT.
      * Optimizer.step is called ONLY with a batch built from
        ``train_patient_ids`` (no leakage to val).
      * Predictions (and OOF rows) come ONLY from ``val_patient_ids``.
      * ``experiment == "E2"`` requires ``e2_assignment``.

    ``_mem_get_info`` and ``_download`` are private injection points for
    tests; production callers must leave them ``None``/``True``.
    """
    train_set = set(train_patient_ids)
    val_set = set(val_patient_ids)
    overlap = train_set & val_set
    if overlap:
        raise TrainingError(
            f"train∩val must be empty (OOF integrity); overlap: {sorted(overlap)[:5]}"
        )
    if not (0 <= fold_id < protocol.k_folds):
        raise TrainingError(
            f"fold_id {fold_id} outside [0, {protocol.k_folds}) defined by "
            f"protocol.k_folds"
        )
    if not val_set:
        raise TrainingError(
            f"val_patient_ids is empty for fold {fold_id} experiment "
            f"{experiment}; an OOF row cannot be produced. Refusing to "
            f"write an empty receipt."
        )
    if not train_set:
        raise TrainingError("train_patient_ids is empty; cannot run a fold")

    check_required_free_vram_mb(
        protocol.preflight_free_vram_mb, mem_get_info=_mem_get_info
    )

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    oof_path = out_dir / "oof.csv"
    receipt_path = out_dir / f"fold_{fold_id}_receipt.json"

    model = build_model(experiment, weights=protocol.weights, _download=_download)
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

    # Optimizer step draws from TRAIN ids only (the smoke batch is a
    # deterministic prefix of the TRAIN list).
    smoke_pids = list(train_patient_ids)[: max(2, protocol.patient_batch // 4)]

    if experiment == "E3":
        train_batch, train_labels = _stack_train_batch(
            smoke_pids,
            experiment=experiment,
            image_paths=image_paths, labels=labels, root_dir=root_dir,
            target_size=target_size, eye_for_dataset=eye_for_dataset,
        )
    else:
        train_batch, train_labels = _stack_train_batch(
            smoke_pids,
            experiment=experiment,
            image_paths=image_paths, labels=labels, root_dir=root_dir,
            target_size=target_size, eye_for_dataset=eye_for_dataset,
            e2_assignment=e2_assignment,
        )

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=protocol.learning_rate,
        weight_decay=protocol.weight_decay,
    )

    use_amp = bool(protocol.amp and torch.cuda.is_available())
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    train_batch = train_batch.to(device)
    train_labels = train_labels.to(device)

    try:
        if use_amp:
            with torch.amp.autocast(device_type="cuda", dtype=torch.float16):
                loss = _forward_and_loss(model, train_batch, train_labels)
        else:
            loss = _forward_and_loss(model, train_batch, train_labels)
        if torch.isnan(loss).any():
            raise TrainingError(f"NaN loss in fold {fold_id} experiment {experiment}")
        optimizer.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
    except RuntimeError as e:  # covers OOM
        raise TrainingError(f"training step failed in fold {fold_id}: {e}") from e

    # Inference pass (no grad) for the full validation set ONLY.
    model.eval()
    with torch.no_grad():
        all_rows: list[dict] = []
        for pid in val_patient_ids:
            chosen = eye_resolver(pid)
            tensor = _load_image_tensor(
                root_dir / image_paths[pid][chosen], target_size
            ).unsqueeze(0).to(device)
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

    if all_rows:
        with OofWriter(oof_path) as w:
            w.append(all_rows)

    h = input_hashes or {}
    available_train_count = len(train_patient_ids)
    val_count = len(val_patient_ids)
    receipt = FoldReceipt(
        experiment_id=experiment,
        fold=fold_id,
        available_train_patient_count=available_train_count,
        optimizer_patient_count=len(smoke_pids),
        val_prediction_count=val_count,
        # Backward-compat alias of available_train_patient_count. Older
        # readers of this receipt expected "the number of training
        # patients" without distinguishing "available" from
        # "participated in optimizer.step". We keep the field name to
        # avoid a breaking schema rename; new readers should prefer
        # the three explicit fields above.
        train_patient_count=available_train_count,
        val_patient_count=val_count,
        epoch_count=1,
        schema_version=protocol.schema_version,
        weights=protocol.weights,
        weights_loaded=bool(_download),
        initialization="imagenet" if _download else "random",
        checkpoint_selector=protocol.checkpoint_selector,
        experiment_primary_metric=protocol.experiment_primary_metric,
        amp_enabled=use_amp,
        amp_dtype="float16" if use_amp else "none",
        grad_scaler_enabled=use_amp,
        checkpoint_sha256=all_rows[0]["checkpoint_sha256"] if all_rows else "",
        manifest_sha256=h.get("manifest_sha256"),
        split_sha256=h.get("split_sha256"),
        fold_sha256=h.get("fold_sha256"),
        protocol_sha256=h.get("protocol_sha256"),
        smoke=True,
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


__all__ = [
    "FoldReceipt",
    "TrainingError",
    "build_run_fold_with_mock_mem",
    "run_fold",
]
